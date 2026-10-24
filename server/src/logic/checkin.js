// Health onboarding and the daily check-in (CLAUDE.md items 8 and 9). Pure functions only.
import { majorityGate } from './gate.js';
import { previousMealOutcomes } from './engine.js';

export const CONDITIONS = ['Diabetes', 'Hypertension', 'Heart disease', 'High cholesterol', 'Kidney disease'];

// H (Chapter 2.1.1): 1 for a declared diet-related condition. (The "well controlled through diet"
// option was removed at the user's request; every declared condition now counts.)
export function healthParameter({ hasCondition }) {
  return hasCondition === true ? 1 : 0;
}

// One line telling the user what their answer means for guidance.
export function healthExplanation(profile) {
  if (!profile.hasCondition) {
    return 'Health check: no. With no diet-related condition, ChopWise only guides you firmly when both meal checks find a food class above 70% of your daily limit.';
  }
  return 'Health check: yes. Because you have a diet-related condition, one meal check finding a food class above 70% of your daily limit is enough for firm guidance.';
}

// Pre-fill: the meals from the user's two most recent order lines, most recent first.
export function prefill(recentMealIds) {
  return { prev1: recentMealIds[0] ?? null, prev2: recentMealIds[1] ?? null };
}

// 'history' when the user kept the pre-filled meal; 'manual' when they chose another one,
// including "I ate something not on ChopWise" with the closest match.
export function sourceFor(choice, prefilledId) {
  return !choice.ateElsewhere && choice.mealId === prefilledId ? 'history' : 'manual';
}

/**
 * The once-a-day gate result. mealP1 is the most recent meal and mealP2 the one before it;
 * the older meal is applied first (engine.previousMealOutcomes).
 */
export function computeCheckin({ h, mealP1, mealP2 }) {
  const { p1, p2 } = previousMealOutcomes(mealP1, mealP2);
  return { h, p1, p2, g: majorityGate(h, p1, p2).g };
}

// The check-in can be redone until the first order of the day; after that it is locked.
export function canRedoCheckin(ordersToday) {
  return ordersToday === 0;
}

const join = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// Today's guidance in words: which of the three checks found a risk.
export function explainGate({ h, p1, p2, g }) {
  const found = [];
  if (h) found.push('your health profile shows a diet-related condition');
  if (p2) found.push('the earlier of your two meals took a food class above 70% of your daily limit');
  if (p1) found.push('your last two meals together took a food class above 70% of your daily limit');
  if (g === 1) {
    return {
      guidance: 'full',
      title: 'Firm guidance today',
      reason: `Two or more checks found a risk: ${join(found)}. You get suggestions, warnings and, if a food class goes past 90% of your daily limit, some meals are locked for the rest of the day.`,
    };
  }
  const which = found.length === 0
    ? 'None of the three checks found a risk'
    : `Only one check found a risk (${found[0]})`;
  return {
    guidance: 'soft',
    title: 'Gentle guidance today',
    reason: `${which}, so you get suggestions and warnings, and nothing is locked.`,
  };
}
