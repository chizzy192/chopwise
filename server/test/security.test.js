// HTTP security layers, tested without a database: handlers are stubbed and the
// signed-in user comes from a fixed list, so only roles, Origin, validation and limits run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-the-config-check';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit_tests_only_not_a_real_key';
const ORIGIN = process.env.CLIENT_ORIGIN;
const { createHmac } = await import('node:crypto');

// A webhook body signed the way Paystack signs it: HMAC SHA512 of the raw body with the secret key.
function signedWebhook(event, secret = process.env.PAYSTACK_SECRET_KEY) {
  const body = JSON.stringify(event);
  return { body, headers: { 'x-paystack-signature': createHmac('sha512', secret).update(body).digest('hex') } };
}

const { createApp, assertRolesDeclared } = await import('../src/app.js');
const { routes } = await import('../src/routes.js');
const { signSession, SESSION_COOKIE, PUBLIC } = await import('../src/auth.js');

// The stub staff member has done onboarding and today's check-in, so only roles decide access here.
// test/checkin.test.js covers the onboarding and check-in gates.
const USERS = {
  1: { id: 1, role: 'staff', onboarded: true }, 2: { id: 2, role: 'caterer' }, 3: { id: 3, role: 'admin' },
  4: { id: 4, role: 'caterer', mustChangePassword: true },
  5: { id: 5, role: 'staff', onboarded: true, sessionVersion: 1 }, // has reset their password once
};
const sessionUser = async (id) => (USERS[id] ? { ...USERS[id], name: 'Test', email: 't@x.ng' } : null);
const todayCheckin = async () => ({ h: 0, p1: 0, p2: 0, g: 0 });
const cookieFor = { staff: 1, caterer: 2, admin: 3, newCaterer: 4 };
const cookie = (id, ver) => `${SESSION_COOKIE}=${signSession(id, ver)}`;

// The permission table the system must keep. Changing a route's roles means changing this on purpose.
const EXPECTED = {
  'GET /health': PUBLIC,
  'POST /auth/register': PUBLIC,
  'POST /auth/login': PUBLIC,
  'POST /auth/logout': PUBLIC,
  'POST /auth/forgot-password': PUBLIC,
  'POST /auth/reset-password': PUBLIC,
  'GET /auth/me': ['staff', 'caterer', 'admin'],
  'POST /auth/change-password': ['staff', 'caterer', 'admin'],
  'GET /health-profile': ['staff'],
  'PUT /health-profile': ['staff'],
  'GET /checkin/today': ['staff'],
  'POST /checkin': ['staff'],
  'GET /meals': ['staff'],
  'GET /catalogue': ['staff'],
  'POST /cart/evaluate': ['staff'],
  'POST /orders/checkout': ['staff'],
  'POST /orders/verify': ['staff'],
  'GET /orders/mine': ['staff'],
  'GET /intake/today': ['staff'],
  'GET /orders/today': ['staff'],
  'GET /notifications': ['staff'],
  'GET /feedback/prompt': ['staff'],
  'POST /feedback/prompt/shown': ['staff'],
  'POST /feedback': ['staff'],
  'GET /caterer/dishes': ['caterer'],
  'POST /caterer/dishes': ['caterer'],
  'PUT /caterer/dishes/:id': ['caterer'],
  'PATCH /caterer/dishes/:id/availability': ['caterer'],
  'PUT /caterer/dishes/:id/photo': ['caterer'],
  'PUT /caterer/dishes/:id/stock': ['caterer'],
  'GET /caterer/orders': ['caterer'],
  'PATCH /caterer/orders/:id/status': ['caterer'],
  'POST /caterer/orders/:id/deliver': ['caterer'],
  'POST /paystack/webhook': PUBLIC,
  'GET /admin/meals': ['admin'],
  'PATCH /admin/meals/:id': ['admin'],
  'DELETE /admin/meals/:id': ['admin'],
  'GET /admin/users': ['admin'],
  'PATCH /admin/users/:id/role': ['admin'],
  'POST /admin/users/:id/unlock': ['admin'],
  'POST /admin/caterers': ['admin'],
  'POST /admin/users/:id/reset-password': ['admin'],
  'GET /admin/report': ['admin'],
  'GET /admin/settings': ['admin'],
  'PUT /admin/settings': ['admin'],
  'GET /admin/audit-log': ['admin'],
};

let server; let base;
async function start(options = {}) {
  const app = createApp({ sessionUser, todayCheckin, stubHandlers: true, ...options });
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { s, base: `http://127.0.0.1:${s.address().port}/api`, app };
}
before(async () => { ({ s: server, base } = await start()); });
after(() => server.close());

function call(path, { method = 'GET', role, body, origin = ORIGIN, headers = {}, to = base } = {}) {
  return fetch(to + path, {
    method,
    headers: {
      ...(method !== 'GET' && origin ? { Origin: origin } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(role ? { Cookie: `${SESSION_COOKIE}=${signSession(cookieFor[role])}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

test('every route declares exactly the roles in the permission table', () => {
  const actual = Object.fromEntries(routes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r.roles]));
  assert.deepEqual(actual, EXPECTED);
});

test('default-deny: the app refuses to start with a route that has no role check', () => {
  const handler = (_req, res) => res.end();
  assert.throws(() => createApp({ routes: [{ method: 'get', path: '/x', handler }] }), /must declare its roles/);
  assert.throws(() => assertRolesDeclared({ method: 'get', path: '/x', roles: [] }), /must declare its roles/);
  assert.throws(() => assertRolesDeclared({ method: 'get', path: '/x', roles: ['superadmin'] }), /must declare its roles/);
});

test('default-deny: every route mounted on the API router carries its role check', async () => {
  const { s, app } = await start();
  s.close();
  const mounted = app.locals.apiRouter.stack.filter((layer) => layer.route);
  assert.equal(mounted.length, routes.length);
  for (const layer of mounted) assert.ok(layer.route.roles, `${layer.route.path} has no roles`);
});

test('default-deny: an unknown API path returns 404, not a handler', async () => {
  assert.equal((await call('/admin/secret', { role: 'admin' })).status, 404);
});

test('role permissions: each role is allowed or denied on every route as declared', async () => {
  for (const [key, roles] of Object.entries(EXPECTED)) {
    const [method, rawPath] = key.split(' ');
    const path = rawPath.replace(':id', '1');
    for (const who of [null, 'staff', 'caterer', 'admin']) {
      // The webhook is public but only accepted with Paystack's signature (tested below).
      const signed = path === '/paystack/webhook' ? signedWebhook({ event: 'charge.success', data: { reference: 'x' } }) : {};
      const res = await call(path, { method, role: who ?? undefined, body: method === 'GET' ? undefined : (signed.body ?? {}), headers: signed.headers });
      const allowed = roles === PUBLIC || (who && roles.includes(who));
      if (allowed) {
        assert.ok(![401, 403].includes(res.status), `${key} as ${who ?? 'anonymous'} should be allowed, got ${res.status}`);
      } else {
        assert.equal(res.status, who ? 403 : 401, `${key} as ${who ?? 'anonymous'} should be denied`);
      }
    }
  }
});

test('a deleted user or tampered cookie is not signed in', async () => {
  const forged = await fetch(`${base}/auth/me`, { headers: { Cookie: `${SESSION_COOKIE}=not-a-real-token` } });
  assert.equal(forged.status, 401);
  const gone = await fetch(`${base}/auth/me`, { headers: { Cookie: `${SESSION_COOKIE}=${signSession(99)}` } });
  assert.equal(gone.status, 401);
});

test('Zod rejects unknown fields: sign-up cannot set a role', async () => {
  const res = await call('/auth/register', {
    method: 'POST', body: { name: 'Ngozi', email: 'ngozi@unn.edu.ng', password: 'long-enough-pw', confirmPassword: 'long-enough-pw', role: 'admin' },
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Unknown field: role' });
});

test('Zod rejects unknown fields on admin routes and short passwords on sign-up', async () => {
  const extra = await call('/admin/settings', { method: 'PUT', role: 'admin', body: { vatRate: 7.5, deliveryFee: 500, discount: 10 } });
  assert.equal(extra.status, 400);
  assert.deepEqual(await extra.json(), { error: 'Unknown field: discount' });
  const short = await call('/auth/register', { method: 'POST', body: { name: 'A', email: 'a@unn.edu.ng', password: 'short' } });
  assert.deepEqual(await short.json(), { error: 'Use a password of at least 10 characters' });
  const badVat = await call('/admin/settings', { method: 'PUT', role: 'admin', body: { vatRate: 150, deliveryFee: 500 } });
  assert.deepEqual(await badVat.json(), { error: 'VAT rate must be between 0% and 100%' });
});

test('Zod validates params and query strings too', async () => {
  assert.equal((await call('/admin/meals/abc', { method: 'PATCH', role: 'admin', body: { approve: true } })).status, 400);
  assert.equal((await call('/meals?debug=1', { role: 'staff' })).status, 400);
  assert.equal((await call('/admin/users?q=ada', { role: 'admin' })).status, 200);
});

test('the catalogue and order APIs no longer take the previous meals', async () => {
  // G comes from today's stored check-in, so prev1/prev2 are now unknown fields.
  const old = await call('/catalogue?prev1=1&prev2=2', { role: 'staff' });
  assert.equal(old.status, 400);
  assert.deepEqual(await old.json(), { error: 'Unknown fields: prev1, prev2' });
  assert.equal((await call('/catalogue', { role: 'staff' })).status, 200);
  const order = await call('/orders/checkout', { method: 'POST', role: 'staff', body: { lines: [{ dishId: 1, quantity: 1 }], prev1: 2, prev2: 3 } });
  assert.deepEqual(await order.json(), { error: 'Unknown fields: prev1, prev2' });
});

test('Origin check rejects cross-site state-changing requests', async () => {
  const evil = await call('/admin/settings', { method: 'PUT', role: 'admin', body: { vatRate: 0, deliveryFee: 0 }, origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const none = await call('/admin/settings', { method: 'PUT', role: 'admin', body: { vatRate: 0, deliveryFee: 0 }, origin: null });
  assert.equal(none.status, 403, 'no Origin and no Referer is refused');
  const referer = await call('/admin/settings', {
    method: 'PUT', role: 'admin', body: { vatRate: 0, deliveryFee: 0 }, origin: null, headers: { Referer: `${ORIGIN}/admin/settings` },
  });
  assert.equal(referer.status, 200, 'a Referer from the ChopWise site is accepted');
  const read = await call('/admin/settings', { role: 'admin', headers: { Origin: 'https://evil.example' } });
  assert.equal(read.status, 200, 'reads are left to CORS');
});

test('CORS only allows CLIENT_ORIGIN, with credentials', async () => {
  const ok = await call('/auth/me', { role: 'staff', headers: { Origin: ORIGIN } });
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  const evil = await call('/auth/me', { role: 'staff', headers: { Origin: 'https://evil.example' } });
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example');
});

test('security headers: CSP allows self, fonts and Paystack only', async () => {
  const res = await call('/auth/me', { role: 'staff' });
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' https:\/\/js\.paystack\.co/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('JSON bodies over 100kb are refused', async () => {
  const res = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.ng', password: 'x'.repeat(110_000) }) });
  assert.equal(res.status, 413);
});

test('login is rate-limited to 10 requests per 15 minutes per IP', async () => {
  const { s, base: fresh } = await start();
  try {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await call('/auth/login', { method: 'POST', body: { email: 'a@b.ng', password: 'x' }, to: fresh })).status);
    }
    assert.ok(statuses.slice(0, 10).every((st) => st !== 429));
    assert.equal(statuses[10], 429);
  } finally {
    s.close();
  }
});

test('webhook: a request without a valid Paystack signature is rejected', async () => {
  const event = { event: 'charge.success', data: { reference: 'CW-x', amount: 1, currency: 'NGN', status: 'success' } };
  const unsigned = await call('/paystack/webhook', { method: 'POST', body: JSON.stringify(event), origin: null });
  assert.equal(unsigned.status, 401);
  const forged = signedWebhook(event, 'sk_test_attacker_guess');
  assert.equal((await call('/paystack/webhook', { method: 'POST', body: forged.body, headers: forged.headers, origin: null })).status, 401);
  const tampered = signedWebhook(event);
  const changed = tampered.body.replace('"amount":1', '"amount":2');
  assert.equal((await call('/paystack/webhook', { method: 'POST', body: changed, headers: tampered.headers, origin: null })).status, 401);
});

test('webhook: a correctly signed event is accepted without an Origin header', async () => {
  const ok = signedWebhook({ event: 'charge.success', data: { reference: 'CW-x' } });
  assert.equal((await call('/paystack/webhook', { method: 'POST', body: ok.body, headers: ok.headers, origin: null })).status, 200);
});

test('a temporary password must be changed first: every other route answers PASSWORD_CHANGE_REQUIRED', async () => {
  for (const path of ['/caterer/dishes', '/caterer/orders']) {
    const res = await call(path, { role: 'newCaterer' });
    assert.equal(res.status, 403, path);
    assert.equal((await res.json()).code, 'PASSWORD_CHANGE_REQUIRED');
  }
  assert.equal((await call('/auth/me', { role: 'newCaterer' })).status, 200);
  const change = await call('/auth/change-password', {
    method: 'POST', role: 'newCaterer', body: { currentPassword: 'temporary-pass-1', newPassword: 'my-own-pass-123' },
  });
  assert.equal(change.status, 200);
  // A caterer without a temporary password is not affected.
  assert.equal((await call('/caterer/dishes', { role: 'caterer' })).status, 200);
});

test('change password and admin reset: new passwords need 10 characters and must differ', async () => {
  const short = await call('/auth/change-password', { method: 'POST', role: 'caterer', body: { currentPassword: 'old-pass-123', newPassword: 'short' } });
  assert.equal(short.status, 400);
  const same = await call('/auth/change-password', { method: 'POST', role: 'caterer', body: { currentPassword: 'same-pass-123', newPassword: 'same-pass-123' } });
  assert.equal(same.status, 400);
  assert.match((await same.json()).error, /different/);
  assert.equal((await call('/admin/users/2/reset-password', { method: 'POST', role: 'admin', body: { password: 'short' } })).status, 400);
  assert.equal((await call('/admin/users/2/reset-password', { method: 'POST', role: 'caterer', body: { password: 'temporary-pass-1' } })).status, 403);
});

test('confirm password: sign-up and reset refuse passwords that do not match', async () => {
  const signUp = await call('/auth/register', {
    method: 'POST', body: { name: 'Ngozi', email: 'ngozi@unn.edu.ng', password: 'long-enough-pw', confirmPassword: 'long-enough-pX' },
  });
  assert.equal(signUp.status, 400);
  assert.deepEqual(await signUp.json(), { error: "Passwords don't match" });
  const missing = await call('/auth/register', { method: 'POST', body: { name: 'Ngozi', email: 'ngozi@unn.edu.ng', password: 'long-enough-pw' } });
  assert.equal(missing.status, 400);
  const token = 'a'.repeat(64);
  const reset = await call('/auth/reset-password', { method: 'POST', body: { token, password: 'new-password-1', confirmPassword: 'new-password-2' } });
  assert.equal(reset.status, 400);
  assert.deepEqual(await reset.json(), { error: "Passwords don't match" });
  const badToken = await call('/auth/reset-password', { method: 'POST', body: { token: 'not-a-token', password: 'new-password-1', confirmPassword: 'new-password-1' } });
  assert.equal(badToken.status, 400);
  const ok = await call('/auth/reset-password', { method: 'POST', body: { token, password: 'new-password-1', confirmPassword: 'new-password-1' } });
  assert.equal(ok.status, 200, 'matching passwords pass validation');
});

test('forgot password is rate-limited: 3 per hour per email and 5 per hour per IP', async () => {
  const { s, base: fresh } = await start();
  try {
    const ask = (email) => call('/auth/forgot-password', { method: 'POST', body: { email }, to: fresh });
    for (let i = 0; i < 3; i += 1) assert.equal((await ask('ada@unn.edu.ng')).status, 200);
    const fourth = await ask('ADA@unn.edu.ng ');
    assert.equal(fourth.status, 429, 'the same email (any case or spacing) a 4th time in an hour');
    assert.match((await fourth.json()).error, /this email/);
    assert.equal((await ask('obi@unn.edu.ng')).status, 200, 'another email is still allowed');
    const sixth = await ask('eze@unn.edu.ng');
    assert.equal(sixth.status, 429, 'a 6th request from one IP in an hour');
    assert.match((await sixth.json()).error, /this device/);
  } finally { s.close(); }
});

test('a session from before a password reset is signed out', async () => {
  const old = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie(5, 0) } });
  assert.equal(old.status, 401);
  assert.match((await old.json()).error, /log in again/);
  assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: cookie(5, 1) } })).status, 200, 'a session with the new version works');
});

test('feedback is read on the admin report only: staff and caterers are refused', async () => {
  assert.equal((await call('/admin/report', { role: 'staff' })).status, 403);
  assert.equal((await call('/admin/report', { role: 'caterer' })).status, 403);
  assert.equal((await call('/admin/report')).status, 401);
  assert.equal((await call('/admin/report', { role: 'admin' })).status, 200);
  assert.equal((await call('/feedback', { method: 'POST', role: 'caterer', body: {} })).status, 403, 'only staff send feedback');
});

test('health check: GET /api/health answers 200 without a session', async () => {
  const res = await call('/health');
  assert.equal(res.status, 200);
});

test('behind the host\'s proxy (production) Express trusts exactly one hop; locally it trusts none', async () => {
  assert.equal(createApp({ stubHandlers: true }).get('trust proxy'), false);
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { assert.equal(createApp({ stubHandlers: true }).get('trust proxy'), 1); } finally { process.env.NODE_ENV = was; }
});

test('Neon\'s sslmode=require keeps full certificate checks (verify-full); other URLs are unchanged', async () => {
  const { connectionString } = await import('../src/db/pool.js');
  assert.equal(connectionString('postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require&channel_binding=require'),
    'postgresql://u:p@ep-x.neon.tech/neondb?sslmode=verify-full&channel_binding=require');
  assert.equal(connectionString('postgres://u:p@localhost:5432/chopwise'), 'postgres://u:p@localhost:5432/chopwise');
  assert.equal(connectionString(''), '');
});

test('db:setup refuses to wipe a production database unless --force is given', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['src/db/setup.js'], {
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /NODE_ENV is production, so it stopped/);
});

test('db:setup refuses to wipe a database that is not on this computer (such as Neon) unless --force is given', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['src/db/setup.js'], {
    env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@ep-example.neon.tech/neondb?sslmode=require' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /points to ep-example\.neon\.tech, not this computer, so it stopped/);
});

test('CLIENT_ORIGIN falls back to Render\'s RENDER_EXTERNAL_URL; in production one of them is required', async () => {
  const { clientOrigin } = await import('../src/config.js');
  const saved = { o: process.env.CLIENT_ORIGIN, r: process.env.RENDER_EXTERNAL_URL, n: process.env.NODE_ENV };
  try {
    delete process.env.CLIENT_ORIGIN;
    process.env.RENDER_EXTERNAL_URL = 'https://chopwise.onrender.com/';
    assert.equal(clientOrigin(), 'https://chopwise.onrender.com');
    process.env.CLIENT_ORIGIN = 'https://chopwise.example.ng';
    assert.equal(clientOrigin(), 'https://chopwise.example.ng', 'an explicit CLIENT_ORIGIN wins');
    delete process.env.CLIENT_ORIGIN; delete process.env.RENDER_EXTERNAL_URL; process.env.NODE_ENV = 'production';
    assert.throws(() => clientOrigin(), /Set CLIENT_ORIGIN .*host's environment settings/);
  } finally {
    process.env.CLIENT_ORIGIN = saved.o; process.env.NODE_ENV = saved.n;
    if (saved.r === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = saved.r;
  }
});
