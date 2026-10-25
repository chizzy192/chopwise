// Cart, checkout, payment and delivery rules (no database, no Paystack). Reservations,
// concurrency, idempotent payment and price snapshots run end to end in scripts/system-scenarios.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import {
  vatKobo, priceCart, nairaToKobo, platesLeft, unavailableReason, stockLabel, cartProblems, checkPayment,
  webhookSignatureValid, nextStatus, canAdvance, afterWrongCode, MAX_CODE_ATTEMPTS, waterFor, WATER_NAME,
} from '../src/logic/checkout.js';
import { todayInLagos } from '../src/logic/time.js';
import { newDeliveryCode, hashCode, codeMatches, encryptCode, decryptCode } from '../src/services/deliveryCode.js';

// ---------- Prices in kobo ----------
test('VAT is worked out in whole kobo, rounded half up', () => {
  assert.equal(vatKobo(100_000, 7.5), 7_500); // ₦1,000 × 7.5% = ₦75.00
  assert.equal(vatKobo(10, 7.5), 1); // 0.75 kobo → 1
  assert.equal(vatKobo(20, 7.5), 2); // 1.5 kobo → 2 (half up)
  assert.equal(vatKobo(6, 7.5), 0); // 0.45 kobo → 0
  assert.equal(vatKobo(333_333, 7.5), 25_000); // 24,999.975 → 25,000
  assert.equal(vatKobo(123_457, 0), 0);
  assert.equal(vatKobo(100_000, 12.34), 12_340);
});

test('checkout breakdown: subtotal of meals and add-ons, VAT on the subtotal only, then the delivery fee', () => {
  const b = priceCart([
    { dishId: 1, unitPriceKobo: 250_000, quantity: 2 }, // Jollof rice and chicken, ₦2,500 × 2
    { dishId: 2, unitPriceKobo: 30_000, quantity: 1 }, // Bottled water, ₦300
  ], { vatRate: 7.5, deliveryFeeKobo: nairaToKobo(500) });
  assert.deepEqual(b.lines.map((l) => l.lineTotalKobo), [500_000, 30_000]);
  assert.equal(b.subtotalKobo, 530_000); // ₦5,300.00
  assert.equal(b.vatKobo, 39_750); // ₦397.50, not charged on the ₦500 fee
  assert.equal(b.deliveryFeeKobo, 50_000);
  assert.equal(b.totalKobo, 619_750); // ₦6,197.50
  assert.ok(Number.isInteger(b.totalKobo));
});

test('a naira delivery fee converts to whole kobo without floating-point drift', () => {
  assert.equal(nairaToKobo(0.1 + 0.2), 30);
  assert.equal(nairaToKobo('1234.56'), 123_456);
});

// ---------- Plates left ----------
const today = '2026-10-24';
const dish = (over = {}) => ({ id: 1, name: 'Jollof rice', type: 'meal', catererId: 7, soldOutOn: null, stockDate: today, platesLeft: 10, ...over });

test('a dish with no stock set for today is not available', () => {
  assert.equal(unavailableReason(dish({ stockDate: null, platesLeft: null }), today), 'Not available today');
  assert.equal(platesLeft(dish({ stockDate: null }), today), null);
});

test('stock resets at the Lagos midnight', () => {
  const setAt = todayInLagos(new Date('2026-10-24T22:30:00Z')); // 23:30 in Lagos
  const d = dish({ stockDate: setAt, platesLeft: 8 });
  assert.equal(platesLeft(d, todayInLagos(new Date('2026-10-24T22:59:59Z'))), 8);
  assert.equal(platesLeft(d, todayInLagos(new Date('2026-10-24T23:00:00Z'))), null, '00:00 in Lagos: no stock until the caterer sets it');
});

test('"Only N left" at 5 or fewer; 0 plates or the switch shows Sold out', () => {
  assert.equal(stockLabel(dish({ platesLeft: 6 }), today), null);
  assert.equal(stockLabel(dish({ platesLeft: 5 }), today), 'Only 5 left');
  assert.equal(stockLabel(dish({ platesLeft: 0 }), today), 'Sold out');
  assert.equal(stockLabel(dish({ soldOutOn: today }), today), 'Sold out');
});

test('a quantity above plates left is refused', () => {
  const dishes = new Map([[1, dish({ platesLeft: 3 })]]);
  assert.deepEqual(cartProblems([{ dishId: 1, quantity: 4 }], dishes, today), [{ dishId: 1, message: 'Jollof rice: only 3 left' }]);
  assert.deepEqual(cartProblems([{ dishId: 1, quantity: 3 }], dishes, today), []);
});

test('a cart holds one caterer, needs a meal, and refuses dishes no longer on the menu', () => {
  const water = dish({ id: 2, name: 'Bottled water', type: 'addon' });
  const other = dish({ id: 3, name: 'Suya', catererId: 8 });
  const dishes = new Map([[1, dish()], [2, water], [3, other]]);
  assert.match(cartProblems([{ dishId: 1, quantity: 1 }, { dishId: 3, quantity: 1 }], dishes, today).at(-1).message, /one caterer/);
  assert.match(cartProblems([{ dishId: 2, quantity: 1 }], dishes, today)[0].message, /at least one meal/);
  assert.match(cartProblems([{ dishId: 9, quantity: 1 }, { dishId: 1, quantity: 1 }], dishes, today)[0].message, /no longer on the menu/);
});

// ---------- Payment ----------
const order = { reference: 'CW-11111111-2222-3333-4444-555555555555', totalKobo: 619_750 };
const tx = (over = {}) => ({ status: 'success', reference: order.reference, amount: 619_750, currency: 'NGN', ...over });

test('a payment counts only with success, the exact amount, NGN and this order\'s reference', () => {
  assert.deepEqual(checkPayment(order, tx()), { ok: true });
});

test('verify rejects a wrong amount', () => {
  assert.match(checkPayment(order, tx({ amount: 619_749 })).reason, /wrong amount/);
  assert.match(checkPayment(order, tx({ amount: 6_197_500 })).reason, /wrong amount/, 'naira sent as kobo');
});

test('verify rejects a wrong currency', () => {
  assert.match(checkPayment(order, tx({ currency: 'USD' })).reason, /wrong currency/);
});

test("verify rejects someone else's reference", () => {
  assert.match(checkPayment(order, tx({ reference: 'CW-99999999-2222-3333-4444-555555555555' })).reason, /reference/);
  assert.equal(checkPayment(order, null).ok, false);
});

test('verify rejects a failed or abandoned payment', () => {
  assert.match(checkPayment(order, tx({ status: 'failed' })).reason, /payment failed/);
  assert.match(checkPayment(order, tx({ status: 'abandoned' })).reason, /payment abandoned/);
});

test('webhook signature: HMAC SHA512 of the raw body with the secret key', () => {
  const secret = 'sk_test_example';
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: order.reference } }));
  const good = createHmac('sha512', secret).update(raw).digest('hex');
  assert.equal(webhookSignatureValid(raw, good, secret), true);
  assert.equal(webhookSignatureValid(raw, createHmac('sha512', 'sk_test_other').update(raw).digest('hex'), secret), false, 'wrong key');
  assert.equal(webhookSignatureValid(Buffer.from(`${raw} `), good, secret), false, 'body changed by one byte');
  assert.equal(webhookSignatureValid(raw, undefined, secret), false, 'no signature');
  assert.equal(webhookSignatureValid(raw, 'abc', secret), false, 'malformed');
});

// ---------- Delivery code and status ----------
const key = randomBytes(32);

test('delivery codes are 4 digits, checked by hash, readable only with the key', () => {
  for (let i = 0; i < 50; i += 1) assert.match(newDeliveryCode(), /^\d{4}$/);
  const hash = hashCode('0427', 12, key);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, hashCode('0427', 13, key), 'the same code hashes differently on another order');
  assert.equal(codeMatches('0427', 12, hash, key), true);
  assert.equal(codeMatches('0428', 12, hash, key), false);
  assert.equal(codeMatches('427', 12, hash, key), false);
  const stored = encryptCode('0427', key);
  assert.ok(!stored.includes('0427'));
  assert.equal(decryptCode(stored, key), '0427');
  assert.throws(() => decryptCode(stored, randomBytes(32)), 'another key cannot read it');
});

test('a delivery code locks after 5 wrong attempts', () => {
  let attempts = 0;
  for (let i = 1; i < MAX_CODE_ATTEMPTS; i += 1) {
    const r = afterWrongCode(attempts);
    assert.equal(r.locked, false);
    assert.equal(r.left, MAX_CODE_ATTEMPTS - i);
    attempts = r.attempts;
  }
  assert.deepEqual(afterWrongCode(attempts), { attempts: 5, locked: true, left: 0 });
});

test('orders move one step at a time; delivered only by code; cancelled and delivered are final', () => {
  assert.equal(nextStatus('paid'), 'preparing');
  assert.equal(nextStatus('preparing'), 'out_for_delivery');
  assert.equal(nextStatus('out_for_delivery'), 'delivered');
  assert.equal(canAdvance('paid', 'preparing'), true);
  assert.equal(canAdvance('paid', 'out_for_delivery'), false, 'no skipping');
  assert.equal(canAdvance('out_for_delivery', 'delivered'), false, 'delivered needs the code');
  assert.equal(canAdvance('pending_payment', 'preparing'), false, 'unpaid orders never move');
  assert.equal(nextStatus('delivered'), null);
  assert.equal(nextStatus('cancelled'), null);
});

test('at most 2 plates of one dish per order (enforced by the server)', async () => {
  const { cartBody } = await import('../src/http/schemas.js');
  assert.equal(cartBody.safeParse({ lines: [{ dishId: 1, quantity: 2 }] }).success, true);
  const three = cartBody.safeParse({ lines: [{ dishId: 1, quantity: 3 }] });
  assert.equal(three.success, false);
  assert.equal(three.error.issues[0].message, 'You can order at most 2 plates of one dish per order');
});

test('each meal line comes with bottled water at the admin\'s price, one per plate, and it can be removed', () => {
  const settings = { vatRate: 7.5, deliveryFeeKobo: 0, waterPriceKobo: 30_000 }; // water ₦300
  const b = priceCart([
    { dishId: 1, type: 'meal', unitPriceKobo: 250_000, quantity: 2 },
    { dishId: 2, type: 'extra', unitPriceKobo: 100_000, quantity: 1 }, // Yoghurt
    { dishId: 3, type: 'addon', unitPriceKobo: 30_000, quantity: 1 }, // Extra bottled water
  ], settings);
  assert.deepEqual(b.lines[0].water, { name: WATER_NAME, chosen: true, quantity: 2, unitPriceKobo: 30_000, lineTotalKobo: 60_000 });
  assert.equal(b.lines[1].water, null, 'extras come without water');
  assert.equal(b.lines[2].water, null, 'add-ons come without water');
  assert.equal(b.subtotalKobo, 500_000 + 60_000 + 100_000 + 30_000, 'the water is in the subtotal');
  assert.equal(b.vatKobo, vatKobo(690_000, 7.5), 'and VAT applies to it');

  const without = priceCart([{ dishId: 1, type: 'meal', unitPriceKobo: 250_000, quantity: 2, water: false }], settings);
  assert.deepEqual(without.lines[0].water, { name: WATER_NAME, chosen: false, quantity: 2, unitPriceKobo: 30_000, lineTotalKobo: 0 });
  assert.equal(without.subtotalKobo, 500_000, 'removed water costs nothing');
  assert.equal(waterFor({ type: 'addon', quantity: 1 }, 30_000), null);
});

test('the cart request can turn water off per line; anything but true/false is refused', async () => {
  const { cartBody } = await import('../src/http/schemas.js');
  assert.equal(cartBody.parse({ lines: [{ dishId: 1, quantity: 1, water: false }] }).lines[0].water, false);
  assert.equal(cartBody.parse({ lines: [{ dishId: 1, quantity: 1 }] }).lines[0].water, undefined, 'left out means water stays');
  assert.equal(cartBody.safeParse({ lines: [{ dishId: 1, quantity: 1, water: 'no' }] }).success, false);
});

test('a cart of only an extra still needs a meal', () => {
  const today = todayInLagos();
  const yoghurt = { id: 5, name: 'Yoghurt (1 cup)', type: 'extra', catererId: 1, soldOutOn: null, stockDate: today, platesLeft: 10 };
  const problems = cartProblems([{ dishId: 5, quantity: 1 }], new Map([[5, yoghurt]]), today);
  assert.deepEqual(problems.map((p) => p.message), ['Add at least one meal to your cart']);
});
