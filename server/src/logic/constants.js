// Food classes tracked by ChopWise (Chapter 1.1).
export const FOOD_CLASSES = ['carb', 'protein', 'fat', 'vitamin', 'mineral'];

export const CLASS_LABELS = {
  carb: 'Carbohydrates',
  protein: 'Proteins',
  fat: 'Fats and oils',
  vitamin: 'Vitamins',
  mineral: 'Minerals',
};

// Intake bands as % of RDI (Table 3.1, Definition of Terms 1.7).
// Upper bounds are inclusive: 0–40 Low, >40–70 Moderate, >70–90 High, >90 Critical.
export const BANDS = {
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const BAND_ORDER = [BANDS.LOW, BANDS.MODERATE, BANDS.HIGH, BANDS.CRITICAL];

export const LOW_MAX = 40;
export const WARNING_THRESHOLD = 70;
export const RESTRICTION_THRESHOLD = 90;
// The full daily limit (100% of RDI). Passing it adds a third warning, on top of 70% and 90%
// (agreed with the user). It doesn't change the bands or the lock, which stays at 90% under G = 1.
export const DAILY_LIMIT = 100;
export const OVER_LIMIT = 'Over'; // the warning level stored for it

// Balanced meal: every class between 5% and 35% of RDI (Definition of Terms 1.7).
export const BALANCED_MIN = 5;
export const BALANCED_MAX = 35;

// Fit signal shown on every dish: the decision engine's verdict for this user today.
// A dish that matches none of these shows no signal and stays orderable.
export const FIT = {
  BALANCED: 'Balanced',
  RECOMMENDED: 'Recommended',
  CAUTION: 'Caution',
  RESTRICTED: 'Restricted today',
};
