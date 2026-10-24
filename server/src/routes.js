// API route table. Every route declares which roles may use it (default-deny): app.js refuses
// to start if any route is missing `roles`, and test/security.test.js checks the whole table.
import { pool, query } from './db/pool.js';
import { PUBLIC, setSessionCookie, clearSessionCookie } from './auth.js';
import { classifyMeal } from './logic/meal.js';
import { FOOD_CLASSES } from './logic/constants.js';
import { bandsFor } from './logic/engine.js';
import { checkRoleChange, HOME } from './logic/roles.js';
import { isLocked, applyFailure, applySuccess, minutesLeft, LOCK_MINUTES, MAX_FAILED_LOGINS } from './logic/lockout.js';
import { TIMEZONE, todayInLagos } from './logic/time.js';
import {
  healthParameter, healthExplanation, sourceFor, computeCheckin, canRedoCheckin, explainGate,
} from './logic/checkin.js';
import { hashPassword, verifyPassword, burnVerify } from './services/passwords.js';
import { audit } from './services/audit.js';
import {
  catalogueFor, todayIntake, rowToMeal, approvedMeals,
} from './services/diet.js';
import {
  expireReservations, evaluateCartFor, createPendingOrder, cancelOrder, applyPayment, StockError,
} from './services/orders.js';
import { initializeTransaction, verifyTransaction } from './services/paystack.js';
import { decryptCode, codeMatches } from './services/deliveryCode.js';
import { clientOrigin } from './config.js';
import {
  PAID_STATUSES, nextStatus, canAdvance, afterWrongCode, MAX_CODE_ATTEMPTS, platesLeft, stockLabel, includedWith,
} from './logic/checkout.js';
import {
  healthProfile, rowToProfile, todayCheckin, ordersOn, prefillFromHistory, mealsById,
} from './services/checkin.js';
import * as s from './http/schemas.js';
import { rdiProblem } from './http/schemas.js';
import {
  rdiOf, changedClasses, needsReapproval, isSoldOut, dishStatus, hasRdi,
} from './logic/dish.js';
import { saveDishPhoto, deleteDishPhoto } from './services/photos.js';
import {
  newResetToken, hashResetToken, resetExpiry, resetTokenUsable, RESET_MINUTES, FORGOT_MESSAGE, INVALID_LINK,
} from './services/passwordReset.js';
import { sendPasswordResetEmail } from './services/mail.js';
import { shouldShowFeedback, summariseFeedback, MAX_FEEDBACK_PROMPTS } from './logic/feedback.js';

const STAFF = ['staff'];
const CATERER = ['caterer'];
const ADMIN = ['admin'];
const SIGNED_IN = ['staff', 'caterer', 'admin'];
const BAD_LOGIN = 'Incorrect email or password';

function publicUser(u) {
  return {
    id: u.user_id ?? u.id, name: u.name, email: u.email, role: u.role,
    mustChangePassword: Boolean(u.must_change_password ?? u.mustChangePassword),
  };
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Auth ----------
async function register(req, res) {
  const { name, email, password } = req.valid.body;
  const exists = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length) return res.status(409).json({ error: 'An account with this email already exists' });
  // Self-registration always creates a staff account; the body cannot carry a role.
  const { rows } = await query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'staff') RETURNING *",
    [name, email, await hashPassword(password)],
  );
  await query('INSERT INTO health_profiles (user_id) VALUES ($1)', [rows[0].user_id]);
  setSessionCookie(res, rows[0].user_id);
  res.status(201).json({ user: publicUser(rows[0]), home: HOME.staff });
}

async function login(req, res) {
  const { email, password } = req.valid.body;
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) {
    await burnVerify(password);
    return res.status(401).json({ error: BAD_LOGIN });
  }
  const now = new Date();
  if (isLocked(user.locked_until, now)) {
    return res.status(423).json({
      error: `This account is locked after ${MAX_FAILED_LOGINS} failed logins. Try again in ${minutesLeft(user.locked_until, now)} minutes.`,
    });
  }
  const { ok, needsRehash } = await verifyPassword(user.password_hash, password);
  if (!ok) {
    await recordFailedLogin(user.user_id, now);
    return res.status(401).json({ error: BAD_LOGIN });
  }
  const reset = applySuccess();
  const newHash = needsRehash ? await hashPassword(password) : user.password_hash;
  await query(
    'UPDATE users SET failed_attempts = $1, locked_until = $2, password_hash = $3 WHERE user_id = $4',
    [reset.failedAttempts, reset.lockedUntil, newHash, user.user_id],
  );
  setSessionCookie(res, user.user_id, user.session_version);
  res.json({ user: publicUser(user), home: HOME[user.role] });
}

async function recordFailedLogin(userId, now) {
  await inTransaction(async (db) => {
    const { rows } = await db.query('SELECT email, failed_attempts FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
    const next = applyFailure({ failedAttempts: rows[0].failed_attempts }, now);
    await db.query('UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3',
      [next.failedAttempts, next.lockedUntil, userId]);
    if (next.locked) {
      await audit({
        actorId: null, action: 'account.locked', targetType: 'user', targetId: userId,
        details: { email: rows[0].email, minutes: LOCK_MINUTES },
      }, db);
    }
  });
}

// Change your own password. Clears a temporary password set by an admin.
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.valid.body;
  const { rows } = await query('SELECT * FROM users WHERE user_id = $1', [req.user.id]);
  const { ok } = await verifyPassword(rows[0].password_hash, currentPassword);
  if (!ok) return res.status(400).json({ error: 'Your current password is incorrect' });
  const hash = await hashPassword(newPassword);
  const user = await inTransaction(async (db) => {
    // A new session version signs out the user's other sessions; this one gets a fresh cookie below.
    const updated = await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE, session_version = session_version + 1
       WHERE user_id = $2 RETURNING *`, [hash, req.user.id],
    );
    await audit({
      actorId: req.user.id, action: 'password.changed', targetType: 'user', targetId: req.user.id,
      details: { email: rows[0].email, wasTemporary: rows[0].must_change_password },
    }, db);
    return updated.rows[0];
  });
  setSessionCookie(res, user.user_id, user.session_version);
  res.json({ user: publicUser(user), home: HOME[user.role] });
}

// Forgot password: always the same answer, so it never reveals whether an account exists. For a
// real account, older links are cancelled and a new single-use link is emailed (or, without SMTP,
// printed to the server console). Sending runs in the background so the reply time is the same.
async function forgotPassword(req, res) {
  const { rows } = await query('SELECT user_id, email FROM users WHERE email = $1', [req.valid.body.email]);
  if (rows.length) {
    const { user_id: userId, email } = rows[0];
    const { token, hash } = newResetToken();
    await inTransaction(async (db) => {
      await db.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await db.query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)', [userId, hash, resetExpiry()]);
    });
    const link = `${clientOrigin()}/reset-password?token=${token}`;
    sendPasswordResetEmail(email, link, RESET_MINUTES).catch((err) => console.error('Password reset email failed:', err.message));
  }
  res.json({ message: FORGOT_MESSAGE });
}

// Reset with the emailed token: used up at once, every session signed out, lockout cleared, audited.
async function resetPassword(req, res) {
  const { token, password } = req.valid.body;
  const hash = await hashPassword(password);
  const outcome = await inTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT r.reset_id, r.user_id, r.expires_at, r.used_at, u.email FROM password_resets r
       JOIN users u ON u.user_id = r.user_id WHERE r.token_hash = $1 FOR UPDATE OF r`, [hashResetToken(token)],
    );
    const row = rows[0];
    if (!row || !resetTokenUsable({ expiresAt: row.expires_at, usedAt: row.used_at })) return { status: 400, error: INVALID_LINK };
    await db.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
    await db.query(
      `UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, must_change_password = FALSE,
         session_version = session_version + 1 WHERE user_id = $2`, [hash, row.user_id],
    );
    await audit({
      actorId: row.user_id, action: 'password.reset_by_email', targetType: 'user', targetId: row.user_id, details: { email: row.email },
    }, db);
    return {};
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json({ message: 'Your password has been reset, and you have been logged out everywhere. Log in with your new password.' });
}

// For the host's health check (render.yaml): the server is up and answering.
function health(_req, res) {
  res.json({ status: 'ok' });
}

function logout(_req, res) {
  clearSessionCookie(res);
  res.status(204).end();
}

async function me(req, res) {
  const body = { user: req.user, home: HOME[req.user.role] };
  if (req.user.role === 'staff') {
    body.onboarded = req.user.onboarded;
    body.checkedInToday = Boolean(await todayCheckin(req.user.id, todayInLagos()));
  }
  res.json(body);
}

// ---------- Staff: health onboarding ----------
function profileBody(profile, checkedInToday) {
  if (!profile) return { answered: false, profile: null };
  return {
    answered: true,
    profile,
    h: healthParameter(profile),
    explanation: healthExplanation(profile),
    // H is fixed by the day's first check-in, so an edit made after it applies from tomorrow.
    appliesFrom: checkedInToday ? 'tomorrow' : 'today',
  };
}

async function getHealthProfile(req, res) {
  const date = todayInLagos();
  const [profile, checkin] = await Promise.all([healthProfile(req.user.id), todayCheckin(req.user.id, date)]);
  res.json(profileBody(profile, Boolean(checkin)));
}

async function putHealthProfile(req, res) {
  const { hasCondition, conditions, otherCondition } = req.valid.body;
  // is_controlled is no longer asked; it is always stored as FALSE.
  const { rows } = await query(
    `INSERT INTO health_profiles (user_id, has_condition, conditions, other_condition, is_controlled, answered_at, updated_at)
     VALUES ($1, $2, $3, $4, FALSE, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET has_condition = $2, conditions = $3, other_condition = $4, is_controlled = FALSE,
       answered_at = COALESCE(health_profiles.answered_at, NOW()), updated_at = NOW()
     RETURNING *`,
    [req.user.id, hasCondition, conditions, otherCondition],
  );
  const checkin = await todayCheckin(req.user.id, todayInLagos());
  res.json(profileBody(rowToProfile(rows[0]), Boolean(checkin)));
}

// ---------- Staff: daily check-in ----------
function checkinBody(row) {
  return {
    date: row.checkin_date,
    prev1: { mealId: row.prev1_meal_id, source: row.source_prev1 },
    prev2: row.prev2_meal_id === null ? null : { mealId: row.prev2_meal_id, source: row.source_prev2 },
    h: row.h, p1: row.p1, p2: row.p2, g: row.g,
    ...explainGate(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getCheckin(req, res) {
  const date = todayInLagos();
  const [row, history, ordersToday] = await Promise.all([
    todayCheckin(req.user.id, date), prefillFromHistory(req.user.id), ordersOn(req.user.id, date),
  ]);
  const meals = await mealsById([history.prev1, history.prev2, row?.prev1_meal_id, row?.prev2_meal_id]);
  res.json({
    date,
    checkin: row ? checkinBody(row) : null,
    locked: !canRedoCheckin(ordersToday),
    prefill: { prev1: meals.get(history.prev1) ?? null, prev2: meals.get(history.prev2) ?? null },
    meals: Object.fromEntries(meals),
  });
}

const CHECKIN_LOCKED = {
  error: "You've already ordered today, so today's check-in can't be changed. You can check in again tomorrow.",
  code: 'CHECKIN_LOCKED',
};

async function submitCheckin(req, res) {
  const { prev1, prev2 } = req.valid.body;
  const date = todayInLagos();
  const history = await prefillFromHistory(req.user.id);
  const meals = await mealsById([prev1.mealId, prev2.mealId]);
  // Any approved meal, or the meal the user actually ordered last even if it has since been unapproved.
  const usable = (choice, historyId) => {
    const m = meals.get(choice.mealId);
    return m && (m.isApproved || choice.mealId === historyId) ? m : null;
  };
  const mealP1 = usable(prev1, history.prev1);
  const mealP2 = usable(prev2, history.prev2);
  if (!mealP1 || !mealP2) return res.status(400).json({ error: 'Choose your last two meals from the list' });

  const outcome = await inTransaction(async (db) => {
    // Locking today's row makes a redo and an order wait for each other.
    const existing = await todayCheckin(req.user.id, date, db, { lock: true });
    if (!canRedoCheckin(await ordersOn(req.user.id, date, db))) return { locked: true };
    // H is fixed by the day's first check-in; a redo before the first order only changes the meals.
    const profile = await healthProfile(req.user.id, db);
    const h = existing ? existing.h : healthParameter(profile);
    const { p1, p2, g } = computeCheckin({ h, mealP1, mealP2 });
    const { rows } = await db.query(
      `INSERT INTO daily_checkins (user_id, checkin_date, prev1_meal_id, prev2_meal_id, source_prev1, source_prev2, h, p1, p2, g)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, checkin_date) DO UPDATE SET
         prev1_meal_id = $3, prev2_meal_id = $4, source_prev1 = $5, source_prev2 = $6, p1 = $8, p2 = $9, g = $10, updated_at = NOW()
       RETURNING *`,
      [req.user.id, date, mealP1.id, mealP2.id, sourceFor(prev1, history.prev1), sourceFor(prev2, history.prev2), h, p1, p2, g],
    );
    return { row: rows[0], redone: Boolean(existing) };
  });
  if (outcome.locked) return res.status(409).json(CHECKIN_LOCKED);
  res.status(outcome.redone ? 200 : 201).json({ checkin: checkinBody(outcome.row), redone: outcome.redone });
}

// ---------- Orders: one shape for staff, caterers and admins ----------
async function itemsFor(orderIds) {
  if (!orderIds.length) return new Map();
  const { rows } = await query('SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY item_id', [orderIds]);
  const byOrder = new Map();
  for (const r of rows) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) ?? []), r]);
  return byOrder;
}
const itemsOf = async (orderId) => (await itemsFor([orderId])).get(orderId) ?? [];

// The delivery code is decrypted only for the staff member who ordered, and only until delivery.
function orderView(r, items, { forStaff = false, forCaterer = false } = {}) {
  const awaitingDelivery = PAID_STATUSES.includes(r.status) && r.status !== 'delivered';
  return {
    id: r.order_id,
    status: r.status,
    date: r.order_date,
    orderedAt: r.ordered_at,
    paidAt: r.paid_at,
    cancelReason: r.cancel_reason,
    reservedUntil: r.status === 'pending_payment' ? r.reserved_until : null,
    catererName: r.caterer_name,
    ...(forCaterer ? { staffName: r.staff_name, nextStatus: nextStatus(r.status), codeAttemptsLeft: MAX_CODE_ATTEMPTS - r.code_attempts } : {}),
    codeLocked: r.code_locked,
    ...(forStaff ? { reference: r.paystack_reference } : {}),
    deliveryCode: forStaff && awaitingDelivery && r.code_encrypted ? decryptCode(r.code_encrypted) : null,
    items: items.map((i) => ({
      dishId: i.meal_id, name: i.name, type: i.dish_type, quantity: i.quantity, unitPriceKobo: i.unit_price_kobo, lineTotalKobo: i.line_total_kobo,
      included: includedWith({ type: i.dish_type, quantity: i.quantity }),
    })),
    breakdown: {
      subtotalKobo: r.subtotal_kobo, vatRate: r.vat_rate, vatKobo: r.vat_kobo, deliveryFeeKobo: r.delivery_fee_kobo, totalKobo: r.total_kobo,
    },
  };
}

// ---------- Staff: menu, cart, checkout and payment (need today's check-in, loaded into req.checkin by app.js) ----------
const meals = async (_req, res) => res.json(await approvedMeals());

async function catalogue(req, res) {
  await expireReservations();
  res.json(await catalogueFor(req.user.id, req.checkin, todayInLagos()));
}

// The server decides Fit, warnings, limits and totals; the client only displays them.
async function evaluateCart(req, res) {
  await expireReservations();
  const { dishes, ...cart } = await evaluateCartFor(req.user.id, req.checkin, req.valid.body.lines, todayInLagos());
  // A Restricted today line is refused here too (409), like checkout; the body still carries the
  // whole evaluation so the cart can show which line to reduce or remove.
  const restricted = cart.lines.some((l) => l.locked);
  res.status(restricted ? 409 : 200).json(restricted ? { error: cart.problems.find((p) => p.dishId)?.message ?? 'A line is restricted today', ...cart } : cart);
}

const PAYMENT_START_FAILED = "We couldn't start the payment with Paystack. Nothing was charged; try again.";

async function checkout(req, res) {
  const date = todayInLagos();
  let created;
  try {
    created = await createPendingOrder(req.user, req.valid.body.lines, date);
  } catch (err) {
    if (err instanceof StockError) return res.status(409).json({ error: err.message });
    throw err;
  }
  if (created.problems) return res.status(409).json({ error: created.problems[0].message, problems: created.problems });
  const { order } = created;
  try {
    const tx = await initializeTransaction({
      email: req.user.email, amountKobo: order.total_kobo, reference: order.paystack_reference,
      callbackUrl: `${clientOrigin()}/payment/return`, orderId: order.order_id,
    });
    res.status(201).json({ orderId: order.order_id, reference: order.paystack_reference, authorizationUrl: tx.authorization_url, order: orderView(order, await itemsOf(order.order_id)) });
  } catch (err) {
    if (!err.paystack && err.name !== 'TimeoutError') throw err;
    await inTransaction((db) => cancelOrder(db, order.order_id, 'Paystack could not start the payment'));
    res.status(502).json({ error: PAYMENT_START_FAILED });
  }
}

// After Paystack sends the staff member back. Only their own reference is accepted.
async function verifyPayment(req, res) {
  const { reference } = req.valid.body;
  const { rows } = await query('SELECT * FROM orders WHERE paystack_reference = $1 AND user_id = $2', [reference, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Order not found' });
  let tx;
  try {
    tx = await verifyTransaction(reference);
  } catch (err) {
    if (!err.paystack && err.name !== 'TimeoutError') throw err;
    return res.status(502).json({ error: "We couldn't reach Paystack to confirm the payment. Refresh this page in a moment." });
  }
  const result = await applyPayment(reference, tx, 'verify');
  const order = (await query('SELECT * FROM orders WHERE order_id = $1', [rows[0].order_id])).rows[0];
  res.json({ ...result, order: orderView(order, await itemsOf(order.order_id), { forStaff: true }) });
}

async function myOrders(req, res) {
  await expireReservations();
  const { rows } = await query(
    `SELECT o.*, u.name AS caterer_name FROM orders o JOIN users u ON u.user_id = o.caterer_id
     WHERE o.user_id = $1 ORDER BY o.ordered_at DESC LIMIT 30`, [req.user.id],
  );
  const items = await itemsFor(rows.map((r) => r.order_id));
  res.json(rows.map((r) => orderView(r, items.get(r.order_id) ?? [], { forStaff: true })));
}

async function intakeToday(req, res) {
  const intake = await todayIntake(req.user.id, todayInLagos());
  res.json({ intake, bands: bandsFor(intake) });
}

// Paid order lines for today (the intake page lists what counted towards today's intake).
async function ordersToday(req, res) {
  const { rows } = await query(
    `SELECT o.order_id, o.paid_at AS ordered_at, i.name, i.quantity FROM orders o JOIN order_items i USING (order_id)
     WHERE o.user_id = $1 AND o.order_date = $2 AND o.status = ANY($3::order_status[]) ORDER BY o.paid_at DESC, i.item_id`,
    [req.user.id, todayInLagos(), PAID_STATUSES],
  );
  res.json(rows);
}

// ---------- Paystack webhook (public, but only accepted with a valid signature: see app.js) ----------
async function paystackWebhook(req, res) {
  const parsed = s.paystackEvent.safeParse(req.paystackEvent);
  if (parsed.success && parsed.data.event === 'charge.success') {
    await applyPayment(parsed.data.data.reference, parsed.data.data, 'webhook');
  }
  // Always 200 for a correctly signed event, so Paystack doesn't keep retrying.
  res.json({ received: true });
}

async function notifications(req, res) {
  const { rows } = await query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 50', [req.user.id],
  );
  res.json(rows);
}

// ---------- Staff: feedback pop-up (CLAUDE.md item 17) ----------
async function feedbackState(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM orders WHERE user_id = $1 AND status = 'delivered') AS delivered,
            EXISTS (SELECT 1 FROM feedback WHERE user_id = $1) AS submitted,
            p.times_shown, p.shown_at_delivered
     FROM (SELECT 1) one LEFT JOIN feedback_prompts p ON p.user_id = $1`, [userId],
  );
  const s = rows[0];
  return { delivered: s.delivered, submitted: s.submitted, timesShown: s.times_shown ?? 0, shownAtDelivered: s.shown_at_delivered ?? null };
}

async function feedbackPrompt(req, res) {
  const state = await feedbackState(req.user.id);
  res.json({ show: shouldShowFeedback(state), timesShown: state.timesShown });
}

// The app calls this when it shows the pop-up. Showing it (and "Not now") postpones it to the next
// delivered order; the WHERE clause stops a second call for the same showing from counting twice.
async function feedbackShown(req, res) {
  const state = await feedbackState(req.user.id);
  if (!shouldShowFeedback(state)) return res.json({ recorded: false, timesShown: state.timesShown });
  const { rows } = await query(
    `INSERT INTO feedback_prompts (user_id, times_shown, shown_at_delivered) VALUES ($1, 1, $2)
     ON CONFLICT (user_id) DO UPDATE SET times_shown = feedback_prompts.times_shown + 1, shown_at_delivered = $2, last_shown_at = NOW()
       WHERE feedback_prompts.shown_at_delivered < $2 AND feedback_prompts.times_shown < $3
     RETURNING times_shown`, [req.user.id, state.delivered, MAX_FEEDBACK_PROMPTS],
  );
  res.json({ recorded: rows.length > 0, timesShown: rows[0]?.times_shown ?? state.timesShown });
}

async function submitFeedback(req, res) {
  const state = await feedbackState(req.user.id);
  if (state.submitted) return res.status(409).json({ error: "You've already sent your feedback. Thank you." });
  if (state.delivered < 2) return res.status(409).json({ error: 'Feedback opens after your second delivered order.' });
  const { orderingScore, guidanceScore, changedOrder, comment } = req.valid.body;
  try {
    await query(
      'INSERT INTO feedback (user_id, ordering_score, guidance_score, changed_order, comment) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, orderingScore, guidanceScore, changedOrder, comment ?? null],
    );
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: "You've already sent your feedback. Thank you." });
    throw err;
  }
  res.status(201).json({ message: 'Thank you for your feedback.' });
}

// ---------- Caterer: own dish library only ----------
// Every query is scoped by caterer_id = the signed-in caterer. Another caterer's dish is
// reported as not found, so its existence is not revealed.
const NOT_YOURS = { status: 404, error: 'Dish not found' };

function dishBody(r, today = todayInLagos()) {
  const dish = rowToMeal(r);
  const approvedValues = r.approved_values;
  return {
    ...dish,
    approvedValues,
    changedSinceApproval: hasRdi(dish.type) ? changedClasses(approvedValues, dish) : [],
    status: dishStatus({ type: dish.type, isApproved: dish.isApproved, approvedValues }),
    soldOutToday: isSoldOut(dish.soldOutOn, today),
    platesLeftToday: platesLeft(dish, today),
    stockLabel: stockLabel(dish, today),
    updatedAt: r.updated_at,
  };
}

async function ownDish(db, dishId, catererId, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM meals WHERE meal_id = $1 AND caterer_id = $2${lock ? ' FOR UPDATE' : ''}`, [dishId, catererId],
  );
  return rows[0] ?? null;
}

async function catererDishes(req, res) {
  await expireReservations(); // plates left are shown, so return expired reservations first
  const { rows } = await query('SELECT * FROM meals WHERE caterer_id = $1 ORDER BY dish_type, name', [req.user.id]);
  const today = todayInLagos();
  res.json(rows.map((r) => dishBody(r, today)));
}

async function addDish(req, res) {
  const { type, name, description, priceKobo, ...rest } = req.valid.body;
  const rdi = hasRdi(type) ? rdiOf(rest) : null;
  const classified = rdi ? classifyMeal(rdi) : { dominantClass: null, isBalanced: null };
  // A new meal or extra waits for an admin; an add-on needs no nutrition approval.
  const { rows } = await query(
    `INSERT INTO meals (caterer_id, dish_type, name, description, price_kobo, carb_percent, protein_percent, fat_percent,
       vitamin_percent, mineral_percent, dominant_class, is_balanced, is_approved)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.user.id, type, name, description ?? null, priceKobo, ...FOOD_CLASSES.map((c) => rdi?.[c] ?? null),
      classified.dominantClass, classified.isBalanced, type === 'addon'],
  );
  res.status(201).json(dishBody(rows[0]));
}

async function editDish(req, res) {
  await expireReservations(); // plates left are shown, so return expired reservations first
  const { id } = req.valid.params;
  const body = req.valid.body;
  const outcome = await inTransaction(async (db) => {
    const current = await ownDish(db, id, req.user.id, { lock: true });
    if (!current) return NOT_YOURS;
    const type = current.dish_type;
    const problem = rdiProblem(type, body);
    if (problem) return { status: 400, error: problem };
    const before = hasRdi(type) ? rdiOf(rowToMeal(current)) : null;
    const after = hasRdi(type) ? rdiOf(body) : null;
    const resubmit = needsReapproval({ type, isApproved: current.is_approved, before, after });
    const classified = after ? classifyMeal(after) : { dominantClass: null, isBalanced: null };
    const { rows } = await db.query(
      `UPDATE meals SET name = $1, description = $2, price_kobo = $3, carb_percent = $4, protein_percent = $5,
         fat_percent = $6, vitamin_percent = $7, mineral_percent = $8, dominant_class = $9, is_balanced = $10,
         is_approved = CASE WHEN $11 THEN FALSE ELSE is_approved END, updated_at = NOW()
       WHERE meal_id = $12 AND caterer_id = $13 RETURNING *`,
      [body.name, body.description ?? null, body.priceKobo, ...FOOD_CLASSES.map((c) => after?.[c] ?? null),
        classified.dominantClass, classified.isBalanced, resubmit, id, req.user.id],
    );
    if (resubmit) {
      await audit({
        actorId: req.user.id, action: 'meal.sent_for_reapproval', targetType: 'meal', targetId: id,
        details: { name: rows[0].name, changed: changedClasses(before, after) },
      }, db);
    }
    return { dish: dishBody(rows[0]), sentForApproval: resubmit };
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json(outcome);
}

async function setAvailability(req, res) {
  await expireReservations(); // plates left are shown, so return expired reservations first
  const { id } = req.valid.params;
  const today = todayInLagos();
  // Sold out is stored as today's Lagos date, so it ends by itself at midnight.
  const { rows } = await query(
    `UPDATE meals SET sold_out_on = $1, updated_at = NOW() WHERE meal_id = $2 AND caterer_id = $3 RETURNING *`,
    [req.valid.body.available ? null : today, id, req.user.id],
  );
  if (!rows.length) return res.status(404).json({ error: NOT_YOURS.error });
  res.json(dishBody(rows[0], today));
}

async function uploadDishPhoto(req, res) {
  await expireReservations(); // plates left are shown, so return expired reservations first
  const { id } = req.valid.params;
  // Check ownership before doing any image work.
  if (!(await ownDish({ query }, id, req.user.id))) return res.status(404).json({ error: NOT_YOURS.error });
  let name;
  try {
    name = await saveDishPhoto(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "That image couldn't be read. Try a different photo." });
  }
  const outcome = await inTransaction(async (db) => {
    const current = await ownDish(db, id, req.user.id, { lock: true });
    if (!current) return null;
    const { rows } = await db.query('UPDATE meals SET photo = $1, updated_at = NOW() WHERE meal_id = $2 RETURNING *', [name, id]);
    return { old: current.photo, row: rows[0] };
  });
  if (!outcome) {
    await deleteDishPhoto(name);
    return res.status(404).json({ error: NOT_YOURS.error });
  }
  // A photo change never needs re-approval. The old file goes once the new one is saved.
  await deleteDishPhoto(outcome.old);
  res.json(dishBody(outcome.row));
}

// Today's plates left (CLAUDE.md item 14). Stored with today's Lagos date, so it resets at midnight.
async function setStock(req, res) {
  await expireReservations(); // plates left are shown, so return expired reservations first
  const { id } = req.valid.params;
  const today = todayInLagos();
  const { rows } = await query(
    'UPDATE meals SET stock_date = $1, plates_left = $2, updated_at = NOW() WHERE meal_id = $3 AND caterer_id = $4 RETURNING *',
    [today, req.valid.body.platesLeft, id, req.user.id],
  );
  if (!rows.length) return res.status(404).json({ error: NOT_YOURS.error });
  res.json(dishBody(rows[0], today));
}

// Today's paid orders for this caterer's dishes.
async function catererOrders(req, res) {
  await expireReservations();
  const { rows } = await query(
    `SELECT o.*, u.name AS staff_name FROM orders o JOIN users u ON u.user_id = o.user_id
     WHERE o.caterer_id = $1 AND o.order_date = $2 AND o.status = ANY($3::order_status[])
     ORDER BY (o.status = 'delivered'), o.paid_at`, [req.user.id, todayInLagos(), PAID_STATUSES],
  );
  const items = await itemsFor(rows.map((r) => r.order_id));
  res.json(rows.map((r) => orderView(r, items.get(r.order_id) ?? [], { forCaterer: true })));
}

async function lockedCatererOrder(db, orderId, catererId) {
  const { rows } = await db.query(
    `SELECT o.*, u.name AS staff_name FROM orders o JOIN users u ON u.user_id = o.user_id
     WHERE o.order_id = $1 AND o.caterer_id = $2 FOR UPDATE OF o`, [orderId, catererId],
  );
  return rows[0] ?? null;
}

const STATUS_WORDS = { paid: 'paid', preparing: 'being prepared', out_for_delivery: 'out for delivery', delivered: 'delivered' };

async function advanceOrder(req, res) {
  const { id } = req.valid.params;
  const to = req.valid.body.status;
  const outcome = await inTransaction(async (db) => {
    const row = await lockedCatererOrder(db, id, req.user.id);
    if (!row) return { status: 404, error: 'Order not found' };
    if (!canAdvance(row.status, to)) {
      return { status: 409, error: `This order is ${STATUS_WORDS[row.status] ?? row.status}, so it can't be marked ${STATUS_WORDS[to]}.` };
    }
    const { rows } = await db.query('UPDATE orders SET status = $1, status_updated_at = NOW() WHERE order_id = $2 RETURNING *', [to, id]);
    return { row: { ...rows[0], staff_name: row.staff_name } };
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json(orderView(outcome.row, await itemsOf(id), { forCaterer: true }));
}

// Delivered needs the staff member's code. 5 wrong codes lock the order and alert the admin.
async function deliverOrder(req, res) {
  const { id } = req.valid.params;
  const outcome = await inTransaction(async (db) => {
    const row = await lockedCatererOrder(db, id, req.user.id);
    if (!row) return { status: 404, error: 'Order not found' };
    if (row.status !== 'out_for_delivery') return { status: 409, error: 'Mark the order out for delivery before entering the code.' };
    if (row.code_locked) return { status: 423, error: "This order's code is locked after 5 wrong attempts. An admin has been alerted." };
    if (codeMatches(req.valid.body.code, row.order_id, row.code_hash)) {
      const { rows } = await db.query("UPDATE orders SET status = 'delivered', status_updated_at = NOW() WHERE order_id = $1 RETURNING *", [id]);
      return { row: { ...rows[0], staff_name: row.staff_name } };
    }
    const next = afterWrongCode(row.code_attempts);
    await db.query('UPDATE orders SET code_attempts = $1, code_locked = $2 WHERE order_id = $3', [next.attempts, next.locked, id]);
    if (next.locked) {
      await audit({
        actorId: req.user.id, action: 'order.code_locked', targetType: 'order', targetId: row.order_id,
        details: { staffName: row.staff_name, attempts: next.attempts },
      }, db);
      return { status: 423, error: "That code is wrong. After 5 wrong attempts this order's code is locked and an admin has been alerted." };
    }
    return { status: 400, error: `That code is wrong. ${next.left} attempt${next.left === 1 ? '' : 's'} left.` };
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json(orderView(outcome.row, await itemsOf(id), { forCaterer: true }));
}

// ---------- Admin ----------
async function adminMeals(_req, res) {
  const { rows } = await query(
    `SELECT m.*, u.name AS caterer_name FROM meals m JOIN users u ON u.user_id = m.caterer_id
     WHERE m.dish_type <> 'addon' ORDER BY m.is_approved, m.updated_at DESC`,
  );
  const today = todayInLagos();
  res.json(rows.map((x) => ({ ...dishBody(x, today), catererName: x.caterer_name })));
}

async function approveMeal(req, res) {
  const { approve } = req.valid.body;
  const outcome = await inTransaction(async (db) => {
    const { rows: found } = await db.query('SELECT * FROM meals WHERE meal_id = $1 FOR UPDATE', [req.valid.params.id]);
    const current = found[0];
    if (!current) return { status: 404, error: 'Meal not found' };
    if (current.dish_type === 'addon') return { status: 409, error: "Add-ons don't need approval" };
    const rdi = rdiOf(rowToMeal(current));
    // Approving records the RDI values, so a later edit can be compared against them.
    const { rows } = approve
      ? await db.query(
        `UPDATE meals SET is_approved = TRUE, approved_values = $1, approved_at = NOW(), approved_by = $2
         WHERE meal_id = $3 RETURNING *`, [rdi, req.user.id, current.meal_id],
      )
      : await db.query('UPDATE meals SET is_approved = FALSE WHERE meal_id = $1 RETURNING *', [current.meal_id]);
    const action = !approve ? 'meal.unapproved' : current.approved_values ? 'meal.reapproved' : 'meal.approved';
    await audit({
      actorId: req.user.id, action, targetType: 'meal', targetId: current.meal_id,
      details: { name: current.name, ...(action === 'meal.reapproved' ? { changed: changedClasses(current.approved_values, rdi) } : {}) },
    }, db);
    return { row: rows[0] };
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json(dishBody(outcome.row));
}

async function deleteMeal(req, res) {
  const { id } = req.valid.params;
  const used = await query(
    `SELECT 1 FROM order_items WHERE meal_id = $1
     UNION ALL SELECT 1 FROM daily_checkins WHERE prev1_meal_id = $1 OR prev2_meal_id = $1 LIMIT 1`, [id],
  );
  if (used.rows.length) {
    return res.status(409).json({ error: 'This meal has been ordered or used in a check-in and cannot be deleted; unapprove it instead' });
  }
  const deleted = await inTransaction(async (db) => {
    const { rows } = await db.query('DELETE FROM meals WHERE meal_id = $1 RETURNING name, photo', [id]);
    if (rows.length) {
      await audit({ actorId: req.user.id, action: 'meal.deleted', targetType: 'meal', targetId: id, details: { name: rows[0].name } }, db);
    }
    return rows[0] ?? null;
  });
  if (!deleted) return res.status(404).json({ error: 'Meal not found' });
  await deleteDishPhoto(deleted.photo);
  res.status(204).end();
}

async function adminUsers(req, res) {
  const q = req.valid.query.q;
  const { rows } = await query(
    `SELECT user_id AS id, name, email, role, created_at, failed_attempts, locked_until, must_change_password FROM users
     WHERE $1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
     ORDER BY role, name`,
    [q || null],
  );
  const now = new Date();
  res.json(rows.map(({ must_change_password: mustChangePassword, ...u }) => ({ ...u, mustChangePassword, locked: isLocked(u.locked_until, now) })));
}

async function changeRole(req, res) {
  const { id } = req.valid.params;
  const { role: newRole } = req.valid.body;
  const outcome = await inTransaction(async (db) => {
    // Lock every admin row so two admins cannot demote each other at the same moment.
    const admins = await db.query("SELECT user_id FROM users WHERE role = 'admin' ORDER BY user_id FOR UPDATE");
    const { rows } = await db.query('SELECT user_id, name, email, role FROM users WHERE user_id = $1 FOR UPDATE', [id]);
    if (!rows.length) return { status: 404, error: 'User not found' };
    const target = { id: rows[0].user_id, role: rows[0].role };
    const problem = checkRoleChange({ actorId: req.user.id, target, newRole, adminCount: admins.rowCount });
    if (problem) return { status: 409, error: problem };
    await db.query('UPDATE users SET role = $1 WHERE user_id = $2', [newRole, id]);
    await audit({
      actorId: req.user.id, action: 'user.role_changed', targetType: 'user', targetId: id,
      details: { name: rows[0].name, email: rows[0].email, from: rows[0].role, to: newRole },
    }, db);
    return { user: publicUser({ ...rows[0], role: newRole }) };
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json(outcome.user);
}

async function unlockUser(req, res) {
  const { id } = req.valid.params;
  const user = await inTransaction(async (db) => {
    const { rows } = await db.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1 RETURNING user_id, name, email, role', [id],
    );
    if (rows.length) {
      await audit({ actorId: req.user.id, action: 'account.unlocked', targetType: 'user', targetId: id, details: { email: rows[0].email } }, db);
    }
    return rows[0];
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(user));
}

async function addCaterer(req, res) {
  const { name, email, password } = req.valid.body;
  const exists = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length) return res.status(409).json({ error: 'An account with this email already exists' });
  const hash = await hashPassword(password);
  const user = await inTransaction(async (db) => {
    const { rows } = await db.query(
      // The password is temporary: the caterer must change it at first login.
      "INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1,$2,$3,'caterer',TRUE) RETURNING *",
      [name, email, hash],
    );
    await audit({
      actorId: req.user.id, action: 'user.created', targetType: 'user', targetId: rows[0].user_id,
      details: { name, email, role: 'caterer', temporaryPassword: true },
    }, db);
    return rows[0];
  });
  res.status(201).json(publicUser(user));
}

// Gives a caterer a new temporary password (never logged). It also clears any login lockout and
// signs out the caterer's sessions.
async function resetCatererPassword(req, res) {
  const { id } = req.valid.params;
  const hash = await hashPassword(req.valid.body.password);
  const outcome = await inTransaction(async (db) => {
    const { rows } = await db.query('SELECT user_id, name, email, role FROM users WHERE user_id = $1 FOR UPDATE', [id]);
    if (!rows.length) return { status: 404, error: 'User not found' };
    if (rows[0].role !== 'caterer') return { status: 409, error: 'Only caterer passwords can be reset here' };
    const updated = await db.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL,
         session_version = session_version + 1 WHERE user_id = $2 RETURNING *`, [hash, id],
    );
    await audit({
      actorId: req.user.id, action: 'user.password_reset', targetType: 'user', targetId: id,
      details: { name: rows[0].name, email: rows[0].email, temporaryPassword: true },
    }, db);
    return { user: updated.rows[0] };
  });
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json(publicUser(outcome.user));
}

// System-wide report: orders, average intake and notifications today (Africa/Lagos day).
async function report(_req, res) {
  const date = todayInLagos();
  await expireReservations();
  const [orders, intake, notes, top] = await Promise.all([
    // Paid orders and revenue by the Lagos day they were paid; cancellations by the day they were cancelled.
    query(
      `SELECT COUNT(*) FILTER (WHERE status = ANY($3::order_status[]) AND (paid_at AT TIME ZONE $1)::date = $2)::int AS paid,
              COALESCE(SUM(total_kobo) FILTER (WHERE status = ANY($3::order_status[]) AND (paid_at AT TIME ZONE $1)::date = $2), 0)::int AS revenue,
              COUNT(*) FILTER (WHERE status = 'cancelled' AND (cancelled_at AT TIME ZONE $1)::date = $2)::int AS cancelled
       FROM orders`, [TIMEZONE, date, PAID_STATUSES],
    ),
    query(`SELECT AVG(carb_total) AS carb, AVG(protein_total) AS protein, AVG(fat_total) AS fat,
             AVG(vitamin_total) AS vitamin, AVG(mineral_total) AS mineral, COUNT(*)::int AS users
           FROM session_intake WHERE session_date = $1`, [date]),
    query(`SELECT intake_level, COUNT(*)::int AS n FROM notifications
           WHERE (issued_at AT TIME ZONE $1)::date = $2 GROUP BY intake_level`, [TIMEZONE, date]),
    query(`SELECT i.name, SUM(i.quantity)::int AS n FROM order_items i JOIN orders o USING (order_id)
           WHERE o.status = ANY($1::order_status[]) AND i.dish_type = 'meal' GROUP BY i.name ORDER BY n DESC LIMIT 5`, [PAID_STATUSES]),
  ]);
  const avg = intake.rows[0];
  // Feedback: comments are read here by admins only and never shown anywhere else.
  const fb = await query('SELECT ordering_score, guidance_score, changed_order, comment, created_at FROM feedback ORDER BY created_at DESC');
  const feedback = summariseFeedback(fb.rows.map((x) => ({ orderingScore: x.ordering_score, guidanceScore: x.guidance_score, changedOrder: x.changed_order })));
  feedback.latestComments = fb.rows.filter((x) => x.comment).slice(0, 10).map((x) => ({ comment: x.comment, createdAt: x.created_at }));
  res.json({
    feedback,
    ordersToday: orders.rows[0].paid,
    revenueTodayKobo: orders.rows[0].revenue,
    cancelledToday: orders.rows[0].cancelled,
    activeUsers: avg.users,
    averageIntake: Object.fromEntries(FOOD_CLASSES.map((c) => [c, Math.round((avg[c] || 0) * 10) / 10])),
    notifications: Object.fromEntries(notes.rows.map((x) => [x.intake_level, x.n])),
    topMeals: top.rows,
  });
}

const settingsRow = (r) => ({
  vatRate: r.vat_rate, deliveryFee: r.delivery_fee, updatedAt: r.updated_at, updatedBy: r.updated_by_name ?? null,
});

async function getSettings(_req, res) {
  const { rows } = await query(
    `SELECT s.*, u.name AS updated_by_name FROM settings s LEFT JOIN users u ON u.user_id = s.updated_by WHERE s.setting_id = 1`,
  );
  res.json(settingsRow(rows[0]));
}

async function putSettings(req, res) {
  const { vatRate, deliveryFee } = req.valid.body;
  const row = await inTransaction(async (db) => {
    const before = (await db.query('SELECT vat_rate, delivery_fee FROM settings WHERE setting_id = 1 FOR UPDATE')).rows[0];
    const { rows } = await db.query(
      `UPDATE settings SET vat_rate = $1, delivery_fee = $2, updated_by = $3, updated_at = NOW()
       WHERE setting_id = 1 RETURNING *`, [vatRate, deliveryFee, req.user.id],
    );
    await audit({
      actorId: req.user.id, action: 'settings.updated', targetType: 'settings', targetId: 1,
      details: { from: { vatRate: before.vat_rate, deliveryFee: before.delivery_fee }, to: { vatRate, deliveryFee } },
    }, db);
    return rows[0];
  });
  res.json(settingsRow({ ...row, updated_by_name: req.user.name }));
}

async function auditLog(req, res) {
  const limit = req.valid.query.limit ?? 100;
  const { rows } = await query(
    `SELECT a.audit_id AS id, a.action, a.target_type, a.target_id, a.details, a.created_at, u.name AS actor_name
     FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
     ORDER BY a.created_at DESC, a.audit_id DESC LIMIT $1`, [limit],
  );
  res.json(rows);
}

const AUTH_LIMIT = 'auth';
const FORGOT_LIMIT = 'forgot';
export const ONBOARDED = 'onboarding';
export const CHECKED_IN = 'checkin';
export const PHOTO = 'photo';
export const WEBHOOK_PATH = '/paystack/webhook';

export const routes = [
  { method: 'get', path: '/health', roles: PUBLIC, handler: health },
  { method: 'post', path: '/auth/register', roles: PUBLIC, limit: AUTH_LIMIT, body: s.registerBody, handler: register },
  { method: 'post', path: '/auth/login', roles: PUBLIC, limit: AUTH_LIMIT, body: s.loginBody, handler: login },
  { method: 'post', path: '/auth/logout', roles: PUBLIC, handler: logout },
  // 'forgot': 5 per hour per IP and 3 per hour per email (app.js).
  { method: 'post', path: '/auth/forgot-password', roles: PUBLIC, limit: FORGOT_LIMIT, body: s.forgotPasswordBody, handler: forgotPassword },
  { method: 'post', path: '/auth/reset-password', roles: PUBLIC, limit: AUTH_LIMIT, body: s.resetPasswordBody, handler: resetPassword },
  // passwordChange: open while a temporary password is still to be changed (app.js).
  { method: 'get', path: '/auth/me', roles: SIGNED_IN, passwordChange: true, handler: me },
  {
    method: 'post', path: '/auth/change-password', roles: SIGNED_IN, limit: AUTH_LIMIT, passwordChange: true, body: s.changePasswordBody, handler: changePassword,
  },

  // Staff routes: `needs` adds the onboarding and check-in gates (app.js) on top of the role check.
  { method: 'get', path: '/health-profile', roles: STAFF, handler: getHealthProfile },
  { method: 'put', path: '/health-profile', roles: STAFF, body: s.healthProfileBody, handler: putHealthProfile },
  { method: 'get', path: '/checkin/today', roles: STAFF, needs: [ONBOARDED], handler: getCheckin },
  { method: 'post', path: '/checkin', roles: STAFF, needs: [ONBOARDED], body: s.checkinBody, handler: submitCheckin },
  { method: 'get', path: '/meals', roles: STAFF, needs: [ONBOARDED], handler: meals },
  { method: 'get', path: '/catalogue', roles: STAFF, needs: [ONBOARDED, CHECKED_IN], handler: catalogue },
  { method: 'post', path: '/cart/evaluate', roles: STAFF, needs: [ONBOARDED, CHECKED_IN], body: s.cartBody, handler: evaluateCart },
  { method: 'post', path: '/orders/checkout', roles: STAFF, needs: [ONBOARDED, CHECKED_IN], body: s.cartBody, handler: checkout },
  { method: 'post', path: '/orders/verify', roles: STAFF, needs: [ONBOARDED], body: s.verifyBody, handler: verifyPayment },
  { method: 'get', path: '/orders/mine', roles: STAFF, needs: [ONBOARDED], handler: myOrders },
  { method: 'get', path: '/intake/today', roles: STAFF, needs: [ONBOARDED], handler: intakeToday },
  { method: 'get', path: '/orders/today', roles: STAFF, needs: [ONBOARDED], handler: ordersToday },
  { method: 'get', path: '/notifications', roles: STAFF, needs: [ONBOARDED], handler: notifications },
  { method: 'get', path: '/feedback/prompt', roles: STAFF, needs: [ONBOARDED], handler: feedbackPrompt },
  { method: 'post', path: '/feedback/prompt/shown', roles: STAFF, needs: [ONBOARDED], handler: feedbackShown },
  { method: 'post', path: '/feedback', roles: STAFF, needs: [ONBOARDED], body: s.feedbackBody, handler: submitFeedback },

  { method: 'get', path: '/caterer/dishes', roles: CATERER, handler: catererDishes },
  { method: 'post', path: '/caterer/dishes', roles: CATERER, body: s.dishCreateBody, handler: addDish },
  { method: 'put', path: '/caterer/dishes/:id', roles: CATERER, params: s.idParams, body: s.dishEditBody, handler: editDish },
  {
    method: 'patch', path: '/caterer/dishes/:id/availability', roles: CATERER, params: s.idParams, body: s.availabilityBody, handler: setAvailability,
  },
  { method: 'put', path: '/caterer/dishes/:id/photo', roles: CATERER, params: s.idParams, upload: PHOTO, handler: uploadDishPhoto },
  { method: 'put', path: '/caterer/dishes/:id/stock', roles: CATERER, params: s.idParams, body: s.stockBody, handler: setStock },
  { method: 'get', path: '/caterer/orders', roles: CATERER, handler: catererOrders },
  { method: 'patch', path: '/caterer/orders/:id/status', roles: CATERER, params: s.idParams, body: s.statusBody, handler: advanceOrder },
  { method: 'post', path: '/caterer/orders/:id/deliver', roles: CATERER, params: s.idParams, body: s.codeBody, handler: deliverOrder },

  // Paystack calls this, so it is public; app.js accepts it only with a valid x-paystack-signature.
  { method: 'post', path: '/paystack/webhook', roles: PUBLIC, webhook: true, handler: paystackWebhook },

  { method: 'get', path: '/admin/meals', roles: ADMIN, handler: adminMeals },
  { method: 'patch', path: '/admin/meals/:id', roles: ADMIN, params: s.idParams, body: s.approveBody, handler: approveMeal },
  { method: 'delete', path: '/admin/meals/:id', roles: ADMIN, params: s.idParams, handler: deleteMeal },
  { method: 'get', path: '/admin/users', roles: ADMIN, query: s.userSearchQuery, handler: adminUsers },
  { method: 'patch', path: '/admin/users/:id/role', roles: ADMIN, params: s.idParams, body: s.roleBody, handler: changeRole },
  { method: 'post', path: '/admin/users/:id/unlock', roles: ADMIN, params: s.idParams, handler: unlockUser },
  { method: 'post', path: '/admin/caterers', roles: ADMIN, body: s.catererBody, handler: addCaterer },
  {
    method: 'post', path: '/admin/users/:id/reset-password', roles: ADMIN, params: s.idParams, body: s.adminResetPasswordBody, handler: resetCatererPassword,
  },
  { method: 'get', path: '/admin/report', roles: ADMIN, handler: report },
  { method: 'get', path: '/admin/settings', roles: ADMIN, handler: getSettings },
  { method: 'put', path: '/admin/settings', roles: ADMIN, body: s.settingsBody, handler: putSettings },
  { method: 'get', path: '/admin/audit-log', roles: ADMIN, query: s.auditQuery, handler: auditLog },
];
