// Builds the Express app. index.js runs it; tests build it with stubbed users and handlers.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { query } from './db/pool.js';
import { guard, PUBLIC } from './auth.js';
import { clientOrigin, isProduction } from './config.js';
import { requireSameOrigin } from './http/origin.js';
import { validate } from './http/validate.js';
import { ROLES } from './logic/roles.js';
import { todayInLagos } from './logic/time.js';
import { todayCheckin } from './services/checkin.js';
import { routes as defaultRoutes, ONBOARDED, CHECKED_IN, PHOTO, WEBHOOK_PATH } from './routes.js';
import { webhookSignatureValid } from './logic/checkout.js';
import { paystackSecret } from './config.js';

// Only Paystack knows the secret key, so only Paystack can produce a valid signature.
function paystackSignature(req, res, next) {
  if (!webhookSignatureValid(req.body, req.get('x-paystack-signature'), paystackSecret())) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  try {
    req.paystackEvent = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'The webhook body must be valid JSON' });
  }
  next();
}
import { photoUpload } from './http/upload.js';
import { UPLOADS_ROOT } from './services/photos.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function dbSessionUser(id) {
  const { rows } = await query(
    `SELECT u.user_id, u.name, u.email, u.role, u.must_change_password, u.session_version, hp.answered_at FROM users u
     LEFT JOIN health_profiles hp ON hp.user_id = u.user_id WHERE u.user_id = $1`, [id],
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.user_id, name: u.name, email: u.email, role: u.role, onboarded: u.answered_at !== null, mustChangePassword: u.must_change_password,
    sessionVersion: u.session_version,
  };
}

const dbTodayCheckin = (userId) => todayCheckin(userId, todayInLagos());

/**
 * Staff gates, after the role check: the health question must be answered (change 9) and,
 * for ordering, today's check-in must exist (change 8). The check-in row is passed on as req.checkin.
 */
function staffGates(needs = [], loadCheckin) {
  return async (req, res, next) => {
    if (req.user?.role !== 'staff' || needs.length === 0) return next();
    if (needs.includes(ONBOARDED) && !req.user.onboarded) {
      return res.status(403).json({ error: 'Answer the health question before you continue.', code: 'ONBOARDING_REQUIRED' });
    }
    if (needs.includes(CHECKED_IN)) {
      try {
        req.checkin = await loadCheckin(req.user.id);
      } catch (err) {
        return next(err);
      }
      if (!req.checkin) {
        return res.status(403).json({ error: "Complete today's check-in before you order.", code: 'CHECKIN_REQUIRED' });
      }
    }
    next();
  };
}

/**
 * A temporary password (set by an admin) must be changed before anything else. Only routes marked
 * `passwordChange: true` (who am I, change password) stay open until then.
 */
function passwordGate(route) {
  return (req, res, next) => {
    if (route.roles === PUBLIC || route.passwordChange || !req.user?.mustChangePassword) return next();
    res.status(403).json({ error: 'Change your temporary password before you continue.', code: 'PASSWORD_CHANGE_REQUIRED' });
  };
}

// 10 requests per 15 minutes per IP, counted separately for each auth endpoint. Only the browser
// test server (scripts/ui-server.js), which logs in many times, may raise it; never in production.
const authLimit = () => (!isProduction() && Number(process.env.TEST_AUTH_LIMIT)) || 10;
const authLimiter = () => rateLimit({
  windowMs: 15 * 60_000,
  limit: authLimit(),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts from this device. Please wait 15 minutes and try again.' },
});

// Forgot password: 5 requests per hour per IP, and 3 per hour per email address (whether or not an
// account exists, so the limit itself reveals nothing).
const forgotLimiters = () => [
  rateLimit({
    windowMs: 60 * 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many reset requests from this device. Please wait an hour and try again.' },
  }),
  rateLimit({
    windowMs: 60 * 60_000,
    limit: 3,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `email:${String(req.body?.email ?? '').trim().toLowerCase()}`,
    message: { error: 'Too many reset requests for this email. Please wait an hour and try again.' },
  }),
];

export function assertRolesDeclared(route) {
  const ok = route.roles === PUBLIC
    || (Array.isArray(route.roles) && route.roles.length > 0 && route.roles.every((r) => ROLES.includes(r)));
  if (!ok) throw new Error(`Route ${route.method.toUpperCase()} ${route.path} must declare its roles`);
}

/**
 * options.routes      route table (default: routes.js)
 * options.sessionUser loads the signed-in user by id (default: database)
 * options.todayCheckin loads a staff member's check-in for today, or null (default: database)
 * options.stubHandlers replaces every handler with a 200 response, to test the security layers alone
 * options.staticDir   built client to serve (production)
 */
export function createApp({
  routes = defaultRoutes, sessionUser = dbSessionUser, todayCheckin: loadCheckin = dbTodayCheckin,
  stubHandlers = false, staticDir,
} = {}) {
  const origin = clientOrigin();
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Paystack's inline checkout (payments phase): script, API calls and the checkout frame.
        scriptSrc: ["'self'", 'https://js.paystack.co'],
        connectSrc: ["'self'", 'https://api.paystack.co'],
        frameSrc: ['https://checkout.paystack.com'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction() ? [] : null,
      },
    },
  }));
  app.use(cors({ origin, credentials: true }));

  const api = express.Router();
  api.use(requireSameOrigin(origin, { exempt: [WEBHOOK_PATH] }));
  // The webhook keeps its raw bytes: the HMAC must be checked over exactly what Paystack signed.
  api.use(WEBHOOK_PATH, express.raw({ type: '*/*', limit: '100kb' }));
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());

  for (const route of routes) {
    assertRolesDeclared(route);
    const chain = [];
    if (route.limit === 'auth') chain.push(authLimiter());
    if (route.limit === 'forgot') chain.push(...forgotLimiters());
    chain.push(guard(route.roles, sessionUser));
    chain.push(passwordGate(route));
    chain.push(staffGates(route.needs, loadCheckin));
    // Multipart parsing runs only on the photo route, after the role check, so anonymous
    // or wrong-role requests are refused before any file is read.
    if (route.upload === PHOTO) chain.push(photoUpload);
    // A webhook body is checked by signature here and by schema in its handler.
    if (route.webhook) chain.push(paystackSignature);
    else chain.push(validate({ params: route.params, query: route.query, body: route.body }));
    chain.push(wrap(stubHandlers ? (_req, res) => res.json({ ok: true }) : route.handler));
    api[route.method](route.path, ...chain);
    api.stack.at(-1).route.roles = route.roles;
  }
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use('/api', api);
  app.locals.apiRouter = api;

  // Dish photos: random names that never change, so they can be cached for a year.
  // nosniff stops a browser from treating a file as anything other than its declared type.
  app.use('/uploads', express.static(UPLOADS_ROOT, {
    maxAge: '365d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  }));

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body must be valid JSON' });
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  });

  return app;
}
