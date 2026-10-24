// Adds the sample data (demo staff, the sample caterer, dishes, order history, today's stock):
//   npm run db:seed
// Run db:migrate first. It only adds rows; if the sample data is already there it adds nothing.
// Prints every sample account's email and password at the end.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { classifyMeal } from '../logic/meal.js';
import { hashPassword } from '../services/passwords.js';
import { todayInLagos, addDays } from '../logic/time.js';
import { vatKobo } from '../logic/checkout.js';
import { DEMO_PASSWORD, DEMO_USERS, accountsFromEnv } from './accounts.js';

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

// Order history from more than a day ago, so the check-in has something to pre-fill and none of
// it counts as today's orders. Listed oldest first.
const HISTORY = {
  'staff@chopwise.ng': ['White rice and stew', 'Jollof rice and chicken'],
  'staff2@chopwise.ng': ['Moi moi and pap', 'Fruit platter'],
};

/** Adds the sample data. Returns false (and adds nothing) if it is already there. */
export async function seed(db = pool) {
  // Check .env before adding anything, so a bad config never leaves the data half-built.
  const { admin, caterer } = accountsFromEnv();
  if ((await db.query('SELECT 1 FROM users WHERE email = $1', [DEMO_USERS[0][1]])).rowCount) return false;

  const ids = {};
  const existing = await db.query('SELECT user_id FROM users WHERE email = $1', [caterer.email]);
  ids[caterer.email] = existing.rows[0]?.user_id ?? (await db.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'caterer') RETURNING user_id",
    [caterer.name, caterer.email, await hashPassword(caterer.password)],
  )).rows[0].user_id;
  for (const [name, email, role] of DEMO_USERS) {
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING user_id',
      [name, email, await hashPassword(DEMO_PASSWORD), role],
    );
    ids[email] = rows[0].user_id;
  }
  // Both demo staff have answered the health question: staff@ declared hypertension (H = 1);
  // staff2@ has no condition (H = 0).
  await db.query(
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
      const { rows } = await db.query(
        `INSERT INTO meals (caterer_id, dish_type, name, price_kobo, carb_percent, protein_percent, fat_percent,
           vitamin_percent, mineral_percent, dominant_class, is_balanced, is_approved, approved_values, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,NOW()) RETURNING meal_id`,
        [catererId, type, name, SAMPLE_PRICES_NAIRA[name] * 100, carb, protein, fat, vitamin, mineral, dominantClass, isBalanced, rdi],
      );
      mealIds[name] = rows[0].meal_id;
    }
  }
  for (const [name, naira] of ADD_ONS) {
    await db.query("INSERT INTO meals (caterer_id, dish_type, name, price_kobo, is_approved) VALUES ($1,'addon',$2,$3,TRUE)",
      [catererId, name, naira * 100]);
  }

  // Each history entry is a delivered one-meal order, paid at the time, with no delivery fee.
  const { vat_rate: vatRate } = (await db.query('SELECT vat_rate FROM settings WHERE setting_id = 1')).rows[0];
  const yesterday = addDays(todayInLagos(), -1);
  for (const [email, names] of Object.entries(HISTORY)) {
    for (const [i, name] of names.entries()) {
      const meal = MEALS.find(([n]) => n === name);
      const price = SAMPLE_PRICES_NAIRA[name] * 100;
      const vat = vatKobo(price, vatRate);
      const hoursAgo = 30 - i * 2;
      const { rows } = await db.query(
        `INSERT INTO orders (user_id, caterer_id, status, order_date, subtotal_kobo, vat_rate, vat_kobo, delivery_fee_kobo,
           total_kobo, paystack_reference, reserved_until, paid_at, ordered_at, status_updated_at, code_hash)
         VALUES ($1,$2,'delivered',$3,$4,$5,$6,0,$7,$8, NOW() - make_interval(hours => $9), NOW() - make_interval(hours => $9),
           NOW() - make_interval(hours => $9), NOW() - make_interval(hours => $9), $10)
         RETURNING order_id`,
        [ids[email], catererId, yesterday, price, vatRate, vat, price + vat, `CW-${randomUUID()}`, hoursAgo, '0'.repeat(64)],
      );
      await db.query(
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
  await db.query(
    "INSERT INTO feedback (user_id, ordering_score, guidance_score, changed_order, comment) VALUES ($1, 4, 5, 'sometimes', $2)",
    [ids['staff2@chopwise.ng'], "Sample response (demo data): it would help to see tomorrow's menu in the evening."],
  );

  // Today's plates left, so the demo can order straight away. Stock resets at Lagos midnight.
  await db.query('UPDATE meals SET stock_date = $1, plates_left = CASE WHEN dish_type = $2 THEN 50 ELSE 20 END WHERE caterer_id = $3',
    [todayInLagos(), 'addon', catererId]);

  console.log(`Sample data added: ${DEMO_USERS.length + 1} users, ${MEALS.length} meals, ${EXTRAS.length} extras, ${ADD_ONS.length} add-ons.`);
  printAccounts(admin, caterer);
  return true;
}

// Every sample account, so the demo can be opened straight away.
export function printAccounts(admin, caterer) {
  console.log('\nSample accounts (email / password):');
  console.log(`  Admin    ${admin.email} / ${admin.password}   (ADMIN_EMAIL, ADMIN_PASSWORD in .env)`);
  console.log(`  Caterer  ${caterer.email} / ${caterer.password}   (CATERER_EMAIL, CATERER_PASSWORD in .env)`);
  for (const [, email] of DEMO_USERS) console.log(`  Staff    ${email} / ${DEMO_PASSWORD}`);
}

// Run directly: npm run db:seed
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed()
    .then((added) => { if (!added) console.log('The sample data is already there, so nothing was added.'); })
    .catch((e) => { console.error(e.message ?? e); process.exitCode = 1; })
    .finally(() => pool.end());
}
