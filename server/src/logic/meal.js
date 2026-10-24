import { FOOD_CLASSES, CLASS_LABELS, BALANCED_MIN, BALANCED_MAX } from './constants.js';

// Validates caterer input (Chapter 3.4.7.1): every class present, 0–100.
export function validateMealPercents(percents) {
  const errors = [];
  for (const c of FOOD_CLASSES) {
    const v = percents?.[c];
    const label = CLASS_LABELS[c];
    if (v === undefined || v === null || v === '') errors.push(`${label} is required`);
    else if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`${label} must be a number`);
    else if (v < 0 || v > 100) errors.push(`${label} must be between 0 and 100%`);
  }
  return errors;
}

// The food class with the highest RDI percentage in the meal.
export function dominantClass(percents) {
  return FOOD_CLASSES.reduce((best, c) => (percents[c] > percents[best] ? c : best), FOOD_CLASSES[0]);
}

// True when every class is within 5–35% of RDI.
export function isBalanced(percents) {
  return FOOD_CLASSES.every((c) => percents[c] >= BALANCED_MIN && percents[c] <= BALANCED_MAX);
}

export function classifyMeal(percents) {
  return { dominantClass: dominantClass(percents), isBalanced: isBalanced(percents) };
}
