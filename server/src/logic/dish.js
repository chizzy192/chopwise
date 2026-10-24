// Caterer dish library rules (CLAUDE.md item 11). Pure functions only.
import { FOOD_CLASSES } from './constants.js';

export const DISH_TYPES = ['meal', 'extra', 'addon'];

// Meals and extras carry RDI values and count toward intake; add-ons (water) carry none.
export const hasRdi = (type) => type === 'meal' || type === 'extra';

// Prices are whole kobo (₦1 = 100 kobo), so sums never pick up floating-point rounding errors.
export const MIN_PRICE_KOBO = 100; // ₦1
export const MAX_PRICE_KOBO = 10_000_000; // ₦100,000

export const rdiOf = (dish) => Object.fromEntries(FOOD_CLASSES.map((c) => [c, dish[c]]));

// The food classes whose RDI value differs between two versions of a meal.
export function changedClasses(before, after) {
  if (!before) return [];
  return FOOD_CLASSES.filter((c) => Number(before[c]) !== Number(after[c]));
}

// Editing any RDI value on an approved meal sends it back for approval.
// Name, description, price and photo edits never do. Add-ons have no RDI values.
export function needsReapproval({ type, isApproved, before, after }) {
  return hasRdi(type) && isApproved && changedClasses(before, after).length > 0;
}

// Sold out lasts for one Africa/Lagos day: a dish marked on an earlier day is available again.
export function isSoldOut(soldOutOn, today) {
  return soldOutOn === today;
}

export function dishStatus({ type, isApproved, approvedValues }) {
  if (type === 'addon') return 'No approval needed';
  if (isApproved) return 'Approved';
  return approvedValues ? 'Awaiting re-approval' : 'Awaiting approval';
}

/**
 * Splits the staff menu. Only approved meals reach the decision engine, so add-ons never
 * affect intake or carry a Fit signal. Sold-out meals are listed after the rest, not ordered.
 */
export function splitMenu(dishes, today) {
  const meals = dishes.filter((d) => d.type === 'meal' && d.isApproved);
  return {
    available: meals.filter((d) => !isSoldOut(d.soldOutOn, today)),
    soldOut: meals.filter((d) => isSoldOut(d.soldOutOn, today)),
  };
}
