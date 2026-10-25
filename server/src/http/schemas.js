// Request schemas. Objects are strict: an unknown field (for example `role` on sign-up) is rejected.
import { z } from 'zod';
import { FOOD_CLASSES, CLASS_LABELS } from '../logic/constants.js';
import { ROLES } from '../logic/roles.js';
import { CONDITIONS } from '../logic/checkin.js';
import { DISH_TYPES, MIN_PRICE_KOBO, MAX_PRICE_KOBO, hasRdi } from '../logic/dish.js';
import { MAX_QUANTITY } from '../logic/checkout.js';
import { CHANGED_ORDER, MAX_COMMENT } from '../logic/feedback.js';

const id = (error) => z.coerce.number({ error }).int({ error }).positive({ error });
const email = z.string({ error: 'Enter a valid email' }).trim().toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email' }).max(150, { error: 'Email must be 150 characters or fewer' }));
const name = (label) => z.string({ error: `Enter ${label}` }).trim()
  .min(1, { error: `Enter ${label}` }).max(100, { error: `${label[0].toUpperCase()}${label.slice(1)} must be 100 characters or fewer` });

// New passwords: at least 10 characters. The upper bound stops very long inputs tying up the hasher.
export const newPassword = z.string({ error: 'Enter a password' })
  .min(10, { error: 'Use a password of at least 10 characters' })
  .max(200, { error: 'Use a password of 200 characters or fewer' });

export const idParams = z.strictObject({ id: id('That record id is not valid') });

// Sign-up and password reset ask for the password twice; the server checks both match.
const confirmPassword = z.string({ error: 'Confirm your password' }).max(200, { error: "Passwords don't match" });
const passwordsMatch = [(v) => v.password === v.confirmPassword, { error: "Passwords don't match", path: ['confirmPassword'] }];

export const registerBody = z.strictObject({ name: name('your name'), email, password: newPassword, confirmPassword })
  .refine(...passwordsMatch);

export const forgotPasswordBody = z.strictObject({ email });

// The token from the emailed link: 32 random bytes as 64 hex characters.
export const resetPasswordBody = z.strictObject({
  token: z.string({ error: 'This reset link is not valid' }).regex(/^[0-9a-f]{64}$/, { error: 'This reset link is not valid' }),
  password: newPassword,
  confirmPassword,
}).refine(...passwordsMatch);

const score = (label) => {
  const error = `Choose a score from 1 to 5 for ${label}`;
  return z.number({ error }).int({ error }).min(1, { error }).max(5, { error });
};
export const feedbackBody = z.strictObject({
  orderingScore: score('how easy ordering was'),
  guidanceScore: score('how helpful the meal guidance was'),
  changedOrder: z.enum(CHANGED_ORDER, { error: 'Say whether the guidance changed what you ordered' }),
  comment: z.string({ error: 'Your comment must be text' }).trim()
    .max(MAX_COMMENT, { error: `Keep your comment to ${MAX_COMMENT} characters or fewer` })
    .transform((v) => v || null).nullable().optional(),
});

// Login accepts any existing password length; the 10-character rule applies to new passwords.
export const loginBody = z.strictObject({
  email: z.string({ error: 'Enter your email and password' }).trim().toLowerCase().max(150, { error: 'Incorrect email or password' }),
  password: z.string({ error: 'Enter your email and password' }).min(1, { error: 'Enter your email and password' })
    .max(200, { error: 'Incorrect email or password' }),
});

// Cart and checkout: dish ids and quantities only. Prices, Fit and totals come from the server.
const cartLine = z.strictObject({
  dishId: id('Choose a dish'),
  quantity: z.number({ error: 'Enter a quantity' }).int({ error: 'Quantities are whole numbers' })
    .min(1, { error: 'Quantities start at 1' }).max(MAX_QUANTITY, { error: `You can order at most ${MAX_QUANTITY} plates of one dish per order` }),
  // Bottled water with a meal line: on unless false (ignored for extras and add-ons).
  water: z.boolean({ error: 'Say whether to add bottled water' }).optional(),
});
export const cartBody = z.strictObject({
  lines: z.array(cartLine, { error: 'Send the cart lines' }).max(30, { error: 'A cart can hold at most 30 dishes' })
    .refine((ls) => new Set(ls.map((l) => l.dishId)).size === ls.length, { error: 'Each dish can appear once; change its quantity instead' }),
});

export const verifyBody = z.strictObject({
  reference: z.string({ error: 'Payment reference missing' }).regex(/^CW-[0-9a-f-]{36}$/, { error: 'That payment reference is not valid' }),
});

export const stockBody = z.strictObject({
  platesLeft: z.number({ error: 'Enter how many plates are left' }).int({ error: 'Plates are whole numbers' })
    .min(0, { error: 'Plates left cannot be negative' }).max(1000, { error: 'Enter 1,000 plates or fewer' }),
});

export const statusBody = z.strictObject({
  status: z.enum(['preparing', 'out_for_delivery'], { error: 'Choose preparing or out for delivery' }),
});

export const codeBody = z.strictObject({
  code: z.string({ error: 'Enter the 4-digit delivery code' }).regex(/^\d{4}$/, { error: 'Enter the 4-digit delivery code' }),
});

// Only the parts of a Paystack event ChopWise uses; Paystack sends many more, so unknown keys are allowed here.
export const paystackEvent = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(), status: z.string().optional(), amount: z.number().optional(), currency: z.string().optional(),
  }).passthrough(),
}).passthrough();

// Health onboarding answer. "No" clears any conditions; "Yes" needs at least one condition.
export const healthProfileBody = z.strictObject({
  hasCondition: z.boolean({ error: 'Answer yes or no to the health question' }),
  conditions: z.array(z.enum(CONDITIONS, { error: 'Choose conditions from the list, or use Other' }))
    .max(CONDITIONS.length, { error: 'Choose conditions from the list, or use Other' }).optional(),
  otherCondition: z.string({ error: 'Describe the other condition in words' }).trim()
    .max(100, { error: 'Keep the other condition to 100 characters or fewer' }).optional(),
}).superRefine((v, ctx) => {
  if (!v.hasCondition) return;
  if (!v.conditions?.length && !v.otherCondition) {
    ctx.addIssue({ code: 'custom', message: 'Tick at least one condition, or describe it under Other' });
  }
}).transform((v) => (v.hasCondition
  ? { hasCondition: true, conditions: [...new Set(v.conditions ?? [])], otherCondition: v.otherCondition || null }
  : { hasCondition: false, conditions: [], otherCondition: null }));

const mealChoice = (label) => z.strictObject({
  mealId: id(`Choose your ${label}`),
  ateElsewhere: z.boolean({ error: 'Say whether you ate this meal somewhere else' }).default(false),
}, { error: `Choose your ${label}` });
export const checkinBody = z.strictObject({ prev1: mealChoice('most recent meal'), prev2: mealChoice('meal before that') });

const percent = (c) => {
  const error = `${CLASS_LABELS[c]} must be a number from 0 to 100`;
  return z.number({ error }).min(0, { error }).max(100, { error });
};
// Dishes. dominant_class, is_balanced and approval are computed or set by the server, so a
// client that sends them is rejected as sending unknown fields.
const dishFields = {
  name: z.string({ error: 'Enter the dish name' }).trim().min(1, { error: 'Enter the dish name' })
    .max(150, { error: 'Dish name must be 150 characters or fewer' }),
  description: z.string({ error: 'The description must be text' }).trim()
    .max(200, { error: 'Keep the description to 200 characters or fewer' })
    .transform((v) => v || null).nullable().optional(),
  priceKobo: z.number({ error: 'Enter the price' }).int({ error: 'Enter the price in whole kobo' })
    .min(MIN_PRICE_KOBO, { error: 'The price must be at least ₦1' })
    .max(MAX_PRICE_KOBO, { error: 'The price must be ₦100,000 or less' }),
  ...Object.fromEntries(FOOD_CLASSES.map((c) => [c, percent(c).optional()])),
};

// Meals and extras need all five RDI values; add-ons must have none.
export function rdiProblem(type, body) {
  const given = FOOD_CLASSES.filter((c) => body[c] !== undefined);
  if (type === 'addon' && given.length) return "Add-ons don't have RDI values. Remove them, or make this dish a meal or an extra.";
  if (hasRdi(type) && given.length < FOOD_CLASSES.length) {
    return `Enter ${CLASS_LABELS[FOOD_CLASSES.find((c) => body[c] === undefined)].toLowerCase()} as a % of daily RDI`;
  }
  return null;
}

export const dishCreateBody = z.strictObject({
  type: z.enum(DISH_TYPES, { error: 'Choose meal, extra or add-on' }),
  ...dishFields,
}).superRefine((v, ctx) => {
  const problem = rdiProblem(v.type, v);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

// The type cannot change after creation; the handler checks the RDI values against the stored type.
export const dishEditBody = z.strictObject(dishFields);

export const availabilityBody = z.strictObject({ available: z.boolean({ error: 'Say whether the dish is available' }) });

export const approveBody = z.strictObject({ approve: z.boolean({ error: 'Say whether to approve the meal' }) });

export const userSearchQuery = z.strictObject({
  q: z.string().trim().max(100, { error: 'Search must be 100 characters or fewer' }).optional(),
});

export const roleBody = z.strictObject({ role: z.enum(ROLES, { error: 'Choose staff, caterer or admin' }) });

export const catererBody = z.strictObject({ name: name('a name'), email, password: newPassword });

// Changing your own password: the current one (or the temporary one an admin gave) and a new one.
export const changePasswordBody = z.strictObject({
  currentPassword: z.string({ error: 'Enter your current password' }).min(1, { error: 'Enter your current password' })
    .max(200, { error: 'Your current password is incorrect' }),
  newPassword,
}).refine((v) => v.currentPassword !== v.newPassword, { error: 'Choose a new password that is different from the current one' });

// An admin resetting a caterer's password gives a temporary one.
export const adminResetPasswordBody = z.strictObject({ password: newPassword });

const twoDecimals = (n) => Math.round(n * 100) === n * 100;
export const settingsBody = z.strictObject({
  vatRate: z.number({ error: 'VAT rate must be a number from 0 to 100' })
    .min(0, { error: 'VAT rate must be between 0% and 100%' }).max(100, { error: 'VAT rate must be between 0% and 100%' })
    .refine(twoDecimals, { error: 'Use at most 2 decimal places for the VAT rate' }),
  deliveryFee: z.number({ error: 'Delivery fee must be a number' })
    .min(0, { error: 'Delivery fee must be ₦0 or more' }).max(1_000_000, { error: 'Delivery fee must be ₦1,000,000 or less' })
    .refine(twoDecimals, { error: 'Use at most 2 decimal places for the delivery fee' }),
  // Optional, so a request that leaves it out keeps the current price.
  waterPrice: z.number({ error: 'Bottled water price must be a number' })
    .min(0, { error: 'Bottled water price must be ₦0 or more' }).max(100_000, { error: 'Bottled water price must be ₦100,000 or less' })
    .refine(twoDecimals, { error: 'Use at most 2 decimal places for the bottled water price' }).optional(),
});

export const auditQuery = z.strictObject({
  limit: z.coerce.number({ error: 'Limit must be a number from 1 to 500' }).int({ error: 'Limit must be a number from 1 to 500' })
    .min(1, { error: 'Limit must be a number from 1 to 500' }).max(500, { error: 'Limit must be a number from 1 to 500' }).optional(),
});
