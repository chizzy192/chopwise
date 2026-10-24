import { test } from 'node:test';
import assert from 'node:assert/strict';
import { majorityGate } from '../src/logic/gate.js';
import { classifyMeal, validateMealPercents } from '../src/logic/meal.js';
import {
  band, mealOutcome, previousMealOutcomes, evaluate, emptyIntake,
  fitFor, scaleMeal, remainingAllowance, evaluateCart,
} from '../src/logic/engine.js';

test('majority gate matches Table 2.1 for all 8 rows', () => {
  const table = [
    [0, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 1, 1, 1],
    [1, 0, 0, 0], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 1],
  ];
  for (const [h, p1, p2, g] of table) assert.equal(majorityGate(h, p1, p2).g, g, `${h}${p1}${p2}`);
});

test('gate rejects non-binary input', () => {
  assert.throws(() => majorityGate(2, 0, 0));
});

test('bands follow Table 3.1 boundaries', () => {
  assert.equal(band(0), 'Low');
  assert.equal(band(40), 'Low');
  assert.equal(band(40.5), 'Moderate');
  assert.equal(band(70), 'Moderate');
  assert.equal(band(70.01), 'High');
  assert.equal(band(90), 'High');
  assert.equal(band(90.5), 'Critical');
});

test('meal classification: jollof rice example from Chapter 3.3', () => {
  const jollof = { carb: 48, protein: 22, fat: 18, vitamin: 7, mineral: 5 };
  assert.deepEqual(classifyMeal(jollof), { dominantClass: 'carb', isBalanced: false });
  const balanced = { carb: 30, protein: 25, fat: 15, vitamin: 10, mineral: 8 };
  assert.equal(classifyMeal(balanced).isBalanced, true);
});

test('meal validation rejects missing and out-of-range values', () => {
  assert.equal(validateMealPercents({ carb: 10, protein: 10, fat: 10, vitamin: 10, mineral: 10 }).length, 0);
  assert.equal(validateMealPercents({ carb: 120, protein: -1, fat: 10, vitamin: 10 }).length, 3);
});

test('meal outcome is 1 only above 70%', () => {
  assert.equal(mealOutcome({ carb: 70, protein: 0, fat: 0, vitamin: 0, mineral: 0 }), 0);
  assert.equal(mealOutcome({ carb: 71, protein: 0, fat: 0, vitamin: 0, mineral: 0 }), 1);
});

test('two heavy carb meals: second one tips P1 to 1', () => {
  const heavy = { carb: 48, protein: 22, fat: 18, vitamin: 7, mineral: 5 };
  assert.deepEqual(previousMealOutcomes(heavy, heavy), { p1: 1, p2: 0 });
});

// Values are % of daily RDI per serving, as in the demo data.
const jollof = { id: 1, name: 'Jollof rice', carb: 48, protein: 22, fat: 18, vitamin: 7, mineral: 5, dominantClass: 'carb', isBalanced: false };
const bowl = { id: 2, name: 'Balanced bowl', carb: 30, protein: 28, fat: 14, vitamin: 22, mineral: 15, dominantClass: 'carb', isBalanced: true };
const fish = { id: 3, name: 'Grilled fish', carb: 10, protein: 40, fat: 12, vitamin: 25, mineral: 18, dominantClass: 'protein', isBalanced: false };
const salad = { id: 4, name: 'Vegetable salad', carb: 8, protein: 15, fat: 10, vitamin: 32, mineral: 20, dominantClass: 'vitamin', isBalanced: false };
const meals = [jollof, bowl, fish];
const at = (values) => ({ ...emptyIntake(), ...values });
const fitOf = (r, id) => r.catalogue.find((m) => m.id === id);

test('gate 0 (soft): critical meals stay orderable with a strong warning', () => {
  const r = evaluate({ gate: 0, intake: at({ carb: 95 }), meals });
  assert.equal(r.guidance, 'soft');
  assert.equal(r.catalogue.length, 3);
  assert.deepEqual(r.locked, []);
  assert.deepEqual(r.restrictedClasses, []);
  assert.equal(fitOf(r, 1).fit, 'Caution');
  assert.equal(fitOf(r, 1).locked, false);
  assert.match(fitOf(r, 1).why[0], /strongly suggest/);
  assert.equal(r.notifications.length, 1);
  assert.match(r.notifications[0].message, /Try to avoid meals that are mostly carbohydrates/);
});

test('gate 0 (soft): High classes still warn', () => {
  const r = evaluate({ gate: 0, intake: at({ fat: 75 }), meals });
  assert.deepEqual(r.notifications.map((n) => n.intakeLevel), ['High']);
  assert.match(r.notifications[0].message, /You have 15% left/);
});

test('gate 1 (full) critical carb: non-balanced carb meals stay visible but locked, balanced first', () => {
  const r = evaluate({ gate: 1, intake: at({ carb: 95, fat: 75 }), meals });
  assert.equal(r.guidance, 'full');
  assert.equal(r.catalogue.length, 3, 'locked meals are not hidden');
  assert.deepEqual(r.locked, [1]);
  assert.equal(r.catalogue[0].id, 2);
  assert.equal(r.catalogue.at(-1).id, 1, 'restricted meals are listed last');
  assert.equal(fitOf(r, 1).fit, 'Restricted today');
  assert.deepEqual(r.notifications.map((n) => n.intakeLevel).sort(), ['Critical', 'High']);
  assert.match(r.notifications.find((n) => n.intakeLevel === 'Critical').message, /locked for today/);
});

test('locked meals suggest alternatives: lowest in the Critical class first', () => {
  const eggs = { id: 5, name: 'Boiled eggs', carb: 0, protein: 30, fat: 20, vitamin: 10, mineral: 8, dominantClass: 'protein', isBalanced: false };
  const r = evaluate({ gate: 1, intake: at({ carb: 95 }), meals: [jollof, bowl, fish, salad, eggs] });
  // Balanced meals and unlocked meals whose class isn't Critical, by carbohydrates added: 0, 8, 10 (bowl adds 30).
  assert.deepEqual(fitOf(r, 1).alternatives.map((a) => a.name), ['Boiled eggs', 'Vegetable salad', 'Grilled fish']);
  assert.deepEqual(fitOf(r, 1).alternatives.map((a) => a.text), ['Adds 0% carbohydrates', 'Adds 8% carbohydrates', 'Adds 10% carbohydrates']);
  assert.deepEqual(fitOf(r, 2).alternatives, [], 'unlocked meals carry no alternatives');
});

test('alternatives never include another meal whose dominant class is Critical', () => {
  const proteinHeavy = { id: 7, name: 'Suya', carb: 6, protein: 45, fat: 30, vitamin: 5, mineral: 6, dominantClass: 'protein', isBalanced: false };
  const r = evaluate({ gate: 1, intake: at({ carb: 95, protein: 95 }), meals: [jollof, proteinHeavy, bowl] });
  assert.ok(fitOf(r, 7).locked, 'Suya is locked: protein is Critical');
  assert.deepEqual(fitOf(r, 1).alternatives.map((a) => a.name), ['Balanced bowl']);
});

test('balanced meals are never restricted, even at Critical under gate 1', () => {
  const r = evaluate({ gate: 1, intake: at({ carb: 95 }), meals: [bowl] });
  assert.equal(fitOf(r, 2).fit, 'Balanced');
  assert.equal(fitOf(r, 2).locked, false);
  assert.ok(fitOf(r, 2).why.some((w) => w.includes('the cut-off is 90%')), 'the reason still warns');
});

test('recommended applies from the start of the day', () => {
  const r = evaluate({ gate: 0, intake: emptyIntake(), meals });
  assert.equal(fitOf(r, 1).fit, 'Recommended');
  assert.equal(fitOf(r, 3).fit, 'Recommended');
});

test('under-consumed classes are recommended; a Moderate dominant class is not', () => {
  const r = evaluate({ gate: 1, intake: at({ carb: 60 }), meals });
  assert.equal(fitOf(r, 3).fit, 'Recommended');
  assert.notEqual(fitOf(r, 1).fit, 'Recommended');
});

test('recommended beats caution when a class only crosses 70%', () => {
  const f = fitFor({ gate: 1, intake: at({ carb: 65 }), meal: salad });
  assert.equal(f.fit, 'Recommended');
  assert.ok(f.why.some((w) => w.includes('this takes you to 73%, above 70%')));
});

test('a dish that pushes any class past 90% is Caution, even if it fills a Low class', () => {
  const heavySide = { ...salad, carb: 30 };
  assert.equal(fitFor({ gate: 1, intake: at({ carb: 65 }), meal: heavySide }).fit, 'Caution');
});

test('High: recommend only within the remaining allowance (90 − current)', () => {
  const intake = at({ carb: 80 });
  assert.equal(remainingAllowance(intake, 'carb'), 10);
  assert.equal(fitFor({ gate: 1, intake, meal: { ...fish, carb: 8 } }).fit, 'Recommended');
  assert.equal(fitFor({ gate: 1, intake, meal: { ...fish, carb: 12 } }).fit, 'Caution');
});

test('why cites the RDI numbers in plain language', () => {
  const soft = fitFor({ gate: 0, intake: at({ carb: 75 }), meal: jollof });
  assert.equal(soft.fit, 'Caution');
  assert.ok(soft.why.includes("Adds 48% carbohydrates. You're at 75% today; the cut-off is 90%."));
  const full = fitFor({ gate: 1, intake: at({ carb: 75 }), meal: jollof });
  assert.equal(full.fit, 'Restricted today');
  assert.match(full.why[0], /You're at 75% today and it would take you to 123%, above the 90% cut-off, so it's locked under firm guidance/);
});

test('a dish that matches no state shows no signal', () => {
  const carbSnack = { ...jollof, carb: 8, protein: 2, fat: 2, vitamin: 1, mineral: 1 };
  assert.equal(fitFor({ gate: 1, intake: at({ carb: 80 }), meal: carbSnack }).fit, null);
});

test('quantity multiplies RDI values', () => {
  assert.deepEqual(scaleMeal(jollof, 2), { carb: 96, protein: 44, fat: 36, vitamin: 14, mineral: 10 });
  assert.equal(fitFor({ gate: 0, intake: emptyIntake(), meal: jollof, quantity: 2 }).fit, 'Caution');
  assert.throws(() => scaleMeal(jollof, 0), TypeError);
  assert.throws(() => scaleMeal(jollof, 1.5), TypeError);
});

test('cart: projected intake sums every line; under G = 0 going past 90% only warns', () => {
  const c = evaluateCart({
    gate: 0, intake: at({ carb: 20 }), meals,
    lines: [{ mealId: 3, quantity: 1 }, { mealId: 1, quantity: 2 }],
  });
  assert.equal(c.projected.carb, 126);
  assert.equal(c.projectedBands.carb, 'Critical');
  assert.ok(c.warnings.some((w) => w.foodClass === 'carb' && w.intakeLevel === 'Critical'));
  assert.deepEqual(c.blocked, []);
  assert.equal(c.canCheckout, true);
});

test('cart: under G = 1 the projected-intake lock blocks the line that takes its class past 90%', () => {
  // Fish (protein-led) is fine; Jollof's carbohydrates reach 126% only because of the whole cart.
  const c = evaluateCart({
    gate: 1, intake: at({ carb: 20 }), meals,
    lines: [{ mealId: 3, quantity: 1 }, { mealId: 1, quantity: 2 }],
  });
  assert.deepEqual(c.blocked, [1]);
  assert.equal(c.canCheckout, false);
  const line = c.lines.find((l) => l.mealId === 1);
  assert.equal(line.fit, 'Restricted today');
  assert.equal(line.projectedDominant, 126);
  assert.equal(line.fitsQuantity, 1, 'one Jollof would fit: 20 + 10 + 48 = 78%');
  assert.equal(c.lines.find((l) => l.mealId === 3).locked, false);
});

test('cart: a cart that ends exactly at 90% is allowed', () => {
  const carbLed = { id: 8, name: 'Rice and stew', carb: 40, protein: 5, fat: 5, vitamin: 2, mineral: 2, dominantClass: 'carb', isBalanced: false };
  const c = evaluateCart({ gate: 1, intake: at({ carb: 10 }), meals: [carbLed], lines: [{ mealId: 8, quantity: 2 }] });
  assert.equal(c.projected.carb, 90);
  assert.equal(c.canCheckout, true);
  assert.deepEqual(c.blocked, []);
});

test('cart: balanced lines are never locked, even past 90% under G = 1', () => {
  const c = evaluateCart({ gate: 1, intake: at({ carb: 80 }), meals, lines: [{ mealId: 2, quantity: 2 }] });
  assert.equal(c.projected.carb, 140);
  assert.deepEqual(c.blocked, []);
  assert.equal(c.lines[0].fit, 'Balanced');
  assert.equal(c.canCheckout, true);
});

test('cart: when no portion fits, fitsQuantity is 0', () => {
  const c = evaluateCart({ gate: 1, intake: at({ carb: 60 }), meals, lines: [{ mealId: 1, quantity: 1 }] });
  assert.equal(c.lines[0].fitsQuantity, 0);
  assert.equal(c.canCheckout, false);
});

test('menu: under G = 1 one serving that would take the dish\'s class past 90% is Restricted today', () => {
  const r = evaluate({ gate: 1, intake: at({ carb: 50 }), meals });
  assert.equal(fitOf(r, 1).fit, 'Restricted today', 'Jollof: 50 + 48 = 98%');
  assert.equal(fitOf(r, 1).locked, true);
  assert.equal(fitOf(r, 2).fit, 'Balanced', 'balanced bowl stays available');
  const soft = evaluate({ gate: 0, intake: at({ carb: 50 }), meals });
  assert.equal(fitOf(soft, 1).fit, 'Caution');
  assert.equal(fitOf(soft, 1).locked, false, 'G = 0 only warns');
});

test('cart: a Restricted today line blocks checkout; a balanced line never does', () => {
  const c = evaluateCart({
    gate: 1, intake: at({ carb: 95 }), meals,
    lines: [{ mealId: 1, quantity: 1 }, { mealId: 2, quantity: 1 }],
  });
  assert.deepEqual(c.blocked, [1]);
  assert.equal(c.canCheckout, false);
  assert.equal(c.lines.find((l) => l.mealId === 2).locked, false);
});

test('cart: the same Critical line only warns under gate 0', () => {
  const c = evaluateCart({ gate: 0, intake: at({ carb: 95 }), meals, lines: [{ mealId: 1, quantity: 1 }] });
  assert.equal(c.canCheckout, true);
  assert.equal(c.lines[0].fit, 'Caution');
});

test('cart: empty carts and unknown meals cannot check out', () => {
  assert.equal(evaluateCart({ gate: 0, intake: emptyIntake(), meals, lines: [] }).canCheckout, false);
  assert.throws(() => evaluateCart({ gate: 0, intake: emptyIntake(), meals, lines: [{ mealId: 99, quantity: 1 }] }), RangeError);
});

// ---------- Bug: under G = 1 one checkout could take a class past 90% ----------
test('G = 1: a cart that would take a non-balanced dish\'s class past 90% is refused (3 × Jollof at carbohydrates 50%)', () => {
  const c = evaluateCart({ gate: 1, intake: at({ carb: 50 }), meals, lines: [{ mealId: 1, quantity: 3 }] });
  assert.equal(c.projected.carb, 194);
  assert.equal(c.canCheckout, false);
  assert.deepEqual(c.blocked, [1]);
});

test('new sample dishes: dominant class and balanced flag come from the existing rules', () => {
  const dish = (carb, protein, fat, vitamin, mineral) => classifyMeal({ carb, protein, fat, vitamin, mineral });
  assert.deepEqual(dish(13, 28, 6, 10, 15), { dominantClass: 'protein', isBalanced: true }); // Moi moi (1 wrap)
  assert.deepEqual(dish(24, 36, 35, 8, 15), { dominantClass: 'protein', isBalanced: false }); // Okpa: protein 36 > 35
  assert.deepEqual(dish(25, 24, 19, 25, 15), { dominantClass: 'carb', isBalanced: true }); // Achicha: carb and vitamin tie; carb comes first
  assert.deepEqual(dish(28, 26, 18, 15, 14), { dominantClass: 'carb', isBalanced: true }); // Ayaraya oka (otipi)
  assert.deepEqual(dish(38, 22, 15, 14, 12), { dominantClass: 'carb', isBalanced: false }); // Ayaraya ji: carb 38 > 35
  assert.deepEqual(dish(11, 14, 8, 8, 20), { dominantClass: 'mineral', isBalanced: true }); // Yoghurt (1 cup), an extra
});

test('feedback pop-up: after the 2nd delivered order, postponed to the next delivery, at most 3 times, never after submitting', async () => {
  const { shouldShowFeedback, summariseFeedback } = await import('../src/logic/feedback.js');
  assert.equal(shouldShowFeedback({ delivered: 1, submitted: false }), false, 'not after the first delivered order');
  assert.equal(shouldShowFeedback({ delivered: 2, submitted: false }), true, 'after the second');
  assert.equal(shouldShowFeedback({ delivered: 2, submitted: false, timesShown: 1, shownAtDelivered: 2 }), false, '"Not now" postpones it');
  assert.equal(shouldShowFeedback({ delivered: 3, submitted: false, timesShown: 1, shownAtDelivered: 2 }), true, 'until the next delivered order');
  assert.equal(shouldShowFeedback({ delivered: 9, submitted: false, timesShown: 3, shownAtDelivered: 4 }), false, 'never more than 3 times');
  assert.equal(shouldShowFeedback({ delivered: 5, submitted: true }), false, 'never after it is submitted');
  const summary = summariseFeedback([
    { orderingScore: 4, guidanceScore: 5, changedOrder: 'yes' },
    { orderingScore: 5, guidanceScore: 3, changedOrder: 'sometimes' },
    { orderingScore: 3, guidanceScore: 4, changedOrder: 'yes' },
  ]);
  assert.deepEqual(summary, { responses: 3, averageOrdering: 4, averageGuidance: 4, changedOrder: { yes: 2, no: 0, sometimes: 1 } });
  assert.deepEqual(summariseFeedback([]).averageOrdering, null);
});

test('password reset tokens: 32 random bytes, only the SHA-256 hash stored, single use, 30 minutes', async () => {
  const { newResetToken, hashResetToken, resetExpiry, resetTokenUsable, RESET_MINUTES } = await import('../src/services/passwordReset.js');
  const a = newResetToken();
  const b = newResetToken();
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, hashResetToken(a.token));
  assert.notEqual(a.hash, a.token, 'the stored value is not the token');
  assert.equal(RESET_MINUTES, 30);
  const issued = new Date('2026-10-24T09:00:00Z');
  const expiresAt = resetExpiry(issued);
  const at = (min) => new Date(issued.getTime() + min * 60_000);
  assert.equal(resetTokenUsable({ expiresAt, usedAt: null }, at(29)), true);
  assert.equal(resetTokenUsable({ expiresAt, usedAt: null }, at(30)), false, 'expired at 30 minutes');
  assert.equal(resetTokenUsable({ expiresAt, usedAt: at(5) }, at(10)), false, 'used once');
});

test('feedback answers: scores 1 to 5, yes / no / sometimes, comment up to 500 characters', async () => {
  const { feedbackBody } = await import('../src/http/schemas.js');
  const ok = { orderingScore: 4, guidanceScore: 5, changedOrder: 'sometimes', comment: '  More soups, please. ' };
  assert.equal(feedbackBody.parse(ok).comment, 'More soups, please.');
  assert.equal(feedbackBody.safeParse({ ...ok, comment: '' }).data.comment, null);
  assert.equal(feedbackBody.safeParse({ ...ok, orderingScore: 6 }).success, false);
  assert.equal(feedbackBody.safeParse({ ...ok, guidanceScore: 0 }).success, false);
  assert.equal(feedbackBody.safeParse({ ...ok, changedOrder: 'maybe' }).success, false);
  assert.equal(feedbackBody.safeParse({ ...ok, comment: 'x'.repeat(501) }).success, false);
  assert.equal(feedbackBody.safeParse({ ...ok, userId: 3 }).success, false, 'no unknown fields');
});
