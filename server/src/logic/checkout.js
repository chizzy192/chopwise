// Cart, checkout, payment and order status rules (CLAUDE.md items 5, 6, 7, 13 and 14). Pure functions only.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const LOW_STOCK = 5; // "Only N left" at or below this
export const MAX_QUANTITY = 2; // plates of one dish per order (CLAUDE.md item 5)
export const RESERVATION_MINUTES = 15;
export const MAX_CODE_ATTEMPTS = 5;

// ---------- Plates left ----------
// Stock counts only for the Lagos date it was set for; at midnight every dish has none until the caterer sets it.
export function platesLeft(dish, today) {
  return dish.stockDate === today ? dish.platesLeft : null;
}

// Why a dish can't be added right now, or null. Sold out covers both the switch and 0 plates.
export function unavailableReason(dish, today) {
  if (dish.soldOutOn === today) return 'Sold out';
  const left = platesLeft(dish, today);
  if (left === null) return 'Not available today';
  if (left <= 0) return 'Sold out';
  return null;
}

export function stockLabel(dish, today) {
  const reason = unavailableReason(dish, today);
  if (reason) return reason;
  const left = platesLeft(dish, today);
  return left <= LOW_STOCK ? `Only ${left} left` : null;
}

// ---------- Prices (whole kobo) ----------
// VAT rate is a percentage with up to 2 decimals (7.5 = 7.5%). Working in basis points keeps
// every step an integer; the result is rounded half up to the kobo.
export function vatKobo(subtotalKobo, ratePercent) {
  const basisPoints = Math.round(ratePercent * 100);
  return Math.floor((subtotalKobo * basisPoints + 5000) / 10000);
}

// Each meal line comes with one bottle of water per plate (CLAUDE.md item 6), charged at the
// admin's water price. Staff can remove it for any meal line (water: false). It has no RDI values
// and is not stock-tracked. Extras and add-ons don't come with water.
export const WATER_NAME = 'Bottled water';
export function waterFor({ type, quantity, water }, waterPriceKobo) {
  if (type !== 'meal') return null;
  const chosen = water !== false;
  return { name: WATER_NAME, chosen, quantity, unitPriceKobo: waterPriceKobo, lineTotalKobo: chosen ? waterPriceKobo * quantity : 0 };
}

/**
 * The checkout breakdown. The subtotal is every line plus the water chosen with meals. VAT applies
 * to the subtotal only, never to the delivery fee. Amounts are whole kobo.
 */
export function priceCart(lines, { vatRate, deliveryFeeKobo, waterPriceKobo = 0 }) {
  const priced = lines.map((l) => ({ ...l, lineTotalKobo: l.unitPriceKobo * l.quantity, water: waterFor(l, waterPriceKobo) }));
  const subtotalKobo = priced.reduce((s, l) => s + l.lineTotalKobo + (l.water?.lineTotalKobo ?? 0), 0);
  const vat = vatKobo(subtotalKobo, vatRate);
  return {
    lines: priced,
    subtotalKobo,
    vatRate,
    vatKobo: vat,
    deliveryFeeKobo,
    totalKobo: subtotalKobo + vat + deliveryFeeKobo,
  };
}

// Admin settings hold the delivery fee in naira with at most 2 decimals.
export const nairaToKobo = (naira) => Math.round(Number(naira) * 100);

// ---------- Cart checks that the decision engine does not make ----------
/** Problems with the cart's dishes, quantities and caterer. Returns plain messages (empty = fine). */
export function cartProblems(lines, dishesById, today) {
  const problems = [];
  const caterers = new Set();
  for (const { dishId, quantity } of lines) {
    const dish = dishesById.get(dishId);
    if (!dish) { problems.push({ dishId, message: 'That dish is no longer on the menu' }); continue; }
    caterers.add(dish.catererId);
    const reason = unavailableReason(dish, today);
    if (reason) { problems.push({ dishId, message: `${dish.name}: ${reason.toLowerCase()}` }); continue; }
    const left = platesLeft(dish, today);
    if (quantity > left) problems.push({ dishId, message: `${dish.name}: only ${left} left` });
  }
  if (caterers.size > 1) problems.push({ dishId: null, message: 'A cart can only hold dishes from one caterer' });
  if (!lines.some(({ dishId }) => dishesById.get(dishId)?.type === 'meal')) {
    problems.push({ dishId: null, message: 'Add at least one meal to your cart' });
  }
  return problems;
}

// ---------- Payment ----------
/**
 * Whether a Paystack transaction pays this order. All four must hold: success, the exact total in
 * kobo, NGN, and the order's own reference. Returns { ok } or { ok: false, reason }.
 */
export function checkPayment(order, tx) {
  if (!tx || tx.reference !== order.reference) return { ok: false, reason: 'reference does not match this order' };
  if (tx.status !== 'success') return { ok: false, reason: `payment ${tx.status || 'not completed'}` };
  if (tx.currency !== 'NGN') return { ok: false, reason: `wrong currency (${tx.currency})` };
  if (Number(tx.amount) !== order.totalKobo) return { ok: false, reason: `wrong amount (${tx.amount} kobo, expected ${order.totalKobo})` };
  return { ok: true };
}

// Paystack signs each webhook with HMAC SHA512 of the raw body, keyed with the secret key.
export function webhookSignatureValid(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

// ---------- Order status ----------
export const STATUSES = ['pending_payment', 'paid', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
export const PAID_STATUSES = ['paid', 'preparing', 'out_for_delivery', 'delivered'];

// The caterer moves an order one step at a time. Delivered needs the code (see deliver).
const NEXT = { paid: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered' };
export const nextStatus = (status) => NEXT[status] ?? null;

export function canAdvance(from, to) {
  return NEXT[from] === to && to !== 'delivered';
}

// After 5 wrong codes the order's code locks; only an admin can sort it out.
export function afterWrongCode(attempts) {
  const next = attempts + 1;
  return { attempts: next, locked: next >= MAX_CODE_ATTEMPTS, left: Math.max(0, MAX_CODE_ATTEMPTS - next) };
}
