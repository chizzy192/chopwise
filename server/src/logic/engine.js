import {
  FOOD_CLASSES, CLASS_LABELS, BANDS, BAND_ORDER, FIT, LOW_MAX, WARNING_THRESHOLD, RESTRICTION_THRESHOLD, DAILY_LIMIT, OVER_LIMIT, OVER_LIMIT_ADD,
} from './constants.js';

export function emptyIntake() {
  return Object.fromEntries(FOOD_CLASSES.map((c) => [c, 0]));
}

export function addMeal(intake, meal) {
  return Object.fromEntries(FOOD_CLASSES.map((c) => [c, round2((intake[c] ?? 0) + (meal[c] ?? 0))]));
}

// Quantity multiplies a meal's RDI values.
export function scaleMeal(meal, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TypeError(`Quantity must be a whole number of at least 1, got ${quantity}`);
  }
  return Object.fromEntries(FOOD_CLASSES.map((c) => [c, round2((meal[c] ?? 0) * quantity)]));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Band for one food class (Table 3.1).
export function band(percent) {
  if (percent > RESTRICTION_THRESHOLD) return BANDS.CRITICAL;
  if (percent > WARNING_THRESHOLD) return BANDS.HIGH;
  if (percent > LOW_MAX) return BANDS.MODERATE;
  return BANDS.LOW;
}

export function bandsFor(intake) {
  return Object.fromEntries(FOOD_CLASSES.map((c) => [c, band(intake[c] ?? 0)]));
}

const rank = (b) => BAND_ORDER.indexOf(b);

// Meal outcome for P1/P2: 1 if, after the meal, any class is above 70% of RDI (High or Critical).
export function mealOutcome(intakeAfter) {
  return FOOD_CLASSES.some((c) => (intakeAfter[c] ?? 0) > WARNING_THRESHOLD) ? 1 : 0;
}

// Outcomes for the two meals a staff member reports before ordering.
// The older meal (P2) is applied first, then the most recent (P1) on top of it,
// so P1 reflects the cumulative effect of both meals.
export function previousMealOutcomes(mealP1, mealP2) {
  const afterP2 = addMeal(emptyIntake(), mealP2);
  const afterP1 = addMeal(afterP2, mealP1);
  return { p1: mealOutcome(afterP1), p2: mealOutcome(afterP2) };
}

// Classes still in the Low band are under-consumed and get recommended.
export function underconsumedClasses(intake) {
  return FOOD_CLASSES.filter((c) => band(intake[c] ?? 0) === BANDS.LOW);
}

// What is left of a class before it passes 90% of RDI (never below 0).
export function remainingAllowance(intake, foodClass) {
  return round2(Math.max(0, RESTRICTION_THRESHOLD - (intake[foodClass] ?? 0)));
}

const lower = (c) => CLASS_LABELS[c].toLowerCase();

/**
 * Fit signal for one dish at a given quantity, judged on projected intake
 * (current intake + meal × quantity). Checked in this order:
 *   0. A food type is already past 100% of the daily limit and this
 *      dish adds 20% or more of it (any G, balanced or not)       → Restricted today (locked)
 *   1. Balanced meal                                            → Balanced (never locked otherwise)
 *   2. Dominant class would end above 90%: G = 1                → Restricted today (locked)
 *                                          G = 0                → Caution (strong warning)
 *   3. Dominant class still Low and no class it adds to
 *      ends above 90%                                           → Recommended
 *   4. Adds to a class that crosses into High or ends Critical   → Caution
 *   5. Otherwise                                                → no signal (fit = null)
 * Step 2 covers a class that is already Critical and one this dish would take past 90%
 * (CLAUDE.md item 4). Exactly 90% still fits. Recommended beats Caution when a class only
 * crosses 70%; the warning stays in `why`.
 */
export function fitFor({ gate, intake, meal, quantity = 1 }) {
  const adds = scaleMeal(meal, quantity);
  const projected = addMeal(intake, adds);
  const before = bandsFor(intake);

  // Past the full daily limit: a big addition to that food type is locked whatever G is.
  const past = pastLimitClass(intake, adds);
  if (past) {
    return {
      fit: FIT.RESTRICTED, locked: true, lockReason: 'past-limit', lockClass: past, adds, projected,
      why: [pastLimitWhy(past, intake[past], adds[past])],
    };
  }

  const effects = FOOD_CLASSES.filter((c) => adds[c] > 0).map((c) => ({
    foodClass: c,
    adds: adds[c],
    current: intake[c] ?? 0,
    projected: projected[c],
    before: before[c],
    after: band(projected[c]),
  }));
  const overLimit = effects.filter((e) => e.after === BANDS.CRITICAL);
  const intoHigh = effects.filter((e) => e.after === BANDS.HIGH && rank(e.before) < rank(BANDS.HIGH));
  const dominantBand = before[meal.dominantClass];
  const dominantPastLimit = projected[meal.dominantClass] > RESTRICTION_THRESHOLD;

  let fit = null;
  let locked = false;
  if (meal.isBalanced) fit = FIT.BALANCED;
  else if (dominantPastLimit) {
    fit = gate === 1 ? FIT.RESTRICTED : FIT.CAUTION;
    locked = gate === 1;
  } else if (dominantBand === BANDS.LOW && overLimit.length === 0) fit = FIT.RECOMMENDED;
  else if (overLimit.length || intoHigh.length) fit = FIT.CAUTION;

  return {
    fit, locked, ...(locked ? { lockReason: 'cut-off', lockClass: meal.dominantClass } : {}),
    adds, projected, why: whyLines({ gate, meal, fit, intake, projected, effects, overLimit, intoHigh }),
  };
}

/** The food type already past 100% that this addition adds 20% or more of (the largest), or null. */
export function pastLimitClass(before, adds) {
  return FOOD_CLASSES
    .filter((c) => (before[c] ?? 0) > DAILY_LIMIT && (adds[c] ?? 0) >= OVER_LIMIT_ADD)
    .sort((a, b) => adds[b] - adds[a])[0] ?? null;
}

const pastLimitWhy = (c, at, adds) => `${CLASS_LABELS[c]} are past your full daily limit today (${at}%). This adds ${adds}%, and anything adding ${OVER_LIMIT_ADD}% or more of it is locked until midnight.`;

// Plain-language reasons for the Fit popover, citing RDI numbers.
function whyLines({ gate, meal, fit, intake, projected, overLimit, intoHigh, effects }) {
  const lines = [];
  const d = meal.dominantClass;
  const alreadyCritical = band(intake[d] ?? 0) === BANDS.CRITICAL;
  if (fit === FIT.BALANCED) {
    lines.push('Every food class is between 5% and 35% of your daily limit.');
  } else if (fit === FIT.RESTRICTED && alreadyCritical) {
    lines.push(`${CLASS_LABELS[d]} is above 90% today (${intake[d]}%). Meals that are mostly ${lower(d)} are locked until midnight.`);
  } else if (fit === FIT.RESTRICTED) {
    lines.push(`This meal is mostly ${lower(d)}. You're at ${intake[d] ?? 0}% today and it would take you to ${projected[d]}%, above the 90% cut-off, so it's locked under firm guidance.`);
  } else if (!meal.isBalanced && alreadyCritical) {
    lines.push(`${CLASS_LABELS[d]} is above 90% today (${intake[d]}%). This meal is mostly ${lower(d)}, so we strongly suggest choosing something else.`);
  } else if (fit === FIT.RECOMMENDED) {
    const e = effects.find((x) => x.foodClass === d);
    lines.push(`Adds ${e?.adds ?? 0}% ${lower(d)}. You're at ${intake[d] ?? 0}% today, so this helps fill it.`);
  }
  for (const e of overLimit) {
    lines.push(`Adds ${e.adds}% ${lower(e.foodClass)}. You're at ${e.current}% today; the cut-off is 90%.`);
  }
  for (const e of intoHigh) {
    lines.push(`Adds ${e.adds}% ${lower(e.foodClass)}. You're at ${e.current}% today; this takes you to ${e.projected}%, above 70%.`);
  }
  if (gate === 0 && fit === FIT.CAUTION) {
    // Soft guidance: nothing is locked, the warning is the guidance.
    lines.push('Nothing is locked today; this is a warning only.');
  }
  return lines;
}

const FIT_ORDER = [FIT.BALANCED, FIT.RECOMMENDED, null, FIT.CAUTION, FIT.RESTRICTED];
const MAX_ALTERNATIVES = 3;

/**
 * Alternatives for a locked meal: balanced meals, and unlocked meals whose dominant class is not
 * Critical, sorted by how little they add to the locked meal's class (lowest first).
 * catalogue: meals already given their Fit for today.
 */
export function alternativesFor(locked, catalogue, intake) {
  const cls = locked.lockClass ?? locked.dominantClass;
  return catalogue
    .filter((m) => m.id !== locked.id && !m.locked && (m.isBalanced || band(intake[m.dominantClass] ?? 0) !== BANDS.CRITICAL))
    .sort((a, b) => (a[cls] ?? 0) - (b[cls] ?? 0) || FIT_ORDER.indexOf(a.fit) - FIT_ORDER.indexOf(b.fit) || a.name.localeCompare(b.name))
    .slice(0, MAX_ALTERNATIVES)
    .map((m) => ({ id: m.id, name: m.name, foodClass: cls, adds: m[cls] ?? 0, text: `Adds ${m[cls] ?? 0}% ${lower(cls)}` }));
}

/**
 * Rule-based decision engine (Chapter 3.3).
 * G = 0 (soft): recommendations and warnings. Nothing is locked.
 * G = 1 (full): recommendations, warnings and restrictions. Non-balanced meals whose
 *               dominant class is Critical, or would be after one serving, stay visible but
 *               locked, with alternatives (alternativesFor).
 * Balanced meals are never restricted and are listed first.
 */
export function evaluate({ gate, intake, meals }) {
  const bands = bandsFor(intake);
  const under = underconsumedClasses(intake);
  const notifications = [];
  const restrictedClasses = [];

  for (const c of FOOD_CLASSES) {
    if (bands[c] === BANDS.CRITICAL) {
      if (gate === 1) restrictedClasses.push(c);
      notifications.push({
        foodClass: c, intakeLevel: BANDS.CRITICAL,
        message: gate === 1
          ? `${CLASS_LABELS[c]} intake is above 90% of your daily limit. Meals that are mostly ${lower(c)} are locked for today.`
          : `${CLASS_LABELS[c]} intake is above 90% of your daily limit. Try to avoid meals that are mostly ${lower(c)} today.`,
      });
      // A third warning once the full daily limit is passed, whatever the guidance level.
      if ((intake[c] ?? 0) > DAILY_LIMIT) {
        notifications.push({
          foodClass: c, intakeLevel: OVER_LIMIT,
          message: `${CLASS_LABELS[c]} intake is at ${intake[c]}% of your daily limit: you've gone past your full daily limit for today.`,
        });
      }
    } else if (bands[c] === BANDS.HIGH) {
      notifications.push({
        foodClass: c, intakeLevel: BANDS.HIGH,
        message: `${CLASS_LABELS[c]} intake is above 70% of your daily limit and getting close to the 90% cut-off. You have ${remainingAllowance(intake, c)}% left.`,
      });
    }
  }

  const varietyActive = FOOD_CLASSES.some((c) => bands[c] !== BANDS.LOW);

  const catalogue = meals
    .map((m) => {
      const { fit, locked, why, lockReason, lockClass } = fitFor({ gate, intake, meal: m });
      return { ...m, fit, locked, why, ...(locked ? { lockReason, lockClass } : {}) };
    })
    .sort((a, b) => FIT_ORDER.indexOf(a.fit) - FIT_ORDER.indexOf(b.fit));

  for (const m of catalogue) m.alternatives = m.locked ? alternativesFor(m, catalogue, intake) : [];

  return {
    gate, guidance: gate === 1 ? 'full' : 'soft',
    bands, underconsumed: under, varietyActive, restrictedClasses, notifications,
    catalogue,
    locked: catalogue.filter((m) => m.locked).map((m) => m.id),
  };
}

/**
 * Evaluates the whole cart before checkout, on projected intake after every line is added.
 * lines: [{ mealId, quantity }].
 * Under G = 1 a non-balanced line is Restricted today if its dominant class would end above 90%
 * after the whole cart (CLAUDE.md item 4), and checkout is blocked. fitsQuantity is the most of
 * that dish that would still fit with the rest of the cart (0 if none). Under G = 0 the same
 * cart only gets warnings. Balanced lines are never locked.
 */
export function evaluateCart({ gate, intake, meals, lines }) {
  const byId = new Map(meals.map((m) => [m.id, m]));
  let projected = { ...emptyIntake(), ...intake };

  const evaluated = lines.map(({ mealId, quantity }) => {
    const meal = byId.get(mealId);
    if (!meal) throw new RangeError(`Meal ${mealId} is not in the catalogue`);
    const result = fitFor({ gate, intake, meal, quantity });
    projected = addMeal(projected, result.adds);
    return {
      mealId, quantity, meal, adds: result.adds, fit: result.fit, locked: result.locked, why: result.why,
      ...(result.locked ? { lockReason: result.lockReason, lockClass: result.lockClass } : {}),
    };
  });

  // The whole cart: a dish's dominant class may only pass 90% because of the other lines.
  for (const line of evaluated) {
    const { meal } = line;
    const d = meal.dominantClass;
    line.dominantClass = d;
    line.projectedDominant = projected[d];
    if (meal.isBalanced || projected[d] <= RESTRICTION_THRESHOLD) continue;
    const others = projected[d] - line.adds[d];
    const perServing = meal[d] ?? 0;
    line.fitsQuantity = perServing > 0
      ? Math.max(0, Math.min(line.quantity - 1, Math.floor((RESTRICTION_THRESHOLD - others) / perServing + 1e-9)))
      : line.quantity;
    if (gate === 1) {
      if (!line.locked) line.why = [...line.why, `With everything in this cart, ${lower(d)} would reach ${projected[d]}%, above the 90% cut-off.`];
      line.fit = FIT.RESTRICTED;
      line.locked = true;
      line.lockReason ??= 'cut-off';
      line.lockClass ??= d;
    }
  }

  // Past the full daily limit, counting the rest of the cart: a line adding 20% or more of a food
  // type that is already over 100% without it is locked, under either G, balanced or not.
  for (const line of evaluated) {
    const without = Object.fromEntries(FOOD_CLASSES.map((c) => [c, round2(projected[c] - line.adds[c])]));
    const past = pastLimitClass(without, line.adds);
    if (!past) continue;
    const perServing = line.meal[past] ?? 0;
    const fits = perServing > 0 ? Math.max(0, Math.min(line.quantity - 1, Math.ceil(OVER_LIMIT_ADD / perServing) - 1)) : line.quantity;
    line.fitsQuantity = Math.min(line.fitsQuantity ?? fits, fits);
    if (line.lockReason !== 'past-limit') line.why = [...line.why, pastLimitWhy(past, without[past], line.adds[past])];
    Object.assign(line, {
      fit: FIT.RESTRICTED, locked: true, lockReason: 'past-limit', lockClass: past, pastLimitAt: without[past], lockAdds: line.adds[past],
    });
  }

  const before = bandsFor(intake);
  const projectedBands = bandsFor(projected);
  const warnings = FOOD_CLASSES
    .filter((c) => projected[c] > (intake[c] ?? 0))
    .filter((c) => projectedBands[c] === BANDS.CRITICAL
      || (projectedBands[c] === BANDS.HIGH && rank(before[c]) < rank(BANDS.HIGH)))
    .map((c) => {
      if (projected[c] > DAILY_LIMIT) {
        return { foodClass: c, intakeLevel: OVER_LIMIT, message: `This order takes ${lower(c)} to ${projected[c]}% of your daily limit, past your full daily limit for today.` };
      }
      return {
        foodClass: c, intakeLevel: projectedBands[c],
        message: projectedBands[c] === BANDS.CRITICAL
          ? `This order takes ${lower(c)} to ${projected[c]}% of your daily limit, above the 90% cut-off.`
          : `This order takes ${lower(c)} to ${projected[c]}% of your daily limit, above 70%.`,
      };
    });

  const blocked = evaluated.filter((l) => l.locked).map((l) => l.mealId);
  return {
    gate,
    lines: evaluated.map(({ meal, adds, ...line }) => line),
    projected, projectedBands, warnings, blocked,
    canCheckout: evaluated.length > 0 && blocked.length === 0,
  };
}
