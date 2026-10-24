// Creates the schema and loads demo data: node src/db/setup.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { classifyMeal } from '../logic/meal.js';
import { hashPassword } from '../services/passwords.js';
import { DISH_PHOTO_DIR } from '../services/photos.js';
import { randomUUID } from 'node:crypto';
import { todayInLagos, addDays } from '../logic/time.js';
import { vatKobo } from '../logic/checkout.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Demo meals. Percentages are illustrative values a caterer would enter (% of daily RDI per serving).
const MEALS = [
  ['Jollof rice and chicken', 48, 22, 18, 7, 5],
  ['White rice and stew', 52, 12, 20, 6, 4],
  ['Pounded yam and egusi soup', 55, 18, 28, 12, 10],
  ['Eba and okra soup', 50, 10, 15, 14, 12],
  ['Fried plantain and beans', 34, 26, 22, 9, 8],
  ['Moi moi and pap', 22, 24, 10, 8, 7],
  ['Grilled fish and vegetables', 10, 40, 12, 25, 18],
  ['Suya and onions', 6, 45, 30, 5, 6],
  ['Vegetable salad with egg', 8, 15, 10, 32, 20],
  ['Fruit platter', 18, 3, 1, 38, 15],
  ['Ofada rice and ayamase', 46, 15, 32, 8, 6],
  ['Balanced lunch bowl (rice, beans, fish, greens)', 30, 28, 14, 22, 15],
  ['Yam porridge with vegetables', 32, 10, 12, 20, 14],
  ['Akara and custard', 25, 18, 24, 6, 6],
  // Estimated from published composition data; confirm with the caterer.
  ['Moi moi (1 wrap)', 13, 28, 6, 10, 15],
  ['Okpa (1 wrap)', 24, 36, 35, 8, 15],
  ['Achicha', 25, 24, 19, 25, 15],
  ['Ayaraya oka (otipi)', 28, 26, 18, 15, 14],
  ['Ayaraya ji', 38, 22, 15, 14, 12],
];

// Extras: RDI values, approval and intake like a meal, but not a meal (no check-in, no free water).
// Estimated from published composition data; confirm with the caterer.
const EXTRAS = [
  ['Yoghurt (1 cup)', 11, 14, 8, 8, 20],
];

// Sample prices in naira (stored as kobo). Illustrative only; caterers set their own.
const SAMPLE_PRICES_NAIRA = {
  'Jollof rice and chicken': 2500,
  'White rice and stew': 1800,
  'Pounded yam and egusi soup': 3000,
  'Eba and okra soup': 2000,
  'Fried plantain and beans': 1500,
  'Moi moi and pap': 1200,
  'Grilled fish and vegetables': 3500,
  'Suya and onions': 2000,
  'Vegetable salad with egg': 1500,
  'Fruit platter': 1000,
  'Ofada rice and ayamase': 2800,
  'Balanced lunch bowl (rice, beans, fish, greens)': 3200,
  'Yam porridge with vegetables': 1800,
  'Akara and custard': 1000,
  // Placeholders until the caterer sets the real prices.
  'Moi moi (1 wrap)': 1000,
  'Okpa (1 wrap)': 1000,
  Achicha: 1500,
  'Ayaraya oka (otipi)': 2000,
  'Ayaraya ji': 2500,
  'Yoghurt (1 cup)': 1000,
};

// Sample add-ons: no RDI values, no approval, never part of intake. Every meal already comes with
// one bottle of water at no charge; this is for anyone who wants another.
const ADD_ONS = [['Extra bottled water', 300]];

// Sample staff accounts for the demo and system tests. The admin and the sample caterer are not
// here: they come from .env. The password meets the 10-character rule.
const DEMO_PASSWORD = 'password123';
const DEMO_USERS = [
  ['Dr. Ada Okafor', 'staff@chopwise.ng', 'staff'],
  ['Mr. Emeka Obi', 'staff2@chopwise.ng', 'staff'],
];

// VAT starts at Nigeria's standard rate of 7.5%. The delivery fee starts at ₦0 until the admin sets it.
const DEFAULT_SETTINGS = { vatRate: 7.5, deliveryFee: 0 };

// An account from .env (the first admin, the sample caterer), checked before anything is built.
function accountFromEnv(prefix, label, defaultName, problems) {
  const email = (process.env[`${prefix}_EMAIL`] || '').trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`] || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`${prefix}_EMAIL must be a valid email`);
  if (password.length < 10) problems.push(`${prefix}_PASSWORD must be at least 10 characters`);
  if (password === DEMO_PASSWORD) problems.push(`${prefix}_PASSWORD must not be the demo staff password`);
  if (DEMO_USERS.some(([, e]) => e === email)) problems.push(`${prefix}_EMAIL must not be one of the demo staff accounts`);
  return { label, name: process.env[`${prefix}_NAME`]?.trim() || defaultName, email, password };
}

function accountsFromEnv() {
  const problems = [];
  const admin = accountFromEnv('ADMIN', 'Admin', 'System Administrator', problems);
  const caterer = accountFromEnv('CATERER', 'Caterer', 'Campus Kitchen', problems);
  if (admin.email && admin.email === caterer.email) problems.push('ADMIN_EMAIL and CATERER_EMAIL must be different');
  if (problems.length) throw new Error(`Set the sample accounts in server/.env: ${problems.join('; ')}`);
  return { admin, caterer };
}

async function main() {
  // Check .env before touching the database, so a bad config never leaves it half-built.
  const { admin, caterer } = accountsFromEnv();
  const schema = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8');
  await pool.query(`
    DROP TABLE IF EXISTS feedback, feedback_prompts, password_resets, order_items, daily_checkins, audit_log, settings, notifications, health_profiles, session_intake, orders, meals, users CASCADE;
    DROP TYPE IF EXISTS user_role, intake_level, meal_source, dish_type, order_status, feedback_answer CASCADE;
  `);
  await pool.query(schema);
  // The rebuilt database refers to no photos, so remove the old files with it.
  await fs.promises.rm(DISH_PHOTO_DIR, { recursive: true, force: true });

  const users = [
    [admin.name, admin.email, 'admin', admin.password],
    [caterer.name, caterer.email, 'caterer', caterer.password],
    ...DEMO_USERS.map((u) => [...u, DEMO_PASSWORD]),
  ];
  const ids = {};
  for (const [name, email, role, password] of users) {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING user_id',
      [name, email, await hashPassword(password), role],
    );
    ids[email] = rows[0].user_id;
  }
  await pool.query('INSERT INTO settings (vat_rate, delivery_fee) VALUES ($1, $2)', [DEFAULT_SETTINGS.vatRate, DEFAULT_SETTINGS.deliveryFee]);
  // Both demo staff have answered the health question. staff@ has hypertension that is not
  // a declared condition (H = 1); staff2@ has no condition (H = 0).
  await pool.query(
    `INSERT INTO health_profiles (user_id, has_condition, conditions, is_controlled, answered_at, updated_at) VALUES
       ($1, TRUE, '{Hypertension}', FALSE, NOW(), NOW()), ($2, FALSE, '{}', FALSE, NOW(), NOW())`,
    [ids['staff@chopwise.ng'], ids['staff2@chopwise.ng']],
  );

  // Sample meals start approved, with their approved RDI values recorded. No photos: the
  // placeholder shows until the caterer uploads real ones.
  const mealIds = {};
  const catererId = ids[caterer.email];
  // The dominant class and balanced flag come from the same logic the app uses (logic/meal.js).
  for (const [type, list] of [['meal', MEALS], ['extra', EXTRAS]]) {
    for (const [name, carb, protein, fat, vitamin, mineral] of list) {
      const rdi = { carb, protein, fat, vitamin, mineral };
      const { dominantClass, isBalanced } = classifyMeal(rdi);
      const { rows } = await pool.query(
        `INSERT INTO meals (caterer_id, dish_type, name, price_kobo, carb_percent, protein_percent, fat_percent,
           vitamin_percent, mineral_percent, dominant_class, is_balanced, is_approved, approved_values, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,NOW()) RETURNING meal_id`,
        [catererId, type, name, SAMPLE_PRICES_NAIRA[name] * 100, carb, protein, fat, vitamin, mineral, dominantClass, isBalanced, rdi],
      );
      mealIds[name] = rows[0].meal_id;
    }
  }
  for (const [name, naira] of ADD_ONS) {
    await pool.query(
      "INSERT INTO meals (caterer_id, dish_type, name, price_kobo, is_approved) VALUES ($1,'addon',$2,$3,TRUE)",
      [catererId, name, naira * 100],
    );
  }

  // Order history from more than a day ago, so the check-in has something to pre-fill and
  // none of it counts as today's orders. Listed oldest first.
  const HISTORY = {
    'staff@chopwise.ng': ['White rice and stew', 'Jollof rice and chicken'],
    'staff2@chopwise.ng': ['Moi moi and pap', 'Fruit platter'],
  };
  // Each is a delivered one-meal order, paid at the time and with no delivery fee.
  const yesterday = addDays(todayInLagos(), -1);
  for (const [email, names] of Object.entries(HISTORY)) {
    for (const [i, name] of names.entries()) {
      const meal = MEALS.find(([n]) => n === name);
      const price = SAMPLE_PRICES_NAIRA[name] * 100;
      const vat = vatKobo(price, DEFAULT_SETTINGS.vatRate);
      const hoursAgo = 30 - i * 2;
      const { rows } = await pool.query(
        `INSERT INTO orders (user_id, caterer_id, status, order_date, subtotal_kobo, vat_rate, vat_kobo, delivery_fee_kobo,
           total_kobo, paystack_reference, reserved_until, paid_at, ordered_at, status_updated_at, code_hash)
         VALUES ($1,$2,'delivered',$3,$4,$5,$6,0,$7,$8, NOW() - make_interval(hours => $9), NOW() - make_interval(hours => $9),
           NOW() - make_interval(hours => $9), NOW() - make_interval(hours => $9), $10)
         RETURNING order_id`,
        [ids[email], catererId, yesterday, price, DEFAULT_SETTINGS.vatRate, vat, price + vat, `CW-${randomUUID()}`, hoursAgo, '0'.repeat(64)],
      );
      await pool.query(
        `INSERT INTO order_items (order_id, meal_id, dish_type, name, unit_price_kobo, quantity, line_total_kobo,
           carb_percent, protein_percent, fat_percent, vitamin_percent, mineral_percent)
         VALUES ($1,$2,'meal',$3,$4,1,$4,$5,$6,$7,$8,$9)`,
        [rows[0].order_id, mealIds[name], name, price, ...meal.slice(1)],
      );
    }
  }

  // Feedback (CLAUDE.md item 17): both demo staff have 2 delivered orders. staff2@ has already
  // answered with this sample response, so the admin report has something to show; staff@ hasn't,
  // so the pop-up appears the next time staff@ opens the app.
  await pool.query(
    "INSERT INTO feedback (user_id, ordering_score, guidance_score, changed_order, comment) VALUES ($1, 4, 5, 'sometimes', $2)",
    [ids['staff2@chopwise.ng'], "Sample response (demo data): it would help to see tomorrow's menu in the evening."],
  );

  // Today's plates left, so the demo can order straight away. Stock resets at Lagos midnight,
  // after which the caterer sets new numbers on the My dishes page.
  await pool.query('UPDATE meals SET stock_date = $1, plates_left = CASE WHEN dish_type = $2 THEN 50 ELSE 20 END',
    [todayInLagos(), 'addon']);
  console.log(`Database ready: ${users.length} users, ${MEALS.length} meals, ${EXTRAS.length} extras, ${ADD_ONS.length} add-ons.`);
  // Sample accounts, so the demo can be opened straight away (local development only).
  console.log('\nSample accounts (email / password):');
  console.log(`  Admin    ${admin.email} / ${admin.password}   (ADMIN_EMAIL, ADMIN_PASSWORD in server/.env)`);
  console.log(`  Caterer  ${caterer.email} / ${caterer.password}   (CATERER_EMAIL, CATERER_PASSWORD in server/.env)`);
  for (const [, email] of DEMO_USERS) console.log(`  Staff    ${email} / ${DEMO_PASSWORD}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
