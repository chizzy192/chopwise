// Connects the database to the decision engine. G comes from today's stored check-in
// (services/checkin.js) and is never recalculated during the day.
// `db` is the pool or a transaction client; `date` is an Africa/Lagos date from todayInLagos().
import { pool } from '../db/pool.js';
import { FOOD_CLASSES } from '../logic/constants.js';
import { TIMEZONE } from '../logic/time.js';
import { evaluate, emptyIntake, addMeal, alternativesFor } from '../logic/engine.js';
import { splitMenu } from '../logic/dish.js';
import { platesLeft, stockLabel, unavailableReason } from '../logic/checkout.js';
import { photoUrl } from './photos.js';

// One shape for meals and add-ons; add-ons have null RDI values.
export function rowToMeal(r) {
  return {
    id: r.meal_id, name: r.name, catererId: r.caterer_id, type: r.dish_type,
    description: r.description, photoUrl: photoUrl(r.photo), priceKobo: r.price_kobo,
    carb: r.carb_percent, protein: r.protein_percent, fat: r.fat_percent,
    vitamin: r.vitamin_percent, mineral: r.mineral_percent,
    dominantClass: r.dominant_class, isBalanced: r.is_balanced, isApproved: r.is_approved,
    soldOutOn: r.sold_out_on, stockDate: r.stock_date, platesLeft: r.plates_left,
    // Display only; present where the query joins the caterer (the staff menu).
    ...(r.caterer_name !== undefined ? { catererName: r.caterer_name } : {}),
  };
}

// The staff-facing shape: today's plates left and label instead of raw stock fields.
export function forStaff(dish, today) {
  const { stockDate, soldOutOn, ...rest } = dish;
  return { ...rest, platesLeft: platesLeft(dish, today), stockLabel: stockLabel(dish, today), unavailable: unavailableReason(dish, today) };
}

async function approvedOfType(type, db) {
  const { rows } = await db.query(
    'SELECT m.*, u.name AS caterer_name FROM meals m JOIN users u ON u.user_id = m.caterer_id WHERE m.is_approved AND m.dish_type = $1 ORDER BY m.name',
    [type],
  );
  return rows.map(rowToMeal);
}

export const approvedAddons = (db = pool) => approvedOfType('addon', db);
// Extras (yoghurt) have RDI values: they get a Fit signal and count toward intake, like meals.
export const approvedExtras = (db = pool) => approvedOfType('extra', db);

// Approved meals (never extras or add-ons): the check-in list and the decision engine's input.
export const approvedMeals = (db = pool) => approvedOfType('meal', db);

export async function todayIntake(userId, date, db = pool) {
  const { rows } = await db.query(
    'SELECT * FROM session_intake WHERE user_id = $1 AND session_date = $2', [userId, date],
  );
  if (!rows.length) return emptyIntake();
  const r = rows[0];
  return { carb: r.carb_total, protein: r.protein_total, fat: r.fat_total, vitamin: r.vitamin_total, mineral: r.mineral_total };
}

// Catalogue for today, using the gate values stored by today's check-in. Meals that can't be
// ordered today (sold out, no stock set, or 0 plates left) are left out of the engine, so they
// are never suggested as alternatives, and listed separately with the reason.
export async function catalogueFor(userId, checkin, date, db = pool) {
  const { available: notSwitchedOff, soldOut } = splitMenu(await approvedMeals(db), date);
  const available = notSwitchedOff.filter((m) => !unavailableReason(m, date));
  const unavailable = [...soldOut, ...notSwitchedOff.filter((m) => unavailableReason(m, date))];
  const intake = await todayIntake(userId, date, db);
  const result = evaluate({ gate: checkin.g, intake, meals: available });
  // Extras get the same Fit rules. Their alternatives are meals, as for any locked dish.
  const allExtras = await approvedExtras(db);
  const extrasNow = allExtras.filter((x) => !unavailableReason(x, date));
  const extraFit = new Map(evaluate({ gate: checkin.g, intake, meals: extrasNow }).catalogue
    .map((x) => [x.id, { ...x, alternatives: x.locked ? alternativesFor(x, result.catalogue, intake) : [] }]));
  return {
    checkinDate: checkin.checkin_date,
    inputs: { H: checkin.h, P1: checkin.p1, P2: checkin.p2 },
    intake,
    ...result,
    catalogue: result.catalogue.map((m) => ({ ...forStaff(m, date), fit: m.fit, locked: m.locked, why: m.why, alternatives: m.alternatives })),
    unavailable: unavailable.map((m) => forStaff(m, date)),
    extras: allExtras.map((x) => {
      const f = extraFit.get(x.id);
      return { ...forStaff(x, date), ...(f ? { fit: f.fit, locked: f.locked, why: f.why, alternatives: f.alternatives } : {}) };
    }),
    addons: (await approvedAddons(db)).map((a) => forStaff(a, date)),
  };
}

// Adds RDI values to a day's intake. Called only when an order becomes paid (never at checkout).
export async function addToIntake(userId, adds, date, db = pool) {
  const after = addMeal(await todayIntake(userId, date, db), adds);
  await db.query(
    `INSERT INTO session_intake (user_id, session_date, carb_total, protein_total, fat_total, vitamin_total, mineral_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, session_date) DO UPDATE SET
       carb_total = $3, protein_total = $4, fat_total = $5, vitamin_total = $6, mineral_total = $7`,
    [userId, date, ...FOOD_CLASSES.map((c) => after[c])],
  );
  return after;
}

// Store each High/Critical notification once per class, level and Lagos day.
export async function saveNotifications(userId, notifications, date, db = pool) {
  for (const n of notifications) {
    const { rows } = await db.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND food_class = $2 AND intake_level = $3
       AND (issued_at AT TIME ZONE $4)::date = $5`, [userId, n.foodClass, n.intakeLevel, TIMEZONE, date],
    );
    if (!rows.length) {
      await db.query(
        'INSERT INTO notifications (user_id, food_class, intake_level, message) VALUES ($1,$2,$3,$4)',
        [userId, n.foodClass, n.intakeLevel, n.message],
      );
    }
  }
}
