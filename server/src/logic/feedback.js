// The feedback pop-up (CLAUDE.md item 17). Pure functions only.
export const FEEDBACK_AFTER_DELIVERED = 2; // shown after a staff member's 2nd delivered order (all time)
export const MAX_FEEDBACK_PROMPTS = 3; // never shown more than 3 times in total
export const CHANGED_ORDER = ['yes', 'no', 'sometimes'];
export const MAX_COMMENT = 500;

/**
 * Whether to show the pop-up now. `shownAtDelivered` is the delivered-order count when it was last
 * shown: showing it (and "Not now") postpones it until another order is delivered.
 */
export function shouldShowFeedback({ delivered, submitted, timesShown = 0, shownAtDelivered = null }) {
  if (submitted || delivered < FEEDBACK_AFTER_DELIVERED || timesShown >= MAX_FEEDBACK_PROMPTS) return false;
  return shownAtDelivered === null || delivered > shownAtDelivered;
}

// Averages to one decimal place and the Yes / No / Sometimes split, for the admin report.
export function summariseFeedback(rows) {
  const n = rows.length;
  const avg = (k) => (n ? Math.round((rows.reduce((s, r) => s + r[k], 0) / n) * 10) / 10 : null);
  const split = Object.fromEntries(CHANGED_ORDER.map((a) => [a, rows.filter((r) => r.changedOrder === a).length]));
  return { responses: n, averageOrdering: avg('orderingScore'), averageGuidance: avg('guidanceScore'), changedOrder: split };
}
