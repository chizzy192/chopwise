// Health onboarding, daily check-in and the Africa/Lagos day. The rules are pure functions;
// the gates are tested over HTTP with stubbed users and handlers (no database).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  healthParameter, healthExplanation, prefill, sourceFor, computeCheckin, canRedoCheckin, explainGate,
} from '../src/logic/checkin.js';
import { todayInLagos, addDays } from '../src/logic/time.js';
import { healthProfileBody, checkinBody } from '../src/http/schemas.js';

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-the-config-check';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
const { createApp } = await import('../src/app.js');
const { signSession, SESSION_COOKIE } = await import('../src/auth.js');

// Seed meals (% of daily RDI per serving).
const jollof = { id: 1, carb: 48, protein: 22, fat: 18, vitamin: 7, mineral: 5 };
const whiteRice = { id: 2, carb: 52, protein: 12, fat: 20, vitamin: 6, mineral: 4 };
const fruit = { id: 3, carb: 18, protein: 3, fat: 1, vitamin: 38, mineral: 15 };
const moiMoi = { id: 4, carb: 22, protein: 24, fat: 10, vitamin: 8, mineral: 7 };

// ---------- Africa/Lagos day ----------
test('Lagos midnight: 23:30 UTC is 00:30 the next day in Lagos', () => {
  assert.equal(todayInLagos(new Date('2026-10-23T23:30:00Z')), '2026-10-24');
});

test('Lagos midnight: the date changes exactly at 23:00 UTC (Lagos is UTC+1 all year)', () => {
  assert.equal(todayInLagos(new Date('2026-10-23T22:59:59Z')), '2026-10-23');
  assert.equal(todayInLagos(new Date('2026-10-23T23:00:00Z')), '2026-10-24');
  assert.equal(todayInLagos(new Date('2026-12-31T23:15:00Z')), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

// ---------- Health onboarding ----------
test('H: No → 0, Yes (any declared diet-related condition) → 1', () => {
  assert.equal(healthParameter({ hasCondition: false }), 0);
  assert.equal(healthParameter({ hasCondition: true }), 1);
});

test('each answer gets a one-line explanation in plain words (health check yes or no)', () => {
  assert.match(healthExplanation({ hasCondition: false }), /^Health check: no\. With no diet-related condition/);
  assert.match(healthExplanation({ hasCondition: true }), /^Health check: yes\. Because you have a diet-related condition/);
  for (const p of [{ hasCondition: false }, { hasCondition: true }]) {
    assert.doesNotMatch(healthExplanation(p), /RDI|H = /, 'no technical terms on staff pages');
  }
});

test('onboarding answer: Yes needs a condition; there is no well-controlled question', () => {
  const missingCondition = healthProfileBody.safeParse({ hasCondition: true });
  assert.equal(missingCondition.error.issues[0].message, 'Tick at least one condition, or describe it under Other');
  assert.deepEqual(healthProfileBody.parse({ hasCondition: true, conditions: ['Diabetes'] }), { hasCondition: true, conditions: ['Diabetes'], otherCondition: null });
  const other = healthProfileBody.parse({ hasCondition: true, otherCondition: ' Gout ' });
  assert.deepEqual(other, { hasCondition: true, conditions: [], otherCondition: 'Gout' });
  assert.equal(healthProfileBody.safeParse({ hasCondition: true, conditions: ['Flu'] }).success, false);
  assert.equal(healthProfileBody.safeParse({ hasCondition: true, conditions: ['Diabetes'], isControlled: true }).success, false, 'the old field is refused');
});

test('onboarding answer: No clears any conditions', () => {
  assert.deepEqual(
    healthProfileBody.parse({ hasCondition: false, conditions: ['Diabetes'] }),
    { hasCondition: false, conditions: [], otherCondition: null },
  );
});

// ---------- Daily check-in ----------
test('pre-fill takes the two most recent order lines, most recent first', () => {
  assert.deepEqual(prefill([1, 2, 3]), { prev1: 1, prev2: 2 });
  assert.deepEqual(prefill([7]), { prev1: 7, prev2: null });
});

test('pre-fill with no order history leaves both meals empty', () => {
  assert.deepEqual(prefill([]), { prev1: null, prev2: null });
});

test('source: history when the pre-filled meal is kept, manual when changed or eaten elsewhere', () => {
  assert.equal(sourceFor({ mealId: 1, ateElsewhere: false }, 1), 'history');
  assert.equal(sourceFor({ mealId: 2, ateElsewhere: false }, 1), 'manual');
  assert.equal(sourceFor({ mealId: 1, ateElsewhere: true }, 1), 'manual', 'eaten elsewhere, closest match happens to be the same');
  assert.equal(sourceFor({ mealId: 1, ateElsewhere: false }, null), 'manual', 'no history');
});

test('check-in computes H, P1, P2 and G with the existing gate (older meal applied first)', () => {
  // Chapter 4 T7: H = 1, last meal Jollof, before that White rice → P2 = 0, P1 = 1, G = 1.
  assert.deepEqual(computeCheckin({ h: 1, mealP1: jollof, mealP2: whiteRice }), { h: 1, p1: 1, p2: 0, g: 1 });
  // T6: H = 0, Fruit platter then Moi moi → nothing above 70%, G = 0.
  assert.deepEqual(computeCheckin({ h: 0, mealP1: fruit, mealP2: moiMoi }), { h: 0, p1: 0, p2: 0, g: 0 });
  // Same meals, no condition: one risky check is not a majority.
  assert.equal(computeCheckin({ h: 0, mealP1: jollof, mealP2: whiteRice }).g, 0);
});

test('check-in body: both meals are required and unknown fields are rejected', () => {
  assert.equal(checkinBody.safeParse({ prev1: { mealId: 1 } }).success, false);
  assert.deepEqual(checkinBody.parse({ prev1: { mealId: 1 }, prev2: { mealId: '2', ateElsewhere: true } }),
    { prev1: { mealId: 1, ateElsewhere: false }, prev2: { mealId: 2, ateElsewhere: true } });
  assert.equal(checkinBody.safeParse({ prev1: { mealId: 1 }, prev2: { mealId: 2 }, g: 0 }).success, false, 'G cannot be sent in');
});

test('the check-in can be redone until the first order of the day, then it is locked', () => {
  assert.equal(canRedoCheckin(0), true);
  assert.equal(canRedoCheckin(1), false);
});

test("today's result explains which checks found a risk", () => {
  const full = explainGate({ h: 1, p1: 1, p2: 0, g: 1 });
  assert.equal(full.title, 'Firm guidance today');
  assert.match(full.reason, /health profile .* and your last two meals together/);
  const one = explainGate({ h: 1, p1: 0, p2: 0, g: 0 });
  assert.equal(one.title, 'Gentle guidance today');
  assert.match(one.reason, /^Only one check found a risk/);
  assert.match(explainGate({ h: 0, p1: 0, p2: 0, g: 0 }).reason, /^None of the three checks/);
});

// ---------- Gates over HTTP ----------
const ORIGIN = process.env.CLIENT_ORIGIN;
const USERS = {
  1: { id: 1, role: 'staff', onboarded: false }, // signed up, has not answered the health question
  2: { id: 2, role: 'staff', onboarded: true }, // answered, not checked in today
  3: { id: 3, role: 'staff', onboarded: true }, // answered and checked in
  4: { id: 4, role: 'admin' },
};
const CHECKINS = { 3: { h: 1, p1: 1, p2: 0, g: 1 } };
let server; let base;
before(async () => {
  const app = createApp({
    stubHandlers: true,
    sessionUser: async (id) => USERS[id] && { ...USERS[id], name: 'T', email: 't@x.ng' },
    todayCheckin: async (id) => CHECKINS[id] ?? null,
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const call = (path, userId, { method = 'GET', body } = {}) => fetch(base + path, {
  method,
  headers: {
    Cookie: `${SESSION_COOKIE}=${signSession(userId)}`,
    ...(method !== 'GET' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
});

const STAFF_PAGES = ['/meals', '/catalogue', '/intake/today', '/orders/today', '/orders/mine', '/notifications', '/checkin/today'];

test('onboarding blocks every staff route until the health question is answered', async () => {
  for (const path of STAFF_PAGES) {
    const res = await call(path, 1);
    assert.equal(res.status, 403, path);
    assert.equal((await res.json()).code, 'ONBOARDING_REQUIRED', path);
  }
  const order = await call('/orders/checkout', 1, { method: 'POST', body: { lines: [{ dishId: 1, quantity: 1 }] } });
  assert.equal((await order.json()).code, 'ONBOARDING_REQUIRED');
});

test('onboarding leaves the health profile and account routes open', async () => {
  assert.equal((await call('/health-profile', 1)).status, 200);
  assert.equal((await call('/health-profile', 1, { method: 'PUT', body: { hasCondition: false } })).status, 200);
  assert.equal((await call('/auth/me', 1)).status, 200);
});

test('ordering needs today\'s check-in; other staff pages do not', async () => {
  for (const [path, opts] of [['/catalogue', {}], ['/cart/evaluate', { method: 'POST', body: { lines: [{ dishId: 1, quantity: 1 }] } }], ['/orders/checkout', { method: 'POST', body: { lines: [{ dishId: 1, quantity: 1 }] } }]]) {
    const res = await call(path, 2, opts);
    assert.equal(res.status, 403, path);
    assert.equal((await res.json()).code, 'CHECKIN_REQUIRED', path);
  }
  for (const path of ['/meals', '/intake/today', '/orders/today', '/orders/mine', '/notifications', '/checkin/today']) {
    assert.equal((await call(path, 2)).status, 200, path);
  }
  assert.equal((await call('/checkin', 2, { method: 'POST', body: { prev1: { mealId: 1 }, prev2: { mealId: 2 } } })).status, 200);
});

test('a checked-in staff member can order, and the gates never apply to other roles', async () => {
  assert.equal((await call('/catalogue', 3)).status, 200);
  assert.equal((await call('/orders/checkout', 3, { method: 'POST', body: { lines: [{ dishId: 1, quantity: 1 }] } })).status, 200);
  assert.equal((await call('/admin/settings', 4)).status, 200);
});
