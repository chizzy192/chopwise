// Screenshots of every screen for the report: npm run screenshots
// 1440 px wide, light theme, sample data (plus 390 px versions of the landing, login and order
// pages). Each state is set up through the real API, as a user would. Files are numbered in the
// order a reader meets the screens.
import { test, expect } from '@playwright/test';
import { adminLogin, catererLogin, logIn, lastResetLink } from './support.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const OUT = '../docs/screenshots';
const WEB = 'http://localhost:5180';
const newStaff = { name: 'Ngozi Okeke', email: `ngozi.${Date.now()}@unn.edu.ng`, password: 'shot-pass-123' };

const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const post = (page, url, data, method = 'post') => page.request[method](url, { data, headers: { Origin: WEB } });

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

// Cart → checkout → mock Paystack → verify, through the API.
async function buy(page, lines) {
  const co = await (await post(page, '/api/orders/checkout', { lines })).json();
  await page.request.get(co.authorizationUrl, { maxRedirects: 0 });
  return (await post(page, '/api/orders/verify', { reference: co.reference })).json();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chopwise.theme', 'light'));
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('public pages', async ({ page }) => {
  await page.goto('/'); await settle(page); await shot(page, '01-landing');
  // The demo with all three answers "yes": firm guidance, the carb-heavy lunch says "Not today".
  await page.getByRole('switch', { name: /meal before that heavy/ }).click();
  await page.locator('.gate-demo').scrollIntoViewIfNeeded();
  await page.locator('.gate-demo').screenshot({ path: `${OUT}/02-landing-demo.png` });
  await page.goto('/login'); await settle(page); await shot(page, '04-login');
  await page.goto('/register'); await settle(page);
  await page.getByLabel('Password', { exact: true }).fill('long-enough-pass');
  await page.getByLabel('Confirm password', { exact: true }).fill('long-enough-pasX');
  await shot(page, '05-register-confirm-password');
  await page.goto('/forgot-password'); await settle(page); await shot(page, '06-forgot-password');
  await post(page, '/api/auth/forgot-password', { email: 'staff2@chopwise.ng' });
  await page.goto(lastResetLink('staff2@chopwise.ng').replace(/^https?:\/\/[^/]+/, '')); await settle(page);
  await page.getByLabel('New password', { exact: true }).fill('a-new-password-1');
  await shot(page, '07-reset-password');
});

test('new staff member: onboarding, check-in and a gentle-guidance day', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(newStaff.name);
  await page.getByLabel('Email').fill(newStaff.email);
  await page.getByLabel('Password', { exact: true }).fill(newStaff.password);
  await page.getByLabel('Confirm password', { exact: true }).fill(newStaff.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole('radio', { name: 'Yes' }).first().check();
  await page.getByRole('checkbox', { name: 'Hypertension' }).check();
  await settle(page); await shot(page, '08-onboarding');
  await page.getByRole('radio', { name: 'No' }).first().check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: /continue to today's check-in/i }).click();
  await page.locator('#prev1-meal').selectOption({ label: 'Fruit platter' });
  await page.locator('#prev2-meal').selectOption({ label: 'Moi moi and pap' });
  await settle(page); await shot(page, '09-checkin');
  await page.getByRole('button', { name: 'Confirm my last two meals' }).click();
  await expect(page.getByRole('heading', { name: /guidance today/i })).toBeVisible();
  await settle(page); await shot(page, '10-checkin-result');
  await page.goto('/order'); await settle(page); await shot(page, '11-order-gentle');
});

test('staff with a declared condition: firm guidance, carbohydrates past the cut-off', async ({ page }) => {
  await logIn(page, 'staff@chopwise.ng', 'password123');
  // staff@ has 2 delivered orders in the sample data, so the feedback pop-up opens first.
  const feedback = page.getByRole('dialog', { name: 'How is ChopWise working for you?' });
  await expect(feedback).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '22-feedback-popup', false);
  await feedback.getByRole('button', { name: 'Not now' }).click();

  const today = await (await page.request.get('/api/checkin/today')).json();
  await post(page, '/api/checkin', { prev1: { mealId: today.prefill.prev1.id }, prev2: { mealId: today.prefill.prev2.id } });
  const menu = await (await page.request.get('/api/catalogue')).json();
  const id = (prefix) => menu.catalogue.find((m) => m.name.startsWith(prefix))?.id;
  await buy(page, [{ dishId: id('Pounded yam'), quantity: 1 }]);
  // Under firm guidance the lock refuses carb-led meals that would pass 90%, so reach it as T9 does.
  await buy(page, [{ dishId: id('Yam porridge'), quantity: 1 }]);
  await buy(page, [{ dishId: id('Fruit platter'), quantity: 1 }]);
  await page.goto('/order'); await settle(page); await shot(page, '12-order-firm-not-today');
  await page.getByRole('button', { name: /: why\?$/ }).first().click();
  await shot(page, '13-fit-why-popover', false);
  await page.goto(`/dish/${id('Jollof')}`); await settle(page); await shot(page, '14-dish-detail-not-today');
  await page.goto(`/dish/${id('Balanced lunch')}`); await settle(page);
  await page.getByRole('button', { name: /^Add .+ to cart$/ }).click();
  await page.getByRole('button', { name: /^Add one / }).click();
  await page.getByRole('button', { name: /^Cart, / }).click();
  await expect(page.getByRole('dialog', { name: 'Your cart' })).toBeVisible();
  // Wait for the server's cart check and for the sheet to finish sliding in.
  await expect(page.getByRole('button', { name: 'Go to checkout' })).toBeEnabled();
  await page.waitForTimeout(500);
  await shot(page, '15-cart-sheet', false);
  await page.getByRole('button', { name: 'Go to checkout' }).click();
  await settle(page); await shot(page, '16-checkout');
  await page.getByRole('button', { name: /^Pay .+ with Paystack$/ }).click();
  await expect(page.getByRole('heading', { name: /paid/i })).toBeVisible();
  await settle(page); await shot(page, '17-payment-confirmed');
  await page.goto('/orders'); await settle(page); await shot(page, '18-my-orders');
  await page.goto('/intake'); await settle(page); await shot(page, '19-my-intake');
  await page.goto('/health'); await settle(page); await shot(page, '20-health-profile');
  await page.goto('/notifications'); await settle(page); await shot(page, '21-notifications');
});

test('caterer: dishes and photos, stock and sold out, orders', async ({ page }) => {
  await logIn(page, catererLogin().email, catererLogin().password);
  const dishes = await (await page.request.get('/api/caterer/dishes')).json();
  const named = (prefix) => dishes.find((d) => d.name.startsWith(prefix));
  await post(page, `/api/caterer/dishes/${named('Suya').id}/stock`, { platesLeft: 3 }, 'put');
  await post(page, `/api/caterer/dishes/${named('Ofada').id}/availability`, { available: false }, 'patch');
  const yam = named('Yam porridge');
  await post(page, `/api/caterer/dishes/${yam.id}`, {
    name: yam.name, priceKobo: yam.priceKobo, carb: yam.carb, protein: yam.protein, fat: yam.fat, vitamin: 26, mineral: yam.mineral,
  }, 'put');
  await page.goto('/caterer'); await settle(page); await shot(page, '23-caterer-dishes');
  await page.getByRole('button', { name: 'Edit' }).nth(1).click();
  await page.locator('#d-carb').fill('60');
  await settle(page); await shot(page, '24-caterer-edit-dish', false);
  await page.goto('/caterer/stock'); await settle(page); await shot(page, '25-caterer-stock');
  await page.goto('/caterer/orders'); await settle(page);
  await page.getByRole('button', { name: 'Start preparing' }).first().click();
  await page.getByRole('button', { name: 'Send out for delivery' }).first().click();
  await expect(page.getByLabel('Delivery code').first()).toBeVisible();
  await shot(page, '26-caterer-orders');
});

test('admin: approval, users, settings, audit log and report', async ({ page }) => {
  const admin = adminLogin();
  await logIn(page, admin.email, admin.password);
  await page.goto('/admin/meals'); await settle(page); await shot(page, '27-admin-meal-approval');
  await page.goto('/admin/users'); await settle(page); await shot(page, '28-admin-users');
  await page.getByRole('button', { name: /^Reset password for / }).first().click();
  await page.getByLabel('New temporary password').fill('temporary-pass-1');
  await shot(page, '29-admin-reset-caterer-password', false);
  await page.goto('/admin/settings'); await settle(page); await shot(page, '30-admin-settings');
  await page.goto('/admin/audit'); await settle(page); await shot(page, '31-admin-audit-log');
  await page.goto('/admin/report'); await settle(page); await shot(page, '32-admin-report');
});

test('390 px phone versions: landing, login and order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await settle(page); await shot(page, '33-landing-390');
  await page.goto('/login'); await settle(page); await shot(page, '34-login-390');
  await logIn(page, 'staff@chopwise.ng', 'password123');
  await page.goto('/order'); await settle(page); await shot(page, '35-order-390');
});
