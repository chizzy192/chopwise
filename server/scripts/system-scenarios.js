// System test scenarios for Chapter 4.3. Run after `npm run db:setup`:
//   node scripts/system-scenarios.js
// The script starts its own copy of the API on a free port, talking to a local mock of Paystack,
// so it never calls the real Paystack API and doesn't use up the dev server's login rate limit.
import http from 'node:http';
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { pool } from '../src/db/pool.js';
import { todayInLagos, addDays } from '../src/logic/time.js';

// ---------- Mock Paystack (same paths, auth header and response shape as the real API) ----------
const SECRET = process.env.PAYSTACK_SECRET_KEY;
const paystack = new Map(); // reference → transaction as Paystack would report it
const mock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== `Bearer ${SECRET}`) return send(401, { status: false, message: 'Invalid key' });
  if (req.method === 'POST' && req.url === '/transaction/initialize') {
    const b = JSON.parse(raw);
    paystack.set(b.reference, { reference: b.reference, amount: b.amount, currency: b.currency, status: 'abandoned', customer: { email: b.email } });
    return send(200, { status: true, message: 'Authorization URL created', data: { authorization_url: `https://checkout.paystack.com/mock-${b.reference}`, access_code: 'mock', reference: b.reference } });
  }
  const verify = req.url.match(/^\/transaction\/verify\/(.+)$/);
  const tx = verify && paystack.get(decodeURIComponent(verify[1]));
  if (req.method === 'GET' && tx) return send(200, { status: true, message: 'Verification successful', data: tx });
  return send(404, { status: false, message: 'Transaction reference not found' });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
process.env.PAYSTACK_API_URL = `http://127.0.0.1:${mock.address().port}`;

// The staff member completes (or fails) payment on the mock Paystack page.
const payOnPaystack = (reference, over = {}) => Object.assign(paystack.get(reference), { status: 'success', ...over });
const signWebhook = (event, secret = SECRET) => {
  const body = JSON.stringify(event);
  return { body, signature: createHmac('sha512', secret).update(body).digest('hex') };
};

// Without SMTP the server prints each reset link to the console; the scenarios read it from there.
delete process.env.SMTP_HOST;
const mailbox = [];
const consoleLog = console.log;
console.log = (...args) => {
  const link = String(args[0] ?? '').match(/for (\S+): \S+\/reset-password\?token=([0-9a-f]{64})/);
  if (link) mailbox.push({ email: link[1], token: link[2] });
  else consoleLog(...args);
};
const lastLink = (email) => mailbox.filter((m) => m.email === email).at(-1)?.token;

const { createApp } = await import('../src/app.js');
const apiServer = createApp().listen(0, '127.0.0.1');
await new Promise((resolve) => apiServer.once('listening', resolve));
const BASE = `http://127.0.0.1:${apiServer.address().port}/api`;
const ORIGIN = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
const COOKIE = 'chopwise_session';
const DEMO_PASSWORD = 'password123';
const results = [];

async function call(path, { method = 'GET', body, cookie, origin = ORIGIN, base = BASE } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' && origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
  return { status: res.status, data: await res.json().catch(() => null), cookie: setCookie?.split(';')[0], setCookie };
}
const login = (email, password = DEMO_PASSWORD) => call('/auth/login', { method: 'POST', body: { email, password } });
function record(id, description, input, expected, actual, pass) {
  results.push({ id, description, input, expected, actual, result: pass ? 'Pass' : 'Fail' });
}
const hashOf = async (email) => (await pool.query('SELECT password_hash FROM users WHERE email = $1', [email])).rows[0].password_hash;

// Cart → checkout → (mock) payment → verify, as a staff member's browser would.
const checkoutCart = (cookie, lines, origin) => call('/orders/checkout', { method: 'POST', cookie, body: { lines }, origin });
async function buy(cookie, lines) {
  const checkout = await checkoutCart(cookie, lines);
  if (checkout.status !== 201) return { checkout };
  payOnPaystack(checkout.data.reference);
  const verify = await call('/orders/verify', { method: 'POST', cookie, body: { reference: checkout.data.reference } });
  return { checkout, verify, order: verify.data?.order };
}
const one = (dishId) => [{ dishId, quantity: 1 }];
const intakeOf = async (cookie) => (await call('/intake/today', { cookie })).data.intake;

// Give the demo staff account an old bcrypt hash, as an account from before Argon2id would have.
await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [await bcrypt.hash(DEMO_PASSWORD, 10), 'staff@chopwise.ng']);

// ---------- Authentication (logins 1–3 of 10) ----------
let r = await login('staff@chopwise.ng');
const staff = r.cookie;
const staffMe = (await call('/auth/me', { cookie: staff })).data;
record('T1', 'Log in with valid details', 'staff@chopwise.ng, correct password', 'Session cookie set; /auth/me confirms staff',
  `HTTP ${r.status}; httpOnly=${/HttpOnly/i.test(r.setCookie ?? '')}; role=${staffMe?.user.role}`,
  r.status === 200 && /HttpOnly/i.test(r.setCookie ?? '') && /SameSite=Lax/i.test(r.setCookie ?? '') && staffMe?.user.role === 'staff');

const rehashed = await hashOf('staff@chopwise.ng');
record('T15', 'Old bcrypt password is upgraded on login', 'staff@chopwise.ng stored with a bcrypt hash', 'Hash replaced with Argon2id',
  `Stored hash now starts ${rehashed.slice(0, 10)}`, rehashed.startsWith('$argon2id$'));

r = await login(process.env.CATERER_EMAIL, process.env.CATERER_PASSWORD);
const caterer = r.cookie;
const catererHome = r.data?.home;
r = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
const admin = r.cookie;
const adminHome = r.data?.home;
const adminMe = (await call('/auth/me', { cookie: admin })).data?.user;
record('T16', 'Each role lands on its own page', 'Log in as staff, caterer and the .env admin (no role picker)',
  'staff → /order, caterer → /caterer, admin → /admin/meals',
  `staff → ${staffMe?.home}, caterer → ${catererHome}, admin → ${adminHome}`,
  staffMe?.home === '/order' && catererHome === '/caterer' && adminHome === '/admin/meals');

// ---------- Registration ----------
const newEmail = `scenario.${Date.now()}@chopwise.ng`;
const newPassword = 'scenario-pass-123';
r = await call('/auth/register', { method: 'POST', body: { name: 'Scenario Staff', email: newEmail, password: newPassword, confirmPassword: newPassword } });
const newStaff = r.cookie;
r = await call('/auth/register', { method: 'POST', body: { name: 'Sneaky', email: `x.${Date.now()}@chopwise.ng`, password: newPassword, confirmPassword: newPassword, role: 'admin' } });
record('T17', 'Sign-up tries to choose a role', 'Register with role = admin', 'Rejected; only staff can self-register',
  `HTTP ${r.status}: ${r.data?.error}`, r.status === 400 && r.data?.error === 'Unknown field: role');

// T75: the server checks that the two passwords match, whatever the browser does.
r = await call('/auth/register', { method: 'POST', body: { name: 'Typo', email: `typo.${Date.now()}@chopwise.ng`, password: newPassword, confirmPassword: `${newPassword}x` } });
record('T75', 'Sign-up with passwords that do not match', 'password "scenario-pass-123", confirm "scenario-pass-123x"', "Refused: \"Passwords don't match\"; no account created",
  `HTTP ${r.status}: ${r.data?.error}`, r.status === 400 && r.data?.error === "Passwords don't match");

// ---------- Health onboarding (new staff account) ----------
const today = todayInLagos();
const blocked = await call('/meals', { cookie: newStaff });
const blockedCheckin = await call('/checkin/today', { cookie: newStaff });
const newMe = (await call('/auth/me', { cookie: newStaff })).data;
record('T27', 'New staff member skips onboarding', 'GET /meals and /checkin/today before answering the health question',
  'Refused with ONBOARDING_REQUIRED', `HTTP ${blocked.status} ${blocked.data?.code}; ${blockedCheckin.data?.code}; onboarded=${newMe?.onboarded}`,
  blocked.status === 403 && blocked.data?.code === 'ONBOARDING_REQUIRED' && blockedCheckin.data?.code === 'ONBOARDING_REQUIRED' && newMe?.onboarded === false);

r = await call('/health-profile', { method: 'PUT', cookie: newStaff, body: { hasCondition: false } });
const opened = await call('/meals', { cookie: newStaff });
record('T28', 'Answer the health question: No', 'hasCondition = false', 'H = 0 explained; staff pages open',
  `H = ${r.data?.h}; "${r.data?.explanation}"; /meals HTTP ${opened.status}`,
  r.status === 200 && r.data?.h === 0 && r.data?.answered && opened.status === 200);

const meals = opened.data;
const id = (prefix) => meals.find((m) => m.name.startsWith(prefix)).id;

// ---------- Daily check-in with no order history ----------
r = await call('/catalogue', { cookie: newStaff });
const earlyCheckout = await checkoutCart(newStaff, one(meals[0].id));
record('T29', 'Order before checking in', 'GET /catalogue and POST /orders/checkout with no check-in today', 'Both refused with CHECKIN_REQUIRED',
  `Catalogue HTTP ${r.status} ${r.data?.code}; checkout HTTP ${earlyCheckout.status} ${earlyCheckout.data?.code}`,
  r.status === 403 && r.data?.code === 'CHECKIN_REQUIRED' && earlyCheckout.status === 403 && earlyCheckout.data?.code === 'CHECKIN_REQUIRED');

r = await call('/checkin/today', { cookie: newStaff });
record('T30', 'Check-in pre-fill with no order history', 'New account, no orders', 'Both meals start empty',
  `prev1 = ${r.data?.prefill.prev1}, prev2 = ${r.data?.prefill.prev2}`, r.data?.prefill.prev1 === null && r.data?.prefill.prev2 === null && r.data?.checkin === null);

// ---------- Generic message, lockout and rate limit (logins 4–11) ----------
const unknown = await login('nobody@chopwise.ng', 'whatever-password');
r = await login(newEmail, 'wrong-password-1');
record('T2', 'Log in with wrong password or unknown email', 'Wrong password; then an email with no account',
  'Same message for both, access denied', `"${r.data?.error}" / "${unknown.data?.error}"`,
  r.status === 401 && unknown.status === 401 && r.data?.error === 'Incorrect email or password' && unknown.data?.error === r.data?.error);
for (let i = 2; i <= 5; i += 1) await login(newEmail, `wrong-password-${i}`);
r = await login(newEmail, newPassword);
record('T18', 'Account locks after 5 failed logins', '5 wrong passwords, then the correct one', 'Locked for 15 minutes, even with the right password',
  `HTTP ${r.status}: ${r.data?.error}`, r.status === 423);
r = await login('staff@chopwise.ng');
record('T19', 'Login rate limit', '11th login attempt from one IP within 15 minutes', 'Refused with HTTP 429',
  `HTTP ${r.status}: ${r.data?.error}`, r.status === 429);

let log = (await call('/admin/audit-log', { cookie: admin })).data;
const lockEntry = log.find((e) => e.action === 'account.locked' && e.details.email === newEmail);
const lockedUser = (await call(`/admin/users?q=${encodeURIComponent(newEmail)}`, { cookie: admin })).data[0];
r = await call(`/admin/users/${lockedUser.id}/unlock`, { method: 'POST', cookie: admin });
const unlocked = (await call(`/admin/users?q=${encodeURIComponent(newEmail)}`, { cookie: admin })).data[0];
record('T20', 'Lockout is audited and an admin can unlock', 'Admin opens the audit log, then unlocks the account',
  'Lockout entry in the log; account unlocked', `Logged: ${Boolean(lockEntry)}; locked before ${lockedUser.locked}, after ${unlocked.locked}`,
  Boolean(lockEntry) && lockedUser.locked && r.status === 200 && !unlocked.locked);

// ---------- Caterer and admin meal flow ----------
r = await call('/caterer/dishes', { method: 'POST', cookie: caterer, body: { type: 'meal', name: 'Test meal', priceKobo: 100000, carb: 120, protein: 10, fat: 10, vitamin: 10, mineral: 10 } });
record('T3', 'Upload meal with invalid value', 'Carbohydrates = 120%', 'Upload rejected', r.data?.error, r.status === 400);

r = await call('/caterer/dishes', { method: 'POST', cookie: caterer, body: { type: 'meal', name: 'Beans and plantain porridge', priceKobo: 150000, carb: 30, protein: 22, fat: 12, vitamin: 15, mineral: 10 } });
record('T4', 'Upload a valid meal', '30, 22, 12, 15, 10 (% RDI), ₦1,500', 'Saved as balanced, awaiting approval',
  `Balanced = ${r.data?.isBalanced}, status = ${r.data?.status}`, r.status === 201 && r.data.isBalanced && !r.data.isApproved && r.data.status === 'Awaiting approval');
const newMealId = r.data?.id;

r = await call(`/admin/meals/${newMealId}`, { method: 'PATCH', cookie: admin, body: { approve: true } });
log = (await call('/admin/audit-log', { cookie: admin })).data;
record('T5', 'Admin approves meal', 'Approve "Beans and plantain porridge"', 'Meal becomes visible to staff; approval audited',
  `Approved = ${r.data?.isApproved}; latest log entry ${log[0]?.action}`, r.data?.isApproved === true && log[0]?.action === 'meal.approved');

// ---------- Guidance ----------
// The new staff account has no declared condition, so H = 0. It chooses both meals itself.
r = await call('/checkin', { method: 'POST', cookie: newStaff, body: { prev1: { mealId: id('Fruit') }, prev2: { mealId: id('Moi'), ateElsewhere: true } } });
const ck0 = r.data?.checkin;
const c0 = (await call('/catalogue', { cookie: newStaff })).data;
record('T6', 'Gate check, no health risk, light meals', 'H = 0; check-in: Fruit platter, Moi moi and pap (chosen by hand)',
  'G = 0 stored, no meal locked', `H=${c0.inputs.H}, P1=${c0.inputs.P1}, P2=${c0.inputs.P2}, G=${c0.gate}; sources ${ck0?.prev1.source}/${ck0?.prev2.source}; "${ck0?.title}"`,
  r.status === 201 && c0.gate === 0 && c0.locked.length === 0 && ck0?.prev1.source === 'manual' && ck0?.prev2.source === 'manual');

r = await call('/checkin/today', { cookie: staff });
record('T31', 'Check-in pre-fill from order history', 'staff@ ordered White rice and stew, then Jollof rice',
  'Most recent meal Jollof rice, the one before White rice', `prev1 = ${r.data?.prefill.prev1?.name}; prev2 = ${r.data?.prefill.prev2?.name}`,
  r.data?.prefill.prev1?.id === id('Jollof') && r.data?.prefill.prev2?.id === id('White rice'));

const keep = { prev1: { mealId: id('Jollof') }, prev2: { mealId: id('White rice') } };
r = await call('/checkin', { method: 'POST', cookie: staff, body: keep });
const ck1 = r.data?.checkin;
const c1 = (await call('/catalogue', { cookie: staff })).data;
record('T7', 'Gate check, health risk and heavy meals', 'H = 1; keeps the pre-filled Jollof rice, White rice and stew',
  'G = 1 stored, full guidance', `H=${c1.inputs.H}, P1=${c1.inputs.P1}, P2=${c1.inputs.P2}, G=${c1.gate}; sources ${ck1?.prev1.source}/${ck1?.prev2.source}; "${ck1?.title}"`,
  r.status === 201 && c1.gate === 1 && ck1?.prev1.source === 'history' && ck1?.prev2.source === 'history');

r = await call('/checkin', { method: 'POST', cookie: staff, body: keep });
const rows = (await pool.query(
  "SELECT * FROM daily_checkins WHERE user_id = (SELECT user_id FROM users WHERE email = 'staff@chopwise.ng') AND checkin_date = $1", [today],
)).rows;
let duplicate = 'inserted';
try {
  await pool.query(
    `INSERT INTO daily_checkins (user_id, checkin_date, prev1_meal_id, prev2_meal_id, source_prev1, source_prev2, h, p1, p2, g)
     SELECT user_id, checkin_date, prev1_meal_id, prev2_meal_id, source_prev1, source_prev2, h, p1, p2, g FROM daily_checkins WHERE checkin_id = $1`,
    [rows[0].checkin_id],
  );
} catch (err) { duplicate = err.code === '23505' ? 'rejected (unique)' : err.code; }
record('T32', 'One check-in per user per Lagos day', 'Redo before the first order, then insert a second row directly',
  'Redo updates the same row; a second row is rejected', `Redo HTTP ${r.status}, redone=${r.data?.redone}; rows today = ${rows.length}; second row ${duplicate}`,
  r.status === 200 && r.data?.redone === true && rows.length === 1 && duplicate === 'rejected (unique)');
const storedAt = rows[0].updated_at.getTime();

let bought = await buy(staff, one(id('Pounded')));
let intakeNow = await intakeOf(staff);
record('T8', 'Order and pay for a meal', 'Pounded yam and egusi soup, paid through Paystack', 'Session intake increases by the meal values',
  `Order ${bought.order?.status}; carbohydrates ${intakeNow.carb}%, fats ${intakeNow.fat}%`, bought.order?.status === 'paid' && intakeNow.carb === 55);

// T60: under G = 1 a meal that would take its own class past 90% can't be checked out (projected-intake lock).
const riceMenu = (await call('/catalogue', { cookie: staff })).data.catalogue.find((m) => m.id === id('White rice'));
const riceCart = (await call('/cart/evaluate', { method: 'POST', cookie: staff, body: { lines: one(id('White rice')) } })).data;
r = await checkoutCart(staff, one(id('White rice')));
record('T60', 'Projected-intake lock under full guidance', 'G = 1, carbohydrates 55%; cart: White rice and stew (adds 52%)',
  'Locked on the menu and at checkout (would reach 107%); message names the dish and suggests alternatives',
  `Menu "${riceMenu?.fit}"; evaluate canCheckout=${riceCart.canCheckout}; checkout HTTP ${r.status}: ${r.data?.error}`,
  riceMenu?.fit === 'Restricted today' && riceCart.canCheckout === false && r.status === 409
    && /White rice and stew is restricted today: with this order carbohydrates would reach 107%/.test(r.data?.error ?? '') && /or try /.test(r.data?.error ?? ''));

// T63: every server entry point refuses a restricted line with 409, including cart evaluation.
const jollofEval = await call('/cart/evaluate', { method: 'POST', cookie: staff, body: { lines: [{ dishId: id('Jollof'), quantity: 2 }] } });
const jollofCheckout = await checkoutCart(staff, [{ dishId: id('Jollof'), quantity: 2 }]);
record('T63', 'Restricted line at every entry point', 'G = 1, carbohydrates 55%; cart: 2 × Jollof rice and chicken',
  'Cart evaluation and checkout both refuse with 409; the line is marked Restricted today',
  `Evaluate HTTP ${jollofEval.status} (line "${jollofEval.data?.lines?.[0]?.fit}"); checkout HTTP ${jollofCheckout.status}`,
  jollofEval.status === 409 && jollofEval.data?.lines?.[0]?.fit === 'Restricted today' && jollofEval.data?.canCheckout === false && jollofCheckout.status === 409);

// T61: at most 2 plates of one dish per order.
const threePlates = await checkoutCart(staff, [{ dishId: id('Balanced lunch'), quantity: 3 }]);
const threeEval = await call('/cart/evaluate', { method: 'POST', cookie: staff, body: { lines: [{ dishId: id('Balanced lunch'), quantity: 3 }] } });
record('T61', 'Three plates of one dish', '3 × Balanced lunch bowl', 'Refused by the server: at most 2 plates per dish per order',
  `Evaluate HTTP ${threeEval.status}; checkout HTTP ${threePlates.status}: ${threePlates.data?.error}`,
  threeEval.status === 400 && threePlates.status === 400 && threePlates.data?.error === 'You can order at most 2 plates of one dish per order');

// T9: reach Critical carbohydrates with meals the lock allows (a balanced meal, then a vitamin-led one).
bought = await buy(staff, one(id('Yam porridge')));
bought = await buy(staff, one(id('Fruit platter')));
const after = (await call('/catalogue', { cookie: staff })).data;
const lockedJollof = after.catalogue.find((m) => m.id === id('Jollof'));
const altNames = lockedJollof?.alternatives.map((a) => a.name) ?? [];
record('T9', 'Intake passes 90% (Critical)', 'Order Yam porridge with vegetables, then Fruit platter',
  'Critical notification; carb-led meals locked; Jollof suggests the lowest-carbohydrate alternatives first',
  `Carbohydrates ${after.intake.carb}% (${after.bands.carb}); ${after.locked.length} meals locked; Jollof "${lockedJollof?.fit}", try: ${lockedJollof?.alternatives.map((a) => `${a.name} (${a.text})`).join(', ')}`,
  after.bands.carb === 'Critical' && lockedJollof?.locked && after.notifications.some((n) => n.intakeLevel === 'Critical')
    && altNames.join('|') === 'Suya and onions|Vegetable salad with egg|Grilled fish and vegetables'
    && lockedJollof.alternatives[0].text === 'Adds 6% carbohydrates');

// T77: past 100% of the daily limit, a third warning appears and is saved with the others.
const saved77 = (await call('/notifications', { cookie: staff })).data;
record('T77', 'Intake passes 100% of the daily limit', `Carbohydrates at ${after.intake.carb}% after T9`,
  'A third warning ("past your full daily limit") on the menu and in Notifications, as well as the 90% one',
  `Menu: ${after.notifications.filter((n) => n.foodClass === 'carb').map((n) => n.intakeLevel).join(' + ')}; saved: ${saved77.filter((n) => n.food_class === 'carb').map((n) => n.intake_level).join(' + ')}`,
  after.intake.carb > 100 && after.notifications.some((n) => n.foodClass === 'carb' && n.intakeLevel === 'Over')
    && saved77.some((n) => n.food_class === 'carb' && n.intake_level === 'Over' && /past your full daily limit/.test(n.message))
    && saved77.some((n) => n.food_class === 'carb' && n.intake_level === 'Critical'));

r = await checkoutCart(staff, one(id('Jollof')));
record('T10', 'Check out a cart with a Restricted today line', 'Jollof rice and chicken (G = 1, carbohydrates Critical)', 'Checkout refused; nothing reserved',
  `HTTP ${r.status}: ${r.data?.error}`, r.status === 409 && /restricted today/.test(r.data?.error ?? ''));

bought = await buy(staff, one(id('Fried plantain')));
record('T11', 'Order a balanced meal at Critical', 'Fried plantain and beans (balanced)', 'Order accepted and paid',
  `Order ${bought.order?.status ?? bought.checkout.data?.error}`, bought.order?.status === 'paid');

bought = await buy(staff, one(id('Akara')));
const afterAkara = (await call('/catalogue', { cookie: staff })).data;
record('T12', 'Intake passes 70% (High)', 'Order Akara and custard (balanced)',
  'High warning issued', `Fats and oils ${afterAkara.intake.fat}% (${afterAkara.bands.fat})`,
  afterAkara.bands.fat === 'High' && afterAkara.notifications.some((n) => n.foodClass === 'fat' && n.intakeLevel === 'High'));

// ---------- G is fixed for the day ----------
const staffCheckinSql = "SELECT * FROM daily_checkins WHERE user_id = (SELECT user_id FROM users WHERE email = 'staff@chopwise.ng') AND checkin_date = $1";
let stored = (await pool.query(staffCheckinSql, [today])).rows[0];
const later = (await call('/catalogue', { cookie: staff })).data;
record('T33', 'G is stored once and reused all day', 'Five paid orders after the check-in, then reload the catalogue',
  'Same stored H, P1, P2, G; check-in row never rewritten', `G = ${later.gate} (inputs ${later.inputs.H}${later.inputs.P1}${later.inputs.P2}); row unchanged = ${stored.updated_at.getTime() === storedAt}`,
  later.gate === 1 && stored.g === 1 && stored.updated_at.getTime() === storedAt);

const healthNo = await call('/health-profile', { method: 'PUT', cookie: staff, body: { hasCondition: false } });
const afterEdit = (await call('/catalogue', { cookie: staff })).data;
stored = (await pool.query(staffCheckinSql, [today])).rows[0];
record('T34', "Editing the health profile doesn't change today's G", 'staff@ changes the health answer to No after checking in',
  "Profile now H = 0, applied from tomorrow; today's H and G unchanged",
  `Profile H = ${healthNo.data?.h} (applies ${healthNo.data?.appliesFrom}); today H = ${afterEdit.inputs.H}, G = ${afterEdit.gate}`,
  healthNo.data?.h === 0 && healthNo.data?.appliesFrom === 'tomorrow' && afterEdit.inputs.H === 1 && afterEdit.gate === 1 && stored.h === 1);
await call('/health-profile', { method: 'PUT', cookie: staff, body: { hasCondition: true, conditions: ['Hypertension'] } });

r = await call('/checkin', { method: 'POST', cookie: staff, body: { prev1: { mealId: id('Fruit') }, prev2: { mealId: id('Moi') } } });
const lockedView = (await call('/checkin/today', { cookie: staff })).data;
record('T35', 'Check-in after the first order', 'Redo the check-in with light meals after ordering', 'Refused; check-in locked for the day',
  `HTTP ${r.status} ${r.data?.code}; locked = ${lockedView?.locked}`, r.status === 409 && r.data?.code === 'CHECKIN_LOCKED' && lockedView?.locked === true);

// ---------- Caterer dish library ----------
const SITE = BASE.replace(/\/api$/, '');
async function uploadPhoto(dishId, bytes, cookie, filename = 'dish.jpg', type = 'image/jpeg') {
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type }), filename);
  const res = await fetch(`${BASE}/caterer/dishes/${dishId}/photo`, { method: 'PUT', headers: { Origin: ORIGIN, Cookie: cookie }, body: form });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const meal = { carb: 28, protein: 24, fat: 16, vitamin: 12, mineral: 10 };
const staffMenu = async () => (await call('/catalogue', { cookie: staff })).data;
const onMenu = (menu, dishId) => menu.catalogue.some((m) => m.id === dishId);

r = await call('/caterer/dishes', { method: 'POST', cookie: caterer, body: { type: 'meal', name: 'Ewa agoyin and bread', description: 'Mashed beans with pepper sauce', priceKobo: 180000, ...meal } });
const ewa = r.data;
const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#8b5a2b' } }).jpeg().toBuffer();
const up = await uploadPhoto(ewa.id, photo, caterer);
const served = await fetch(SITE + up.data?.photoUrl);
const hiddenBeforeApproval = !(await call('/meals', { cookie: staff })).data.some((m) => m.id === ewa.id);
record('T37', 'Caterer adds a dish with a photo', 'Ewa agoyin and bread, ₦1,800, 1600 px JPEG', 'Saved awaiting approval; photo stored as a generated .webp; hidden from staff',
  `${ewa.status}; photo ${up.data?.photoUrl}; served as ${served.headers.get('content-type')}, ${served.headers.get('x-content-type-options')}, ${served.headers.get('cache-control')}; hidden = ${hiddenBeforeApproval}`,
  r.status === 201 && ewa.status === 'Awaiting approval' && up.status === 200
    && /^\/uploads\/dishes\/[0-9a-f-]{36}\.webp$/.test(up.data.photoUrl) && served.headers.get('content-type') === 'image/webp'
    && served.headers.get('x-content-type-options') === 'nosniff' && /max-age=31536000/.test(served.headers.get('cache-control') ?? '') && hiddenBeforeApproval);

const fakePdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj << /Type /Catalog >> endobj\n');
r = await uploadPhoto(ewa.id, fakePdf, caterer, 'jollof.jpg', 'image/jpeg');
record('T38', 'Upload a PDF renamed to .jpg', 'jollof.jpg containing a PDF', 'Rejected; the existing photo is kept',
  `HTTP ${r.status}: ${r.data?.error}`, r.status === 400);

// A second caterer: a new staff sign-up the admin makes a caterer.
r = await call('/auth/register', { method: 'POST', body: { name: 'Second Kitchen', email: `kitchen.${Date.now()}@chopwise.ng`, password: newPassword, confirmPassword: newPassword } });
const caterer2 = r.cookie;
await call(`/admin/users/${r.data.user.id}/role`, { method: 'PATCH', cookie: admin, body: { role: 'caterer' } });
const theirList = (await call('/caterer/dishes', { cookie: caterer2 })).data;
const theirEdit = await call(`/caterer/dishes/${ewa.id}`, { method: 'PUT', cookie: caterer2, body: { name: 'Taken over', priceKobo: 100, ...meal } });
const theirToggle = await call(`/caterer/dishes/${ewa.id}/availability`, { method: 'PATCH', cookie: caterer2, body: { available: false } });
const theirPhoto = await uploadPhoto(ewa.id, photo, caterer2);
const ewaAfter = (await call('/caterer/dishes', { cookie: caterer })).data.find((d) => d.id === ewa.id);
record('T39', "Caterer opens another caterer's dish", 'Second caterer lists, edits, toggles and re-photographs Ewa agoyin', 'Not visible; every change refused as not found',
  `Their list: ${theirList.length} dishes; edit ${theirEdit.status}, toggle ${theirToggle.status}, photo ${theirPhoto.status}; name still "${ewaAfter.name}"`,
  theirList.length === 0 && theirEdit.status === 404 && theirToggle.status === 404 && theirPhoto.status === 404 && ewaAfter.name === 'Ewa agoyin and bread');

const caterDishes = (await call('/caterer/dishes', { cookie: caterer })).data;
const yam = caterDishes.find((d) => d.name.startsWith('Yam porridge'));
r = await call(`/caterer/dishes/${yam.id}`, { method: 'PUT', cookie: caterer, body: { name: yam.name, priceKobo: yam.priceKobo, carb: yam.carb, protein: yam.protein, fat: yam.fat, vitamin: 26, mineral: yam.mineral } });
const resent = r.data;
const hiddenMenu = await staffMenu();
const adminView = (await call('/admin/meals', { cookie: admin })).data.find((m) => m.id === yam.id);
const reapprove = await call(`/admin/meals/${yam.id}`, { method: 'PATCH', cookie: admin, body: { approve: true } });
log = (await call('/admin/audit-log', { cookie: admin })).data;
const backMenu = await staffMenu();
record('T40', 'Editing an RDI value sends a meal back for approval', 'Yam porridge: vitamins 20% → 26%; then the admin re-approves',
  'Hidden from staff; admin sees the changed value; re-approval audited; back on the menu',
  `sentForApproval = ${resent?.sentForApproval}; on menu while waiting = ${onMenu(hiddenMenu, yam.id)}; admin sees ${adminView?.status}, changed [${adminView?.changedSinceApproval}]; log ${log[0]?.action}; back = ${onMenu(backMenu, yam.id)}`,
  resent?.sentForApproval === true && !onMenu(hiddenMenu, yam.id) && adminView?.status === 'Awaiting re-approval'
    && adminView.changedSinceApproval.join() === 'vitamin' && reapprove.status === 200 && log[0]?.action === 'meal.reapproved' && onMenu(backMenu, yam.id));

const fruitDish = caterDishes.find((d) => d.name === 'Fruit platter');
r = await call(`/caterer/dishes/${fruitDish.id}`, { method: 'PUT', cookie: caterer, body: { name: 'Fruit platter', description: 'Seasonal fruit', priceKobo: 120000, carb: fruitDish.carb, protein: fruitDish.protein, fat: fruitDish.fat, vitamin: fruitDish.vitamin, mineral: fruitDish.mineral } });
const fruitPhoto = await uploadPhoto(fruitDish.id, photo, caterer);
const fruitOnMenu = (await staffMenu()).catalogue.find((m) => m.id === fruitDish.id);
record('T41', 'Price, description and photo edits keep the approval', 'Fruit platter: ₦1,000 → ₦1,200, new description and photo',
  'Still approved and on the menu at the new price', `sentForApproval = ${r.data?.sentForApproval}; ${r.data?.dish.status}; staff see ₦${fruitOnMenu?.priceKobo / 100} with photo ${Boolean(fruitOnMenu?.photoUrl)}`,
  r.data?.sentForApproval === false && r.data.dish.status === 'Approved' && fruitPhoto.status === 200 && fruitOnMenu?.priceKobo === 120000 && Boolean(fruitOnMenu.photoUrl));

const moi = caterDishes.find((d) => d.name.startsWith('Moi moi'));
await call(`/caterer/dishes/${moi.id}/availability`, { method: 'PATCH', cookie: caterer, body: { available: false } });
const soldMenu = await staffMenu();
const soldOrder = await checkoutCart(staff, one(moi.id));
r = await call(`/caterer/dishes/${moi.id}/availability`, { method: 'PATCH', cookie: caterer, body: { available: true } });
const againMenu = await staffMenu();
record('T42', 'A sold-out dish cannot be ordered', 'Moi moi and pap marked sold out; staff order it; caterer switches it back',
  'Listed as sold out; order refused (409); available again the same day',
  `In sold-out list = ${soldMenu.unavailable.some((m) => m.id === moi.id && m.unavailable === 'Sold out')}; order HTTP ${soldOrder.status}: ${soldOrder.data?.error}; back on menu = ${onMenu(againMenu, moi.id)}`,
  soldMenu.unavailable.some((m) => m.id === moi.id && m.unavailable === 'Sold out') && !onMenu(soldMenu, moi.id) && soldOrder.status === 409 && r.data?.soldOutToday === false && onMenu(againMenu, moi.id));

const suya = caterDishes.find((d) => d.name.startsWith('Suya'));
await call(`/caterer/dishes/${suya.id}/availability`, { method: 'PATCH', cookie: caterer, body: { available: false } });
await pool.query('UPDATE meals SET sold_out_on = $1 WHERE meal_id = $2', [addDays(today, -1), suya.id]);
const nextDay = await staffMenu();
record('T43', 'Sold out resets at Lagos midnight', `Suya marked sold out on ${addDays(today, -1)}`, 'Available again today without any action',
  `On menu = ${onMenu(nextDay, suya.id)}; in sold-out list = ${nextDay.unavailable.some((m) => m.id === suya.id)}`,
  onMenu(nextDay, suya.id) && !nextDay.unavailable.some((m) => m.id === suya.id));

const addons = caterDishes.filter((d) => d.type === 'addon');
const addonWithRdi = await call('/caterer/dishes', { method: 'POST', cookie: caterer, body: { type: 'addon', name: 'Malt drink', priceKobo: 60000, carb: 20 } });
const sneaky = await call('/caterer/dishes', { method: 'POST', cookie: caterer, body: { type: 'meal', name: 'Sneaky', priceKobo: 100000, ...meal, is_balanced: true } });
const staffSees = [...(await staffMenu()).catalogue, ...(await call('/meals', { cookie: staff })).data];
record('T44', 'Add-ons and server-computed fields', 'Seeded add-ons; an add-on with RDI values; a meal sending is_balanced',
  'Add-ons need no approval and never reach staff guidance; both bad requests rejected',
  `${addons.map((a) => `${a.name}: ${a.status}`).join('; ')}; add-ons in staff menus = ${staffSees.filter((m) => m.type === 'addon').length}; RDI on add-on HTTP ${addonWithRdi.status}; is_balanced HTTP ${sneaky.status} (${sneaky.data?.error})`,
  addons.length === 1 && addons[0].name === 'Extra bottled water' && addons.every((a) => a.status === 'No approval needed' && a.carb === null) && staffSees.every((m) => m.type === 'meal')
    && addonWithRdi.status === 400 && sneaky.status === 400 && sneaky.data?.error === 'Unknown field: is_balanced');

// ---------- Access control ----------
r = await call('/admin/report', { cookie: staff });
record('T13', 'Staff opens an admin page', 'Staff session on /admin/report', 'Access denied', `HTTP ${r.status}: ${r.data?.error}`, r.status === 403);

r = await checkoutCart(staff, one(id('Balanced lunch')), 'https://evil.example');
record('T21', 'Cross-site request with a valid session', 'POST /orders/checkout from https://evil.example', 'Blocked by the Origin check',
  `HTTP ${r.status}: ${r.data?.error}`, r.status === 403);

const staff2 = (await call('/admin/users?q=staff2', { cookie: admin })).data[0];
r = await call(`/admin/users/${staff2.id}/role`, { method: 'PATCH', cookie: staff, body: { role: 'admin' } });
record('T22', 'Staff tries to change a role', 'Staff session: make staff2 an admin', 'Access denied', `HTTP ${r.status}: ${r.data?.error}`, r.status === 403);

r = await call(`/admin/users/${adminMe.id}/role`, { method: 'PATCH', cookie: admin, body: { role: 'staff' } });
record('T23', 'Admin removes their own admin role', 'Admin sets own role to staff', 'Refused', `HTTP ${r.status}: ${r.data?.error}`, r.status === 409);

r = await call(`/admin/users/${staff2.id}/role`, { method: 'PATCH', cookie: admin, body: { role: 'caterer' } });
log = (await call('/admin/audit-log', { cookie: admin })).data;
const roleEntry = log[0];
await call(`/admin/users/${staff2.id}/role`, { method: 'PATCH', cookie: admin, body: { role: 'staff' } });
record('T24', 'Admin changes a role', 'Make staff2 a caterer', 'Role changed and audited',
  `New role ${r.data?.role}; log: ${roleEntry?.action} ${roleEntry?.details.from} → ${roleEntry?.details.to}`,
  r.data?.role === 'caterer' && roleEntry?.action === 'user.role_changed' && roleEntry.details.from === 'staff' && roleEntry.details.to === 'caterer');

r = await call('/admin/settings', { method: 'PUT', cookie: admin, body: { vatRate: 7.5, deliveryFee: 500 } });
const bad = await call('/admin/settings', { method: 'PUT', cookie: admin, body: { vatRate: 150, deliveryFee: 500 } });
log = (await call('/admin/audit-log', { cookie: admin })).data;
record('T25', 'Admin sets VAT and the delivery fee', 'VAT 7.5%, fee ₦500; then VAT 150%', 'Saved and audited; 150% rejected',
  `Saved VAT ${r.data?.vatRate}%, fee ₦${r.data?.deliveryFee}; latest log ${log[0]?.action}; 150%: HTTP ${bad.status}`,
  r.data?.vatRate === 7.5 && r.data?.deliveryFee === 500 && log[0]?.action === 'settings.updated' && bad.status === 400);

r = await call('/auth/logout', { method: 'POST', cookie: newStaff });
record('T26', 'Log out', 'POST /auth/logout', 'Session cookie cleared',
  `HTTP ${r.status}; ${r.setCookie?.match(/Expires=[^;]+/)?.[0]}`, r.status === 204 && /Expires=Thu, 01 Jan 1970/.test(r.setCookie ?? ''));

// ---------- Cart, checkout, payment and delivery ----------
const dishList = async () => (await call('/caterer/dishes', { cookie: caterer })).data;
const dishNamed = async (prefix) => (await dishList()).find((d) => d.name.startsWith(prefix));
const setStock = (dishId, platesLeft) => call(`/caterer/dishes/${dishId}/stock`, { method: 'PUT', cookie: caterer, body: { platesLeft } });
const staffOrders = async (cookie) => (await call('/orders/mine', { cookie })).data;
const naira = (k) => `₦${(k / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const water = await dishNamed('Extra bottled water');
const fish = await dishNamed('Grilled fish');

// T45: the whole order, start to finish (new staff member, G = 0).
const cartLines = [{ dishId: fish.id, quantity: 1 }, { dishId: water.id, quantity: 1 }];
const evaluated = (await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: cartLines } })).data;
const intakeBefore = await intakeOf(newStaff);
const fishBefore = (await dishNamed('Grilled fish')).platesLeftToday;
const co = await checkoutCart(newStaff, cartLines);
const pending = (await staffOrders(newStaff)).find((o) => o.id === co.data?.orderId);
const fishReserved = (await dishNamed('Grilled fish')).platesLeftToday;
const intakePending = await intakeOf(newStaff);
payOnPaystack(co.data.reference);
const verified = await call('/orders/verify', { method: 'POST', cookie: newStaff, body: { reference: co.data.reference } });
const intakePaid = await intakeOf(newStaff);
const code = verified.data?.order.deliveryCode;
const catererView = (await call('/caterer/orders', { cookie: caterer })).data.find((o) => o.id === co.data.orderId);
const step1 = await call(`/caterer/orders/${co.data.orderId}/status`, { method: 'PATCH', cookie: caterer, body: { status: 'preparing' } });
const skip = await call(`/caterer/orders/${co.data.orderId}/deliver`, { method: 'POST', cookie: caterer, body: { code } });
const step2 = await call(`/caterer/orders/${co.data.orderId}/status`, { method: 'PATCH', cookie: caterer, body: { status: 'out_for_delivery' } });
const wrongOnce = await call(`/caterer/orders/${co.data.orderId}/deliver`, { method: 'POST', cookie: caterer, body: { code: code === '0000' ? '0001' : '0000' } });
const delivered = await call(`/caterer/orders/${co.data.orderId}/deliver`, { method: 'POST', cookie: caterer, body: { code } });
const finalView = (await staffOrders(newStaff)).find((o) => o.id === co.data.orderId);
record('T45', 'Full order: cart → checkout → payment → preparing → out for delivery → delivered',
  'Grilled fish and vegetables + Extra bottled water; mock Paystack payment; caterer enters the code',
  'Each step in order; code shown to the staff member only; delivered by code',
  `evaluate canCheckout=${evaluated?.canCheckout}; checkout ${co.status} → ${pending?.status}; verify → ${verified.data?.order.status}, code ${code ? 'shown' : 'missing'} (caterer sees ${catererView?.deliveryCode}); `
    + `${step1.data?.status} → ${step2.data?.status}; early code HTTP ${skip.status}; wrong code HTTP ${wrongOnce.status}; final ${finalView?.status}, code now ${finalView?.deliveryCode}`,
  evaluated?.canCheckout && co.status === 201 && pending?.status === 'pending_payment' && verified.data?.order.status === 'paid'
    && /^\d{4}$/.test(code ?? '') && catererView?.deliveryCode === null && catererView?.staffName === 'Scenario Staff'
    && step1.data?.status === 'preparing' && skip.status === 409 && step2.data?.status === 'out_for_delivery'
    && wrongOnce.status === 400 && delivered.data?.status === 'delivered' && finalView?.status === 'delivered' && finalView.deliveryCode === null);

// T46: the breakdown, worked out independently here from the settings and the menu prices.
const settings = (await call('/admin/settings', { cookie: admin })).data;
const waterPriceKobo = Math.round(settings.waterPrice * 100); // the bottle that comes with the fish
const subtotal = fish.priceKobo + waterPriceKobo + water.priceKobo;
const vat = Math.floor((subtotal * Math.round(settings.vatRate * 100) + 5000) / 10000);
const fee = Math.round(settings.deliveryFee * 100);
const b = verified.data.order.breakdown;
record('T46', 'Checkout breakdown in kobo', `${naira(fish.priceKobo)} + bottled water ${naira(waterPriceKobo)} + ${naira(water.priceKobo)}, VAT ${settings.vatRate}%, delivery ${naira(fee)}`,
  'Server totals match: subtotal + VAT (on the subtotal only) + delivery fee',
  `Subtotal ${naira(b.subtotalKobo)}, VAT ${naira(b.vatKobo)}, delivery ${naira(b.deliveryFeeKobo)}, total ${naira(b.totalKobo)}; Paystack charged ${naira(paystack.get(co.data.reference).amount)}`,
  b.subtotalKobo === subtotal && b.vatKobo === vat && b.deliveryFeeKobo === fee && b.totalKobo === subtotal + vat + fee
    && paystack.get(co.data.reference).amount === b.totalKobo && paystack.get(co.data.reference).currency === 'NGN');

record('T47', 'Intake updates only when an order is paid', 'Intake before checkout, after checkout (pending) and after payment',
  'Unchanged at checkout; up by the meal values once paid; add-on adds nothing',
  `Proteins ${intakeBefore.protein}% → ${intakePending.protein}% (pending) → ${intakePaid.protein}% (paid)`,
  intakePending.protein === intakeBefore.protein && intakePaid.protein === intakeBefore.protein + fish.protein);

// T48: the order keeps its prices when the caterer changes the menu.
await call(`/caterer/dishes/${fish.id}`, { method: 'PUT', cookie: caterer, body: { name: fish.name, priceKobo: fish.priceKobo + 50000, carb: fish.carb, protein: fish.protein, fat: fish.fat, vitamin: fish.vitamin, mineral: fish.mineral } });
await call('/admin/settings', { method: 'PUT', cookie: admin, body: { vatRate: 10, deliveryFee: 800 } });
const snap = (await staffOrders(newStaff)).find((o) => o.id === co.data.orderId);
await call('/admin/settings', { method: 'PUT', cookie: admin, body: { vatRate: settings.vatRate, deliveryFee: settings.deliveryFee } });
record('T48', 'Price snapshot', 'After paying: caterer raises the fish price by ₦500; admin changes VAT to 10% and the fee to ₦800',
  'The order keeps the price, VAT rate and fee used at checkout',
  `Fish on the order ${naira(snap.items[0].unitPriceKobo)}; VAT ${snap.breakdown.vatRate}%; fee ${naira(snap.breakdown.deliveryFeeKobo)}; total ${naira(snap.breakdown.totalKobo)}`,
  snap.items[0].unitPriceKobo === fish.priceKobo && snap.breakdown.vatRate === settings.vatRate
    && snap.breakdown.deliveryFeeKobo === fee && snap.breakdown.totalKobo === b.totalKobo);

// T49: two checkouts race for the last plate.
const salad = await dishNamed('Vegetable salad');
await setStock(salad.id, 1);
const race = await Promise.all([checkoutCart(staff, one(salad.id)), checkoutCart(newStaff, one(salad.id))]);
const winner = race.find((x) => x.status === 201);
const loser = race.find((x) => x.status !== 201);
const saladAfterRace = (await dishNamed('Vegetable salad')).platesLeftToday;
record('T49', 'Two checkouts for the last plate', 'Vegetable salad with 1 plate left; two staff check out at the same moment',
  'Exactly one succeeds; the other gets 409 naming the dish; stock never goes below 0',
  `Statuses ${race.map((x) => x.status).sort().join(' and ')}; refusal "${loser?.data?.error}"; plates left ${saladAfterRace}`,
  race.filter((x) => x.status === 201).length === 1 && loser?.status === 409 && /Vegetable salad/.test(loser.data?.error ?? '') && saladAfterRace === 0);

// T50: the winner's payment fails, so the plate goes back.
const winnerCookie = race[0] === winner ? staff : newStaff;
payOnPaystack(winner.data.reference, { status: 'failed' });
const failed = await call('/orders/verify', { method: 'POST', cookie: winnerCookie, body: { reference: winner.data.reference } });
const saladAfterFail = (await dishNamed('Vegetable salad')).platesLeftToday;
record('T50', 'A failed payment releases the plates', 'Paystack reports the payment as failed', 'Order cancelled with the reason; plate back in stock',
  `Order ${failed.data?.order.status} ("${failed.data?.order.cancelReason}"); plates left ${saladAfterFail}`,
  failed.data?.order.status === 'cancelled' && saladAfterFail === 1);

// T51: an unpaid checkout expires after 15 minutes.
const expiring = await checkoutCart(newStaff, one(salad.id));
await pool.query("UPDATE orders SET reserved_until = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [expiring.data.orderId]);
await call('/catalogue', { cookie: staff }); // any stock read runs the expiry check first
const expired = (await staffOrders(newStaff)).find((o) => o.id === expiring.data.orderId);
const saladAfterExpiry = (await dishNamed('Vegetable salad')).platesLeftToday;
record('T51', 'An expired reservation releases the plates', 'Checkout, then 15 minutes pass with no payment', 'Order cancelled; plate back in stock',
  `Order ${expired?.status} ("${expired?.cancelReason}"); plates left ${saladAfterExpiry}`,
  expired?.status === 'cancelled' && saladAfterExpiry === 1);

// T52: Paystack reports the wrong amount or currency.
const short = await checkoutCart(newStaff, one(salad.id));
payOnPaystack(short.data.reference, { amount: paystack.get(short.data.reference).amount - 100 });
const shortVerify = await call('/orders/verify', { method: 'POST', cookie: newStaff, body: { reference: short.data.reference } });
const usd = await checkoutCart(newStaff, one(salad.id));
payOnPaystack(usd.data.reference, { currency: 'USD' });
const usdVerify = await call('/orders/verify', { method: 'POST', cookie: newStaff, body: { reference: usd.data.reference } });
log = (await call('/admin/audit-log', { cookie: admin })).data;
record('T52', 'Verify rejects a wrong amount or currency', 'Paystack says success but ₦1 short; then success in USD',
  'Neither order is paid; both cancelled, plates released, mismatch audited',
  `Short: ${shortVerify.data?.order.status} ("${shortVerify.data?.order.cancelReason}"); USD: ${usdVerify.data?.order.status}; audit entries ${log.filter((e) => e.action === 'payment.mismatch').length}; plates left ${(await dishNamed('Vegetable salad')).platesLeftToday}`,
  shortVerify.data?.order.status === 'cancelled' && usdVerify.data?.order.status === 'cancelled'
    && log.filter((e) => e.action === 'payment.mismatch').length >= 2 && (await dishNamed('Vegetable salad')).platesLeftToday === 1);

// T53–T55: someone else's reference, a forged webhook, and verify + webhook arriving together.
const moiDish = await dishNamed('Moi moi');
const theirs = await checkoutCart(staff, one(moiDish.id));
const intakeStaffPending = await intakeOf(staff);
payOnPaystack(theirs.data.reference);
const stolen = await call('/orders/verify', { method: 'POST', cookie: newStaff, body: { reference: theirs.data.reference } });
const stillPending = (await staffOrders(staff)).find((o) => o.id === theirs.data.orderId);
record('T53', "Verify someone else's payment reference", "New staff member submits staff@'s reference", 'Not found; the order is untouched',
  `HTTP ${stolen.status}: ${stolen.data?.error}; staff@'s order still ${stillPending?.status}`, stolen.status === 404 && stillPending?.status === 'pending_payment');

const event = { event: 'charge.success', data: { ...paystack.get(theirs.data.reference) } };
const forged = signWebhook(event, 'sk_test_attacker_guess');
const forgedRes = await fetch(`${BASE}/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': forged.signature }, body: forged.body });
const unsignedRes = await fetch(`${BASE}/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
const afterForged = (await staffOrders(staff)).find((o) => o.id === theirs.data.orderId);
record('T54', 'Webhook with a bad signature', 'charge.success signed with the wrong key, and one with no signature', 'Both rejected (401); order not paid',
  `HTTP ${forgedRes.status} and ${unsignedRes.status}; order ${afterForged?.status}`, forgedRes.status === 401 && unsignedRes.status === 401 && afterForged?.status === 'pending_payment');

const genuine = signWebhook(event);
const [hook, hook2, ver] = await Promise.all([
  fetch(`${BASE}/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': genuine.signature }, body: genuine.body }),
  fetch(`${BASE}/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': genuine.signature }, body: genuine.body }),
  call('/orders/verify', { method: 'POST', cookie: staff, body: { reference: theirs.data.reference } }),
]);
const intakeStaffPaid = await intakeOf(staff);
const paidOnce = (await pool.query("SELECT COUNT(*)::int AS n FROM orders WHERE order_id = $1 AND status = 'paid'", [theirs.data.orderId])).rows[0].n;
record('T55', 'Verify and webhook both arrive', 'A genuine webhook (sent twice) and the verify call at the same moment',
  'The order is paid exactly once; intake rises by one serving only',
  `Webhooks HTTP ${hook.status}/${hook2.status}, verify ${ver.data?.order.status}; proteins ${intakeStaffPending.protein}% → ${intakeStaffPaid.protein}% (Moi moi adds ${moiDish.protein}%)`,
  hook.status === 200 && hook2.status === 200 && ver.data?.order.status === 'paid' && paidOnce === 1
    && Math.abs(intakeStaffPaid.protein - intakeStaffPending.protein - moiDish.protein) < 0.001);

// T56: 5 wrong delivery codes lock the order.
const realCode = (await staffOrders(staff)).find((o) => o.id === theirs.data.orderId).deliveryCode;
const wrong = String((Number(realCode) + 1) % 10000).padStart(4, '0');
await call(`/caterer/orders/${theirs.data.orderId}/status`, { method: 'PATCH', cookie: caterer, body: { status: 'preparing' } });
await call(`/caterer/orders/${theirs.data.orderId}/status`, { method: 'PATCH', cookie: caterer, body: { status: 'out_for_delivery' } });
const attempts = [];
for (let i = 0; i < 5; i += 1) attempts.push((await call(`/caterer/orders/${theirs.data.orderId}/deliver`, { method: 'POST', cookie: caterer, body: { code: wrong } })).status);
const rightAfterLock = await call(`/caterer/orders/${theirs.data.orderId}/deliver`, { method: 'POST', cookie: caterer, body: { code: realCode } });
log = (await call('/admin/audit-log', { cookie: admin })).data;
record('T56', 'Wrong delivery code 5 times', 'Caterer enters a wrong code 5 times, then the right one', 'Locked after the 5th; even the right code is refused; admin alerted',
  `Attempts ${attempts.join(', ')}; right code then HTTP ${rightAfterLock.status}; latest audit ${log[0]?.action}`,
  attempts.slice(0, 4).every((st) => st === 400) && attempts[4] === 423 && rightAfterLock.status === 423 && log[0]?.action === 'order.code_locked');

// T57: plates left resets at Lagos midnight.
const eba = await dishNamed('Eba and okra');
await pool.query('UPDATE meals SET stock_date = $1 WHERE meal_id = $2', [addDays(today, -1), eba.id]);
const ebaMenu = (await call('/catalogue', { cookie: newStaff })).data.unavailable.find((m) => m.id === eba.id);
const ebaCheckout = await checkoutCart(newStaff, one(eba.id));
record('T57', 'Plates left resets at Lagos midnight', `Eba and okra stock set on ${addDays(today, -1)}`, 'Not available today until the caterer sets new stock',
  `Menu label "${ebaMenu?.unavailable}"; checkout HTTP ${ebaCheckout.status}: ${ebaCheckout.data?.error}`,
  ebaMenu?.unavailable === 'Not available today' && ebaCheckout.status === 409);

// T58: a quantity above plates left is refused.
const fruit = await dishNamed('Fruit platter');
await setStock(fruit.id, 1);
const tooMany = (await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: [{ dishId: fruit.id, quantity: 2 }] } })).data;
const tooManyCheckout = await checkoutCart(newStaff, [{ dishId: fruit.id, quantity: 2 }]);
const lowLabel = (await call('/catalogue', { cookie: newStaff })).data.catalogue.find((m) => m.id === fruit.id)?.stockLabel;
record('T58', 'Quantity above plates left', 'Fruit platter has 1 plate left; cart asks for 2', 'Evaluate says no; checkout refused (409); staff see "Only 1 left"',
  `canCheckout=${tooMany.canCheckout} ("${tooMany.problems[0]?.message}"); checkout HTTP ${tooManyCheckout.status}; label "${lowLabel}"`,
  tooMany.canCheckout === false && tooManyCheckout.status === 409 && lowLabel === 'Only 1 left');

// T62: under G = 0 the same kind of cart only warns.
const softCart = (await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: [{ dishId: (await dishNamed('Jollof')).id, quantity: 2 }] } })).data;
record('T62', 'Going past 90% under soft guidance', 'G = 0; cart: 2 × Jollof rice and chicken (carbohydrates to over 90%)',
  'Checkout allowed with a strong warning; nothing locked',
  `canCheckout=${softCart.canCheckout}; warnings: ${softCart.warnings.map((w) => w.message).join(' | ')}`,
  softCart.canCheckout === true && softCart.warnings.some((w) => w.foodClass === 'carb' && ['Critical', 'Over'].includes(w.intakeLevel)));

// T64: extras with RDI values (yoghurt) count toward intake; add-ons (water) never do.
const yoghurt = await dishNamed('Yoghurt');
const lunch = await dishNamed('Balanced lunch');
const yogMenu = (await call('/catalogue', { cookie: newStaff })).data.extras.find((x) => x.id === yoghurt.id);
const yogOnly = (await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: one(yoghurt.id) } })).data;
const yogThree = await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: [{ dishId: yoghurt.id, quantity: 3 }] } });
const before64 = await intakeOf(newStaff);
const bought64 = await buy(newStaff, [{ dishId: lunch.id, quantity: 1 }, { dishId: yoghurt.id, quantity: 1 }, { dishId: water.id, quantity: 1 }]);
const after64 = await intakeOf(newStaff);
const rose = Object.fromEntries(['carb', 'protein', 'fat', 'vitamin', 'mineral'].map((c) => [c, Math.round((after64[c] - before64[c]) * 100) / 100]));
const expect64 = Object.fromEntries(['carb', 'protein', 'fat', 'vitamin', 'mineral'].map((c) => [c, Number(lunch[c]) + Number(yoghurt[c])]));
record('T64', 'Extras count toward intake; add-ons never do', 'Balanced lunch bowl + Yoghurt (1 cup) + Extra bottled water; then a yoghurt-only cart and 3 × yoghurt',
  'Intake rises by lunch + yoghurt only; yoghurt has a Fit signal; a cart needs a meal; at most 2 per order',
  `Yoghurt Fit "${yogMenu?.fit}"; intake rose ${JSON.stringify(rose)} (expected ${JSON.stringify(expect64)}); yoghurt-only: "${yogOnly.problems?.[0]?.message}"; 3 × yoghurt HTTP ${yogThree.status}`,
  yogMenu?.fit === 'Balanced' && bought64.order?.status === 'paid' && JSON.stringify(rose) === JSON.stringify(expect64)
    && yogOnly.canCheckout === false && yogOnly.problems?.[0]?.message === 'Add at least one meal to your cart' && yogThree.status === 400);

// T65: each meal line comes with bottled water at the admin's price; it can be removed per line.
const waterKobo65 = Math.round((await call('/admin/settings', { cookie: admin })).data.waterPrice * 100);
const withWater = (await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: [{ dishId: lunch.id, quantity: 2 }, { dishId: yoghurt.id, quantity: 1 }] } })).data;
const noWater = (await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: [{ dishId: lunch.id, quantity: 2, water: false }, { dishId: yoghurt.id, quantity: 1 }] } })).data;
const receipt = bought64.order;
const waterText = (l) => (l?.water ? `${l.water.quantity} × ${l.water.name} ${naira(l.water.lineTotalKobo)}${l.water.chosen === false ? ' (removed)' : ''}` : 'none');
const catererReceipt = (await call('/caterer/orders', { cookie: caterer })).data.find((o) => o.id === receipt?.id);
record('T65', 'Bottled water with each meal, charged and removable', '2 × Balanced lunch bowl + Yoghurt, with and without the water; the receipt of T64',
  'Water at the admin price per meal plate, in the subtotal; removing it takes it off; none for extras; the receipt keeps what was bought',
  `Water price ${naira(waterKobo65)}. With: lunch → ${waterText(withWater.lines[0])}, yoghurt → ${waterText(withWater.lines[1])}, subtotal ${naira(withWater.breakdown.subtotalKobo)}; without: ${waterText(noWater.lines[0])}, subtotal ${naira(noWater.breakdown.subtotalKobo)}; receipt: ${receipt?.items.map((i) => `${i.name} → ${waterText(i)}`).join('; ')}; caterer sees ${waterText(catererReceipt?.items[0])}`,
  waterKobo65 > 0 && withWater.lines[0].water?.chosen === true && withWater.lines[0].water.quantity === 2
    && withWater.lines[0].water.lineTotalKobo === waterKobo65 * 2 && withWater.lines[1].water === null
    && withWater.breakdown.subtotalKobo === lunch.priceKobo * 2 + waterKobo65 * 2 + yoghurt.priceKobo
    && noWater.lines[0].water?.chosen === false && noWater.breakdown.subtotalKobo === lunch.priceKobo * 2 + yoghurt.priceKobo
    && receipt?.items.filter((i) => i.type === 'meal').every((i) => i.water?.lineTotalKobo === waterKobo65 * i.quantity)
    && receipt?.items.filter((i) => i.type !== 'meal').every((i) => i.water === null)
    && catererReceipt?.items.some((i) => i.water?.quantity === 1));

// T76: the admin sets the water price; checkout uses the new price; audited.
const before76 = (await call('/admin/settings', { cookie: admin })).data;
const set76 = await call('/admin/settings', { method: 'PUT', cookie: admin, body: { vatRate: before76.vatRate, deliveryFee: before76.deliveryFee, waterPrice: 250 } });
const priced76 = (await call('/cart/evaluate', { method: 'POST', cookie: newStaff, body: { lines: [{ dishId: lunch.id, quantity: 1 }] } })).data;
const log76 = (await call('/admin/audit-log', { cookie: admin })).data.find((e) => e.action === 'settings.updated');
const badWater = await call('/admin/settings', { method: 'PUT', cookie: admin, body: { vatRate: before76.vatRate, deliveryFee: before76.deliveryFee, waterPrice: -5 } });
await call('/admin/settings', { method: 'PUT', cookie: admin, body: { vatRate: before76.vatRate, deliveryFee: before76.deliveryFee, waterPrice: before76.waterPrice } });
record('T76', 'Admin sets the bottled water price', `Water price ${naira(before76.waterPrice * 100)} → ₦250; then -₦5`,
  'Saved, used at checkout and audited; a negative price is refused',
  `Saved ${naira((set76.data?.waterPrice ?? 0) * 100)}; cart water ${naira(priced76.lines?.[0]?.water?.unitPriceKobo ?? 0)}; log ${log76?.action} (${JSON.stringify(log76?.details.to)}); -₦5 HTTP ${badWater.status}`,
  set76.status === 200 && set76.data.waterPrice === 250 && priced76.lines[0].water.unitPriceKobo === 25_000
    && log76?.details.to.waterPrice === 250 && badWater.status === 400);

// T59: today's revenue, paid and cancelled orders on the admin report.
const reportNow = (await call('/admin/report', { cookie: admin })).data;
const dbTotals = (await pool.query(
  `SELECT COALESCE(SUM(total_kobo) FILTER (WHERE status IN ('paid','preparing','out_for_delivery','delivered')), 0)::int AS revenue,
          COUNT(*) FILTER (WHERE status IN ('paid','preparing','out_for_delivery','delivered'))::int AS paid,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
   FROM orders WHERE order_date = $1`, [today],
)).rows[0];
record('T59', 'Admin report: revenue and orders today', 'Admin opens the report after the orders above', "Today's revenue, paid and cancelled orders match the database",
  `Revenue ${naira(reportNow.revenueTodayKobo)}, ${reportNow.ordersToday} paid, ${reportNow.cancelledToday} cancelled`,
  reportNow.revenueTodayKobo === dbTotals.revenue && reportNow.ordersToday === dbTotals.paid && reportNow.cancelledToday === dbTotals.cancelled);

// ---------- Daily reset (Africa/Lagos midnight) ----------
// Move today's intake and check-in to yesterday's Lagos date, as if midnight had passed.
const yesterday = addDays(today, -1);
const staffId = "(SELECT user_id FROM users WHERE email = 'staff@chopwise.ng')";
await pool.query(`UPDATE session_intake SET session_date = $1 WHERE user_id = ${staffId} AND session_date = $2`, [yesterday, today]);
await pool.query(`UPDATE daily_checkins SET checkin_date = $1 WHERE user_id = ${staffId} AND checkin_date = $2`, [yesterday, today]);
r = await call('/intake/today', { cookie: staff });
const total = Object.values(r.data.intake).reduce((a, b) => a + b, 0);
record('T14', 'New day begins', `Intake dated ${yesterday} (yesterday in Lagos)`, 'Intake resets to 0%', `Total intake on ${today} = ${total}%`, total === 0);

r = await call('/catalogue', { cookie: staff });
const fresh = (await call('/checkin/today', { cookie: staff })).data;
record('T36', 'New day needs a new check-in', `Check-in dated ${yesterday}`, "No check-in for the new day; ordering refused until it is done",
  `HTTP ${r.status} ${r.data?.code}; today's check-in = ${fresh?.checkin}`, r.status === 403 && r.data?.code === 'CHECKIN_REQUIRED' && fresh?.checkin === null);

// ---------- Caterer accounts (admin-given temporary passwords) ----------
// The logins above used up this IP's login limit (T19), so these run on a second copy of the API,
// as a new 15-minute window would.
const accountsServer = createApp().listen(0, '127.0.0.1');
await new Promise((resolve) => accountsServer.once('listening', resolve));
const BASE2 = `http://127.0.0.1:${accountsServer.address().port}/api`;
const call2 = (path, opts = {}) => call(path, { ...opts, base: BASE2 });
const login2 = (email, password) => call2('/auth/login', { method: 'POST', body: { email, password } });

// T66: an admin creates a caterer with a temporary password, which must be changed at first login.
const newCatererEmail = `kitchen.${Date.now()}@chopwise.ng`;
const created = await call2('/admin/caterers', { method: 'POST', cookie: admin, body: { name: 'Scenario Kitchen', email: newCatererEmail, password: 'temporary-pass-1' } });
const first = await login2(newCatererEmail, 'temporary-pass-1');
const gated = await call2('/caterer/dishes', { cookie: first.cookie });
const changed = await call2('/auth/change-password', { method: 'POST', cookie: first.cookie, body: { currentPassword: 'temporary-pass-1', newPassword: 'kitchen-own-pass-1' } });
// Changing the password gives this session a new cookie and signs out the old one.
const open = await call2('/caterer/dishes', { cookie: changed.cookie });
const oldCookie = await call2('/caterer/dishes', { cookie: first.cookie });
log = (await call2('/admin/audit-log', { cookie: admin })).data;
const createdEntry = log.find((e) => e.action === 'user.created' && e.details.email === newCatererEmail);
const changedEntry = log.find((e) => e.action === 'password.changed' && e.details.email === newCatererEmail);
record('T66', 'New caterer must change a temporary password', 'Admin creates a caterer with "temporary-pass-1"; the caterer logs in',
  'Every caterer page refused until the password is changed; then open; both steps audited (no password in the log)',
  `Create HTTP ${created.status}; login mustChangePassword=${first.data?.user.mustChangePassword}; dishes HTTP ${gated.status} ${gated.data?.code}; change HTTP ${changed.status}; dishes then HTTP ${open.status} (old cookie ${oldCookie.status}); log: ${createdEntry?.action}, ${changedEntry?.action}`,
  created.status === 201 && created.data?.mustChangePassword === true && first.data?.user.mustChangePassword === true
    && gated.status === 403 && gated.data?.code === 'PASSWORD_CHANGE_REQUIRED' && changed.status === 200 && changed.data?.user.mustChangePassword === false
    && open.status === 200 && oldCookie.status === 401 && createdEntry?.details.temporaryPassword === true && Boolean(changedEntry)
    && !JSON.stringify(log).includes('temporary-pass-1') && !JSON.stringify(log).includes('kitchen-own-pass-1'));

// T67: an admin resets a caterer's password; only caterers can be reset this way.
const kitchen = (await call2(`/admin/users?q=${encodeURIComponent(newCatererEmail)}`, { cookie: admin })).data[0];
const reset = await call2(`/admin/users/${kitchen.id}/reset-password`, { method: 'POST', cookie: admin, body: { password: 'reset-temp-pass-2' } });
const oldPass = await login2(newCatererEmail, 'kitchen-own-pass-1');
const tempPass = await login2(newCatererEmail, 'reset-temp-pass-2');
const staffReset = await call2(`/admin/users/${staff2.id}/reset-password`, { method: 'POST', cookie: admin, body: { password: 'reset-temp-pass-2' } });
const byCaterer = await call2(`/admin/users/${kitchen.id}/reset-password`, { method: 'POST', cookie: caterer, body: { password: 'reset-temp-pass-2' } });
log = (await call2('/admin/audit-log', { cookie: admin })).data;
const resetEntry = log.find((e) => e.action === 'user.password_reset' && e.details.email === newCatererEmail);
record('T67', "Admin resets a caterer's password", 'Admin gives "reset-temp-pass-2"; the caterer logs in; admin tries the same on a staff account; a caterer tries it',
  'Old password stops working; the temporary one works and must be changed; audited; staff reset refused (409); caterer refused (403)',
  `Reset HTTP ${reset.status}; old password HTTP ${oldPass.status}; temporary HTTP ${tempPass.status}, mustChangePassword=${tempPass.data?.user.mustChangePassword}; staff reset HTTP ${staffReset.status}; by caterer HTTP ${byCaterer.status}; log ${resetEntry?.action}`,
  reset.status === 200 && oldPass.status === 401 && tempPass.status === 200 && tempPass.data?.user.mustChangePassword === true
    && staffReset.status === 409 && byCaterer.status === 403 && Boolean(resetEntry) && !JSON.stringify(log).includes('reset-temp-pass-2'));

// ---------- Forgot password (CLAUDE.md item 18) ----------
// T68: the same answer for a real and an unknown email; only the hash of the token is stored.
const resetEmail = 'staff2@chopwise.ng';
const known = await call2('/auth/forgot-password', { method: 'POST', body: { email: resetEmail } });
const unknownReset = await call2('/auth/forgot-password', { method: 'POST', body: { email: 'nobody.here@chopwise.ng' } });
const token1 = lastLink(resetEmail);
const storedReset = (await pool.query(
  `SELECT r.token_hash, EXTRACT(EPOCH FROM r.expires_at - r.created_at)::int AS secs FROM password_resets r JOIN users u USING (user_id)
   WHERE u.email = $1 ORDER BY r.reset_id DESC LIMIT 1`, [resetEmail],
)).rows[0];
record('T68', 'Forgot password reveals nothing', `${resetEmail}, then an email with no account`,
  'Same status and message for both; a 64-character token emailed, only its SHA-256 hash stored, valid 30 minutes',
  `HTTP ${known.status} "${known.data?.message}" / HTTP ${unknownReset.status} "${unknownReset.data?.message}"; link emailed=${Boolean(token1)}; stored hash ${storedReset?.token_hash === token1 ? 'equals' : 'differs from'} the token; valid ${storedReset?.secs / 60} min; links for unknown = ${mailbox.filter((m) => m.email === 'nobody.here@chopwise.ng').length}`,
  known.status === 200 && unknownReset.status === 200 && JSON.stringify(known.data) === JSON.stringify(unknownReset.data)
    && known.data?.message === "If an account exists for that email, we've sent a reset link."
    && /^[0-9a-f]{64}$/.test(token1 ?? '') && storedReset?.token_hash !== token1 && /^[0-9a-f]{64}$/.test(storedReset?.token_hash ?? '') && storedReset?.secs === 1800
    && mailbox.every((m) => m.email !== 'nobody.here@chopwise.ng'));

// T69: the link works once, clears a lockout and is audited; T71: it signs out every other session.
const staff2Session = (await login2(resetEmail, DEMO_PASSWORD)).cookie;
const before71 = await call2('/auth/me', { cookie: staff2Session });
await pool.query("UPDATE users SET failed_attempts = 5, locked_until = NOW() + interval '15 minutes' WHERE email = $1", [resetEmail]);
const newStaff2Password = 'staff2-new-pass-1';
const used = await call2('/auth/reset-password', { method: 'POST', body: { token: token1, password: newStaff2Password, confirmPassword: newStaff2Password } });
const again = await call2('/auth/reset-password', { method: 'POST', body: { token: token1, password: 'staff2-other-pass', confirmPassword: 'staff2-other-pass' } });
const after71 = await call2('/auth/me', { cookie: staff2Session });
const loginNew = await login2(resetEmail, newStaff2Password);
log = (await call2('/admin/audit-log', { cookie: admin })).data;
const resetAudit = log.find((e) => e.action === 'password.reset_by_email' && e.details.email === resetEmail);
record('T69', 'A reset link works once', `Locked ${resetEmail} opens the emailed link and sets a new password; then the same link again`,
  'First use resets the password, clears the lockout and is audited; second use refused',
  `First HTTP ${used.status}; second HTTP ${again.status}: ${again.data?.error}; login with the new password HTTP ${loginNew.status}; log ${resetAudit?.action}`,
  used.status === 200 && again.status === 400 && loginNew.status === 200 && Boolean(resetAudit) && !JSON.stringify(log).includes(newStaff2Password));
record('T71', 'A reset signs out every session', `${resetEmail} logged in before the reset`, 'The old session is refused after the reset',
  `/auth/me before HTTP ${before71.status}; after HTTP ${after71.status}: ${after71.data?.error}`,
  before71.status === 200 && after71.status === 401);

// T70: a link stops working after 30 minutes.
await call2('/auth/forgot-password', { method: 'POST', body: { email: resetEmail } });
const token2 = lastLink(resetEmail);
await pool.query(
  "UPDATE password_resets SET created_at = created_at - interval '31 minutes', expires_at = expires_at - interval '31 minutes' WHERE token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
  [token2],
);
const expiredLink = await call2('/auth/reset-password', { method: 'POST', body: { token: token2, password: 'staff2-late-pass-1', confirmPassword: 'staff2-late-pass-1' } });
const stillOld = await login2(resetEmail, newStaff2Password);
record('T70', 'A reset link expires after 30 minutes', 'A new link, opened 31 minutes after it was sent', 'Refused; the password is unchanged',
  `HTTP ${expiredLink.status}: ${expiredLink.data?.error}; the password from T69 still works (HTTP ${stillOld.status})`,
  token2 !== token1 && expiredLink.status === 400 && stillOld.status === 200);

// ---------- Feedback pop-up (CLAUDE.md item 17) ----------
// Each delivery goes through the caterer with the staff member's code, as in T45.
async function deliverNextOrder(cookie) {
  const order = (await staffOrders(cookie)).find((o) => o.status === 'paid');
  if (!order) return null;
  await call('/caterer/orders/' + order.id + '/status', { method: 'PATCH', cookie: caterer, body: { status: 'preparing' } });
  await call('/caterer/orders/' + order.id + '/status', { method: 'PATCH', cookie: caterer, body: { status: 'out_for_delivery' } });
  return (await call('/caterer/orders/' + order.id + '/deliver', { method: 'POST', cookie: caterer, body: { code: order.deliveryCode } })).data?.status;
}
const prompt = async (cookie) => (await call('/feedback/prompt', { cookie })).data;

// T72: shown after the 2nd delivered order (staff@ has 2 from the demo history; the new staff member has 1).
const p72 = await prompt(staff);
const p72new = await prompt(newStaff);
record('T72', 'Feedback pop-up after the 2nd delivered order', 'staff@ (2 delivered orders, all time) and the new staff member (1)',
  'Shown to staff@ only', `staff@ show=${p72.show}; new staff show=${p72new.show}`, p72.show === true && p72new.show === false);

// T73: "Not now" postpones it to the next delivered order; never more than 3 times.
const shown1 = (await call('/feedback/prompt/shown', { method: 'POST', cookie: staff })).data;
const shownTwice = (await call('/feedback/prompt/shown', { method: 'POST', cookie: staff })).data;
const afterNotNow = await prompt(staff);
const delivered73 = await deliverNextOrder(staff);
const afterDelivery = await prompt(staff);
const staffUserId = (await pool.query("SELECT user_id FROM users WHERE email = 'staff@chopwise.ng'")).rows[0].user_id;
await pool.query('UPDATE feedback_prompts SET times_shown = 3, shown_at_delivered = 0 WHERE user_id = $1', [staffUserId]);
const afterThree = await prompt(staff);
await pool.query('UPDATE feedback_prompts SET times_shown = 1, shown_at_delivered = 0 WHERE user_id = $1', [staffUserId]);
record('T73', 'Feedback "Not now" and the 3-time limit', 'Shown, "Not now"; another order delivered; then shown 3 times already',
  'Hidden until the next delivered order; never after the 3rd showing; one showing counted once',
  `times shown ${shown1.timesShown} (repeat call counted: ${shownTwice.recorded}); after "Not now" show=${afterNotNow.show}; next order ${delivered73}, show=${afterDelivery.show}; after 3 showings show=${afterThree.show}`,
  shown1.recorded === true && shown1.timesShown === 1 && shownTwice.recorded === false && afterNotNow.show === false
    && delivered73 === 'delivered' && afterDelivery.show === true && afterThree.show === false);

// T74: submitted once, stored, then never shown again; only admins read it.
const answer = { orderingScore: 5, guidanceScore: 4, changedOrder: 'yes', comment: 'Scenario comment: the cut-off warning helped me choose.' };
const sent = await call('/feedback', { method: 'POST', cookie: staff, body: answer });
const sentAgain = await call('/feedback', { method: 'POST', cookie: staff, body: answer });
const tooEarly = await call('/feedback', { method: 'POST', cookie: newStaff, body: answer });
const afterSubmit = await prompt(staff);
const staffReads = await call('/admin/report', { cookie: staff });
const catererReads = await call('/admin/report', { cookie: caterer });
const fbReport = (await call('/admin/report', { cookie: admin })).data?.feedback;
const fbRows = (await pool.query('SELECT ordering_score, guidance_score, changed_order FROM feedback')).rows;
const avgOrdering = Math.round((fbRows.reduce((s, x) => s + x.ordering_score, 0) / fbRows.length) * 10) / 10;
record('T74', 'Feedback is stored once and read by admins only', 'staff@ answers 5, 4, Yes and a comment; sends it again; the new staff member tries; staff and caterer open the report',
  'Saved once (409 the second time); not shown again; refused before 2 deliveries; report shows averages, the split, the count and the comment to admins only',
  `HTTP ${sent.status}, again ${sentAgain.status}, new staff ${tooEarly.status}; show after=${afterSubmit.show}; report: staff ${staffReads.status}, caterer ${catererReads.status}; admin sees ${fbReport?.responses} responses, ordering ${fbReport?.averageOrdering}, guidance ${fbReport?.averageGuidance}, split ${JSON.stringify(fbReport?.changedOrder)}`,
  sent.status === 201 && sentAgain.status === 409 && tooEarly.status === 409 && afterSubmit.show === false
    && staffReads.status === 403 && catererReads.status === 403 && fbReport?.responses === fbRows.length && fbReport.averageOrdering === avgOrdering
    && fbReport.changedOrder.yes === fbRows.filter((x) => x.changed_order === 'yes').length
    && fbReport.latestComments[0]?.comment === answer.comment && !('userId' in fbReport.latestComments[0]));

console.log = consoleLog;
accountsServer.closeAllConnections();
accountsServer.close();
apiServer.closeAllConnections();
apiServer.close();
mock.close();
await pool.end();
const order = (x) => Number(x.id.slice(1));
results.sort((a, b) => order(a) - order(b));
console.table(results.map(({ id: tid, description, actual, result }) => ({ id: tid, description, actual, result })));
console.log(JSON.stringify(results));
if (results.some((x) => x.result === 'Fail')) process.exitCode = 1;
