// Database side of health onboarding and the daily check-in. The rules live in logic/checkin.js.
import { pool } from '../db/pool.js';
import { PAID_STATUSES } from '../logic/checkout.js';
import { healthParameter, prefill } from '../logic/checkin.js';
import { rowToMeal } from './diet.js';

export function rowToProfile(r) {
  if (!r || r.answered_at === null) return null;
  return {
    hasCondition: r.has_condition,
    conditions: r.conditions,
    otherCondition: r.other_condition,
    answeredAt: r.answered_at,
    updatedAt: r.updated_at,
  };
}

// The answered health profile, or null if the staff member has not done onboarding yet.
export async function healthProfile(userId, db = pool) {
  const { rows } = await db.query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);
  return rowToProfile(rows[0]);
}

export async function currentH(userId, db = pool) {
  const profile = await healthProfile(userId, db);
  return profile ? healthParameter(profile) : 0;
}

export async function todayCheckin(userId, date, db = pool, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM daily_checkins WHERE user_id = $1 AND checkin_date = $2${lock ? ' FOR UPDATE' : ''}`, [userId, date],
  );
  return rows[0] ?? null;
}

// Orders started today that still count: the check-in locks at the first checkout, because that
// order was evaluated with today's G. A cancelled (failed or expired) payment doesn't count.
export async function ordersOn(userId, date, db = pool) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1 AND order_date = $2 AND status <> 'cancelled'",
    [userId, date],
  );
  return rows[0].n;
}

// Meals from the two most recent paid order lines, most recent first. Add-ons are never "a meal".
export async function prefillFromHistory(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT i.meal_id FROM order_items i JOIN orders o USING (order_id)
     WHERE o.user_id = $1 AND i.dish_type = 'meal' AND o.status = ANY($2::order_status[])
     ORDER BY o.paid_at DESC, i.item_id DESC LIMIT 2`, [userId, PAID_STATUSES],
  );
  return prefill(rows.map((r) => r.meal_id));
}

export async function mealsById(ids, db = pool) {
  const wanted = ids.filter((id) => id != null);
  if (!wanted.length) return new Map();
  // Meals only: an add-on is never one of "your last two meals".
  const { rows } = await db.query("SELECT * FROM meals WHERE meal_id = ANY($1::int[]) AND dish_type = 'meal'", [wanted]);
  return new Map(rows.map((r) => [r.meal_id, rowToMeal(r)]));
}
