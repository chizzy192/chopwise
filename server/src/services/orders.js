// Cart evaluation, checkout, stock reservation and payment (CLAUDE.md items 5, 6, 7, 13 and 14).
// The rules are in logic/checkout.js and logic/engine.js; this file does the database work.
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { FOOD_CLASSES } from '../logic/constants.js';
import { evaluateCart, scaleMeal, emptyIntake, addMeal, alternativesFor } from '../logic/engine.js';
import { CLASS_LABELS } from '../logic/constants.js';
import {
  cartProblems, priceCart, nairaToKobo, platesLeft, stockLabel, checkPayment, MAX_QUANTITY, RESERVATION_MINUTES,
} from '../logic/checkout.js';
import { rowToMeal, todayIntake, addToIntake, catalogueFor, saveNotifications } from './diet.js';
import { hasRdi } from '../logic/dish.js';
import { todayCheckin } from './checkin.js';
import { newDeliveryCode, hashCode, encryptCode } from './deliveryCode.js';
import { audit } from './audit.js';

export async function inTransaction(fn) {
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

export class StockError extends Error {
  constructor(dishName) {
    super(`${dishName} doesn't have enough plates left. Lower the quantity or remove it.`);
    this.status = 409;
  }
}

// ---------- Stock reservations ----------
/**
 * Cancels a pending order and puts its plates back. Only the call that moves the order from
 * pending_payment to cancelled releases stock, so it can never be released twice. Plates go back
 * only while it is still the same stock day: after midnight the caterer sets new numbers.
 */
export async function cancelOrder(db, orderId, reason) {
  const { rows } = await db.query(
    `UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, status_updated_at = NOW()
     WHERE order_id = $1 AND status = 'pending_payment' RETURNING order_date`, [orderId, reason],
  );
  if (!rows.length) return false;
  await db.query(
    `UPDATE meals m SET plates_left = m.plates_left + i.quantity
     FROM order_items i WHERE i.order_id = $1 AND m.meal_id = i.meal_id AND m.stock_date = $2`,
    [orderId, rows[0].order_date],
  );
  return true;
}

// Cancels every reservation older than 15 minutes. Runs on a timer and before each stock read.
export async function expireReservations() {
  const { rows } = await pool.query(
    "SELECT order_id FROM orders WHERE status = 'pending_payment' AND reserved_until < NOW()",
  );
  for (const { order_id: id } of rows) {
    await inTransaction((db) => cancelOrder(db, id, `Payment not completed within ${RESERVATION_MINUTES} minutes`));
  }
  return rows.length;
}

/**
 * Reserves every line or none. Each UPDATE only succeeds while enough plates are left, so two
 * checkouts can never both take the last plate; the first failure rolls the transaction back.
 * Lines are locked in dish id order so concurrent checkouts can't deadlock.
 */
export async function reserveStock(db, lines, date) {
  for (const line of [...lines].sort((a, b) => a.dishId - b.dishId)) {
    const { rows } = await db.query(
      `UPDATE meals SET plates_left = plates_left - $1
       WHERE meal_id = $2 AND stock_date = $3 AND plates_left >= $1 AND sold_out_on IS DISTINCT FROM $3
       RETURNING meal_id`,
      [line.quantity, line.dishId, date],
    );
    if (!rows.length) throw new StockError(line.name);
  }
}

// ---------- Cart ----------
async function approvedDishes(ids, db) {
  const { rows } = await db.query('SELECT * FROM meals WHERE meal_id = ANY($1::int[]) AND is_approved', [ids]);
  return new Map(rows.map((r) => [r.meal_id, rowToMeal(r)]));
}

async function checkoutSettings(db) {
  const { rows } = await db.query('SELECT vat_rate, delivery_fee, water_price FROM settings WHERE setting_id = 1');
  return { vatRate: rows[0].vat_rate, deliveryFeeKobo: nairaToKobo(rows[0].delivery_fee), waterPriceKobo: nairaToKobo(rows[0].water_price) };
}

/**
 * The server's view of a cart: Fit per line (from today's stored G), cart-level warnings on
 * projected intake, plates-left limits, the price breakdown and whether checkout is allowed.
 * Used by POST /cart/evaluate and again, from scratch, by checkout.
 */
export async function evaluateCartFor(userId, checkin, lines, date, db = pool) {
  const dishes = await approvedDishes(lines.map((l) => l.dishId), db);
  const problems = cartProblems(lines, dishes, date);
  const known = lines.filter((l) => dishes.has(l.dishId));
  // Meals and extras (yoghurt) count toward intake. Add-ons (water) never reach the engine:
  // they carry no Fit and never affect intake.
  const mealLines = known.filter((l) => hasRdi(dishes.get(l.dishId).type));
  const intake = await todayIntake(userId, date, db);
  const engine = evaluateCart({
    gate: checkin.g, intake, meals: mealLines.map((l) => dishes.get(l.dishId)),
    lines: mealLines.map((l) => ({ mealId: l.dishId, quantity: l.quantity })),
  });
  if (engine.blocked.length) {
    // Name the line, say how far its class would go, and suggest a quantity that fits or what to try instead.
    const menu = await catalogueFor(userId, checkin, date, db);
    for (const line of engine.lines.filter((l) => l.locked)) {
      const dish = dishes.get(line.mealId);
      const cls = CLASS_LABELS[line.dominantClass].toLowerCase();
      let message = `${dish.name} is restricted today: with this order ${cls} would reach ${line.projectedDominant}% of your daily limit, above the 90% cut-off.`;
      if (line.fitsQuantity > 0) {
        message += ` Lower it to ${line.fitsQuantity} to fit.`;
      } else {
        const alts = alternativesFor(dish, menu.catalogue, intake);
        message += alts.length
          ? ` Remove it, or try ${alts.map((a) => `${a.name} (${a.text.toLowerCase()})`).join(' or ')}.`
          : ' Remove it to continue.';
      }
      problems.push({ dishId: line.mealId, message, fitsQuantity: line.fitsQuantity ?? 0 });
    }
  }
  const fitById = new Map(engine.lines.map((l) => [l.mealId, l]));
  const pricing = priceCart(known.map((l) => {
    const d = dishes.get(l.dishId);
    return { dishId: d.id, name: d.name, type: d.type, quantity: l.quantity, unitPriceKobo: d.priceKobo, water: l.water };
  }), await checkoutSettings(db));
  return {
    lines: pricing.lines.map((l) => {
      const d = dishes.get(l.dishId);
      const fit = fitById.get(l.dishId);
      const left = platesLeft(d, date);
      return {
        ...l, catererId: d.catererId, photoUrl: d.photoUrl, platesLeft: left, stockLabel: stockLabel(d, date),
        maxQuantity: Math.min(left ?? 0, MAX_QUANTITY),
        fit: fit?.fit ?? null, locked: fit?.locked ?? false, why: fit?.why ?? [],
      };
    }),
    problems,
    warnings: engine.warnings,
    projected: engine.projected,
    projectedBands: engine.projectedBands,
    breakdown: { subtotalKobo: pricing.subtotalKobo, vatRate: pricing.vatRate, vatKobo: pricing.vatKobo, deliveryFeeKobo: pricing.deliveryFeeKobo, totalKobo: pricing.totalKobo },
    canCheckout: problems.length === 0 && engine.canCheckout,
    dishes,
  };
}

// ---------- Checkout ----------
/**
 * Re-evaluates the cart from scratch, reserves the plates and creates the pending order with a
 * snapshot of every item, all in one transaction. Returns { order } or { problems }.
 */
export async function createPendingOrder(user, lines, date) {
  await expireReservations();
  return inTransaction(async (db) => {
    // Lock today's check-in so a check-in redo can't change G while this order is created.
    const checkin = await todayCheckin(user.id, date, db, { lock: true });
    const cart = await evaluateCartFor(user.id, checkin, lines, date, db);
    if (!cart.canCheckout) return { problems: cart.problems.length ? cart.problems : [{ dishId: null, message: 'This cart cannot be checked out' }] };
    await reserveStock(db, cart.lines, date);
    const b = cart.breakdown;
    const reference = `CW-${randomUUID()}`;
    const { rows } = await db.query(
      `INSERT INTO orders (user_id, caterer_id, order_date, subtotal_kobo, vat_rate, vat_kobo, delivery_fee_kobo, total_kobo,
         paystack_reference, reserved_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW() + make_interval(mins => $10)) RETURNING *`,
      [user.id, cart.lines[0].catererId, date, b.subtotalKobo, b.vatRate, b.vatKobo, b.deliveryFeeKobo, b.totalKobo, reference, RESERVATION_MINUTES],
    );
    for (const l of cart.lines) {
      const d = cart.dishes.get(l.dishId);
      await db.query(
        `INSERT INTO order_items (order_id, meal_id, dish_type, name, unit_price_kobo, quantity, line_total_kobo,
           carb_percent, protein_percent, fat_percent, vitamin_percent, mineral_percent, water_quantity, water_unit_price_kobo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [rows[0].order_id, d.id, d.type, d.name, l.unitPriceKobo, l.quantity, l.lineTotalKobo, ...FOOD_CLASSES.map((c) => d[c]),
          l.water?.chosen ? l.water.quantity : 0, l.water?.chosen ? l.water.unitPriceKobo : 0],
      );
    }
    return { order: rows[0], cart };
  });
}

// ---------- Payment ----------
const toCheckable = (row) => ({ reference: row.paystack_reference, totalKobo: row.total_kobo });

async function orderItems(db, orderId) {
  const { rows } = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY item_id', [orderId]);
  return rows;
}

// Marks the order paid, issues its delivery code and adds the meals and extras to that day's intake.
async function markPaid(db, row) {
  const code = newDeliveryCode();
  await db.query(
    `UPDATE orders SET status = 'paid', paid_at = NOW(), code_hash = $2, code_encrypted = $3, status_updated_at = NOW()
     WHERE order_id = $1`, [row.order_id, hashCode(code, row.order_id), encryptCode(code)],
  );
  // Intake changes only now, from the RDI values snapshotted at checkout.
  let adds = emptyIntake();
  for (const item of await orderItems(db, row.order_id)) {
    if (!hasRdi(item.dish_type)) continue;
    adds = addMeal(adds, scaleMeal(Object.fromEntries(FOOD_CLASSES.map((c) => [c, item[`${c}_percent`]])), item.quantity));
  }
  await addToIntake(row.user_id, adds, row.order_date, db);
  const checkin = await todayCheckin(row.user_id, row.order_date, db);
  if (checkin) {
    const after = await catalogueFor(row.user_id, checkin, row.order_date, db);
    await saveNotifications(row.user_id, after.notifications, row.order_date, db);
  }
}

/**
 * Applies a Paystack transaction (from verify or the webhook) to the order with that reference.
 * Idempotent: the order row is locked and only a pending order can become paid, so verify and
 * webhook arriving together pay it exactly once. Returns the order's resulting status.
 */
export async function applyPayment(reference, tx, source) {
  return inTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM orders WHERE paystack_reference = $1 FOR UPDATE', [reference]);
    const row = rows[0];
    if (!row) return { status: null };
    const check = checkPayment(toCheckable(row), tx);
    if (row.status !== 'pending_payment' && row.status !== 'cancelled') return { status: row.status, alreadyPaid: true };

    if (row.status === 'cancelled') {
      if (!check.ok) return { status: 'cancelled' };
      // Paid after the reservation expired: take the plates again if they are still there.
      try {
        await db.query('SAVEPOINT rereserve');
        const items = await orderItems(db, row.order_id);
        await reserveStock(db, items.map((i) => ({ dishId: i.meal_id, quantity: i.quantity, name: i.name })), row.order_date);
        await db.query("UPDATE orders SET status = 'pending_payment', cancelled_at = NULL, cancel_reason = NULL WHERE order_id = $1", [row.order_id]);
        await markPaid(db, row);
        return { status: 'paid' };
      } catch (err) {
        if (!(err instanceof StockError)) throw err;
        await db.query('ROLLBACK TO SAVEPOINT rereserve');
        await db.query("UPDATE orders SET cancel_reason = 'Paid after the reservation expired and the plates had gone. Refund needed.' WHERE order_id = $1", [row.order_id]);
        await audit({ actorId: null, action: 'payment.needs_refund', targetType: 'order', targetId: row.order_id, details: { reference, totalKobo: row.total_kobo, source } }, db);
        return { status: 'cancelled', refundNeeded: true };
      }
    }

    if (check.ok) {
      await markPaid(db, row);
      return { status: 'paid' };
    }
    // Anything else (failed, abandoned, wrong amount or currency): record why and release the plates.
    await cancelOrder(db, row.order_id, `Payment ${source}: ${check.reason}`);
    if (/wrong (amount|currency)|reference/.test(check.reason)) {
      await audit({ actorId: null, action: 'payment.mismatch', targetType: 'order', targetId: row.order_id, details: { reference, reason: check.reason, source } }, db);
    }
    return { status: 'cancelled', reason: check.reason };
  });
}
