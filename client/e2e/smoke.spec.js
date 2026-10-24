// Smoke tests: every page loads for its role, its main controls can really be clicked, touch
// targets are big enough, nothing scrolls sideways, and the browser reports no errors. They run in
// order, because one staff order feeds the caterer's page.
import {
  test, expect, expectClickable, expectTouchTargets, expectFitsWidths, adminLogin, catererLogin, logIn, apiPost, buy, lastResetLink, gridColumns,
} from './support.js';

test.describe.configure({ mode: 'serial' });

const staff = { name: 'UI Test Staff', email: `ui.${Date.now()}@chopwise.ng`, password: 'ui-test-pass-123' };
const DEMO = 'password123';
const newCaterer = { name: 'UI Test Kitchen', email: `kitchen.${Date.now()}@chopwise.ng`, temp: 'temporary-pass-1', reset: 'reset-temp-pass-2', own: 'kitchen-own-pass-1' };
// A valid 1 × 1 PNG; the server re-encodes every upload to WebP.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('landing: explains ChopWise, runs the gate demo, and links to log in and sign up', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lunch delivered to your office, with gentle guidance to keep your day balanced.');
  await expect(page.getByText('Order from the campus caterers and pay online.', { exact: false })).toBeVisible();
  await expectClickable(page.locator('.hero').getByRole('link', { name: 'Create account' }));
  await expectClickable(page.locator('.hero').getByRole('link', { name: 'Log in' }));
  await expect(page.locator('.day-steps li')).toHaveCount(4);
  for (const step of ['Tell us your last two meals', 'We set your guidance level', 'Order with guidance', 'Pay online and receive with your delivery code']) {
    await expect(page.getByRole('heading', { name: step, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Main' }), 'no app navigation on the landing page').toHaveCount(0);
  // The demo, in plain words: yes to the health check and the last two meals locks the carb-heavy meal.
  await expect(page.getByText('Answer three quick questions and see how ChopWise would guide your lunch.')).toBeVisible();
  const h = page.getByRole('switch', { name: /diet-related health condition/ });
  await expectClickable(h);
  for (const q of ['Was your last meal heavy?', 'Was the meal before that heavy?']) await expect(page.getByRole('switch', { name: new RegExp(q.replace('?', '\\?')) })).toBeVisible();
  await expect(page.locator('.gate-verdict')).toContainText('Firm guidance');
  await expect(page.locator('.demo-meal').filter({ hasText: 'Jollof' })).toContainText('Not today');
  await h.click();
  await expect(page.locator('.gate-verdict')).toContainText('Gentle guidance');
  await expect(page.locator('.demo-meal').filter({ hasText: 'Jollof' })).toContainText('Careful');
  await expect(page.locator('.demo-meal').filter({ hasText: 'Balanced lunch' })).toContainText('Balanced');
  await expect(page.locator('.demo-meal').filter({ hasText: 'Pepper soup' })).toContainText('Good for you right now');
  // Plain words only: no technical terms anywhere on the page (tooltips aside).
  const plain = await page.locator('main').evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('.term-tip').forEach((t) => t.remove());
    return copy.textContent;
  });
  expect(plain).not.toMatch(/\bRDI\b|\bG = |\bP1\b|\bP2\b|\bH = |Recommended\b/);
  await expect(page.getByText('How it works in detail'), 'the detail section was removed').toHaveCount(0);
  const why = page.getByRole('button', { name: /Careful for Jollof/ });
  await expectClickable(why);
  // The technical name is in the badge's tooltip.
  // Reach it with the keyboard (Tab), as a keyboard user would; the tooltip is for keyboard focus.
  await why.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(why).toBeFocused();
  await expect(why.locator('.term-tip')).toHaveText('Technical name: Caution');
  await expect(why.locator('.term-tip')).toBeVisible();
  await expect(page.locator('.example-receipt')).toContainText('Yoghurt (1 cup) (extra)');
  await expect(page.locator('.example-receipt')).toContainText('Bottled water (included)');
  await why.click();
  await expect(page.getByText('Guidance, not medical advice.').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.locator('.bands-table tbody tr')).toHaveCount(4);
  for (const role of ['Staff', 'Caterers', 'Admin']) await expect(page.getByRole('heading', { name: role, exact: true })).toBeVisible();
  await expect(page.locator('.example-receipt')).toContainText('VAT');
  await expect(page.locator('.example-receipt')).toContainText('Delivery fee');
  await expect(page.getByText('A final-year project, Department of Computer Science, University of Nigeria, Nsukka.')).toBeVisible();
  await expectClickable(page.getByRole('link', { name: 'Create account' }).first());
  await expectClickable(page.getByRole('link', { name: 'Log in' }).first());
  await expectTouchTargets(page);
});

test('login and register pages, with visible keyboard focus', async ({ page }) => {
  await page.goto('/login');
  for (const label of ['Email', 'Password']) await expectClickable(page.getByLabel(label, { exact: true }));
  await expectClickable(page.getByRole('button', { name: 'Log in' }));
  await page.getByLabel('Email').focus();
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(ring, 'focused control shows a focus ring').not.toBe('none');
  await expectClickable(page.getByRole('link', { name: 'Forgot password?' }));
  await expectTouchTargets(page);
  await page.goto('/register');
  for (const label of ['Full name', 'Email', 'Password', 'Confirm password']) await expectClickable(page.getByLabel(label, { exact: true }));
  await expectClickable(page.getByRole('button', { name: 'Create account' }));
  // "Passwords don't match" appears as soon as they differ, and the form can't be sent.
  await page.getByLabel('Password', { exact: true }).fill('long-enough-pass');
  await page.getByLabel('Confirm password', { exact: true }).fill('long-enough-pasX');
  await expect(page.getByText("Passwords don't match")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await page.getByLabel('Confirm password', { exact: true }).fill('long-enough-pass');
  await expect(page.getByText("Passwords don't match")).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
});

test('login and register are responsive from 320 px to 1440 px, in both themes', async ({ page }) => {
  test.setTimeout(120_000);
  for (const path of ['/login', '/register', '/forgot-password']) {
    for (const theme of ['light', 'dark']) {
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.addInitScript((t) => localStorage.setItem('chopwise.theme', t), theme);
        await page.goto(path);
        const where = `${path} at ${width}px, ${theme} theme`;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${where}: horizontal scroll`).toBeLessThanOrEqual(0);
        // Inputs at 16 px or more, so iPhones don't zoom in on focus.
        const fonts = await page.locator('input').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
        for (const size of fonts) expect(size, `${where}: input font size`).toBeGreaterThanOrEqual(16);
        // The form is one centred column on phones and keeps a comfortable width on large screens.
        const form = await page.locator('.auth-form').boundingBox();
        expect(form.width, `${where}: form width`).toBeLessThanOrEqual(448);
        if (width < 861) expect(Math.abs(form.x + form.width / 2 - width / 2), `${where}: form centred`).toBeLessThanOrEqual(2);
        await expectTouchTargets(page);
        if (path !== '/forgot-password') await expectClickable(page.getByLabel('Password', { exact: true }));
      }
    }
  }
  // The show/hide switch reveals the password and hides it again.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/login');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('secret-pass-1');
  await expectClickable(page.getByRole('button', { name: 'Show password' }));
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('staff: sign up and health onboarding', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(staff.name);
  await page.getByLabel('Email').fill(staff.email);
  await page.getByLabel('Password', { exact: true }).fill(staff.password);
  await page.getByLabel('Confirm password', { exact: true }).fill(staff.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const yes = page.getByRole('radio', { name: 'Yes' }).first();
  const no = page.getByRole('radio', { name: 'No' }).first();
  await expectClickable(yes);
  await yes.check();
  await expectClickable(page.getByRole('checkbox', { name: 'Hypertension' }));
  await expectTouchTargets(page);
  await no.check();
  await expectClickable(page.getByRole('button', { name: 'Save and continue' }));
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText(/^Health check: no\./)).toBeVisible();
  await page.getByRole('button', { name: /continue to today's check-in/i }).click();
  await expect(page).toHaveURL(/\/checkin$/);
});

test('staff: daily check-in', async ({ page }) => {
  await logIn(page, staff.email, staff.password);
  await expect(page).toHaveURL(/\/checkin$/);
  for (const id of ['#prev1-meal', '#prev2-meal']) {
    const select = page.locator(id);
    await expectClickable(select);
    await select.selectOption({ index: 1 });
  }
  await expectClickable(page.getByRole('checkbox', { name: 'I ate something not on ChopWise' }).first());
  await expectTouchTargets(page);
  await page.getByRole('button', { name: 'Confirm my last two meals' }).click();
  await expect(page.getByRole('heading', { name: /guidance today/i })).toBeVisible();
  await expectClickable(page.getByRole('button', { name: 'Continue to order' }));
  await expectClickable(page.getByRole('button', { name: 'Change my check-in' }));
});

test('staff: order page, dish detail, cart sheet, checkout and payment', async ({ page }) => {
  await logIn(page, staff.email, staff.password);
  await expect(page).toHaveURL(/\/order$/);
  await page.goto('/');
  await expect(page, 'a signed-in visitor to / goes to their home page').toHaveURL(/\/order$/);
  await expect(page.locator('.guidance-strip')).toContainText(/guidance today/);
  // Folded into one line by default; opening it shows the five food classes.
  const strip = page.locator('.guidance-strip');
  await expect(strip.getByRole('meter').first()).toBeHidden();
  await expectClickable(strip.locator('summary'));
  await strip.locator('summary').click();
  await expect(strip.getByRole('meter').first()).toBeVisible();
  await strip.locator('summary').click();
  // Extras: yoghurt (with a Fit signal) and extra bottled water (no nutrition values).
  await expect(page.locator('#extras')).toContainText('Yoghurt (1 cup)');
  await expect(page.locator('#extras')).toContainText('Extra bottled water');
  await expect(page.locator('#extras .row').filter({ hasText: 'Yoghurt' }).getByRole('button', { name: /^Balanced: why\?$|: why\?$/ })).toBeVisible();
  await expect(page.locator('.cover-name').first()).toHaveText('Campus Kitchen');
  await expectClickable(page.locator('.index a').first());
  const fit = page.getByRole('button', { name: /: why\?$/ }).first();
  await expectClickable(fit);
  await fit.click();
  await expect(page.locator('.popover').first()).toContainText('Guidance, not medical advice.');
  await page.keyboard.press('Escape');
  await expectTouchTargets(page);

  const dishLink = page.locator('.rows .dish-name').first();
  const dishName = await dishLink.textContent();
  await dishLink.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(dishName);
  await expect(page.getByRole('heading', { name: 'One serving' })).toBeVisible();
  const add = page.getByRole('button', { name: `Add ${dishName} to cart` });
  await expectClickable(add);
  await add.click();
  await expectClickable(page.getByRole('button', { name: `Add one ${dishName}` }));

  const cart = page.getByRole('button', { name: /^Cart, 1 item/ });
  await expectClickable(cart);
  await cart.click();
  const sheet = page.getByRole('dialog', { name: 'Your cart' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('1 × Bottled water (included) ₦0')).toBeVisible();
  const toCheckout = sheet.getByRole('button', { name: 'Go to checkout' });
  await expectClickable(toCheckout);
  await expectClickable(sheet.getByRole('button', { name: 'Close' }));
  await toCheckout.click();
  await expect(page).toHaveURL(/\/checkout$/);
  const pay = page.getByRole('button', { name: /^Pay .+ with Paystack$/ });
  await expectClickable(pay);
  await expectTouchTargets(page);
  await expect(page.locator('tr.included')).toContainText('Bottled water (included)');
  await pay.click(); // mock Paystack completes the payment and sends the browser back
  await expect(page.getByRole('heading', { name: /paid/i })).toBeVisible();
  await expect(page.locator('.delivery-code')).toHaveText(/^\d{4}$/);
});

test('staff: My orders, My intake, Health profile and Notifications', async ({ page }) => {
  await logIn(page, staff.email, staff.password);
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();
  await expect(page.locator('.delivery-code').first()).toHaveText(/^\d{4}$/);
  await page.goto('/intake');
  await expect(page.getByRole('heading', { name: "Today's intake", exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: "What today's intake is made of" })).toBeVisible();
  await expect(page.getByRole('meter').first()).toBeVisible();
  await page.goto('/health');
  await expectClickable(page.getByRole('button', { name: 'Save health profile' }));
  await expectTouchTargets(page);
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
});

test('staff: the menu and My orders are grids at 1440 px and one column at 390 px', async ({ page }) => {
  await logIn(page, staff.email, staff.password);
  await page.goto('/order');
  const menu = page.locator('#for-you .rows');
  await expect(menu).toBeVisible();
  expect(await gridColumns(menu), 'menu at 1440 px').toBeGreaterThan(1);
  // Cards in a row share one height, and their controls line up along the bottom.
  const cards = menu.locator('.row');
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(Math.abs(a.y - b.y), 'first two cards share a row').toBeLessThan(1);
  expect(Math.abs(a.height - b.height), 'same height').toBeLessThan(1);
  const [ea, eb] = [await cards.nth(0).locator('.row-end').boundingBox(), await cards.nth(1).locator('.row-end').boundingBox()];
  expect(Math.abs(ea.y + ea.height - (eb.y + eb.height)), 'controls aligned at the bottom').toBeLessThan(1.5);
  await page.goto('/orders');
  const orders = page.locator('.order-list');
  await expect(orders.locator('.order-card').first()).toBeVisible();
  expect(await gridColumns(orders), 'My orders at 1440 px').toBeGreaterThan(1);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await gridColumns(orders), 'My orders at 390 px').toBe(1);
  await page.goto('/order');
  await expect(menu).toBeVisible();
  expect(await gridColumns(menu), 'menu at 390 px').toBe(1);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('staff on a phone: only the logo, cart and Menu in the bar; the Menu holds the rest', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await logIn(page, staff.email, staff.password);
  await page.goto('/order');
  const bar = page.locator('.topbar');
  await expect(bar.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(bar.getByRole('button', { name: 'Log out' })).toBeHidden();
  await expectClickable(bar.getByRole('link', { name: /^Chop\s*Wise$/ }));
  await expectClickable(bar.getByRole('button', { name: /^Cart, / }));
  const menu = bar.getByRole('button', { name: 'Menu' });
  await expectClickable(menu);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  const panel = bar.getByRole('navigation', { name: 'Menu' });
  await expect(panel).toBeVisible();
  // It slides in from the right (and back out to the right when it closes).
  expect(await bar.locator('#app-menu').evaluate((el) => getComputedStyle(el).animationName)).toBe('menu-in');
  for (const label of ['Order', 'My orders', "Today's check-in", 'My intake', 'Health profile', 'Notifications']) {
    await expect(panel.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await expectClickable(bar.locator('#app-menu').getByRole('button', { name: 'Log out' }));
  await expectTouchTargets(page);
  // Escape closes it and returns focus to the Menu button; choosing a page closes it too.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await panel.getByRole('link', { name: 'My intake' }).click();
  await expect(page).toHaveURL(/\/intake$/);
  await expect(panel).toBeHidden();
  // Dish photos fill the card on phones (4:3, full card width).
  await page.goto('/order');
  const photo = page.locator('#for-you .row .dish-photo').first();
  const box = await photo.boundingBox();
  expect(box.width, 'photo fills the card').toBeGreaterThan(300);
  expect(Math.abs(box.width / box.height - 4 / 3)).toBeLessThan(0.02);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('staff: feedback pop-up after the 2nd delivered order; "Not now" postpones it', async ({ page }) => {
  // staff@ has 2 delivered orders in the demo history and hasn't given feedback.
  await logIn(page, 'staff@chopwise.ng', DEMO);
  const dialog = page.getByRole('dialog', { name: 'How is ChopWise working for you?' });
  await expect(dialog).toBeVisible();
  for (const q of ['How easy was ordering?', 'How helpful was the meal guidance?', 'Did the guidance change what you ordered?']) {
    await expect(dialog.getByRole('group', { name: new RegExp(`^${q.replace('?', '\\?')}`) })).toBeVisible();
  }
  await expect(dialog.getByLabel(/What should we improve/)).toHaveAttribute('maxlength', '500');
  await expectClickable(dialog.getByRole('button', { name: 'Send feedback' }));
  await expectTouchTargets(page);
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toHaveCount(0);
  // Postponed until another order is delivered: not shown again on the next visit.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(dialog).toHaveCount(0);
});

test('staff pages use plain words, with the technical term in a tooltip', async ({ page }) => {
  await logIn(page, 'staff@chopwise.ng', DEMO);
  await page.goto('/intake');
  const term = page.locator('.term').filter({ hasText: 'daily limit' }).first();
  await expect(term).toBeVisible();
  await term.focus();
  await expect(term.locator('.term-tip')).toHaveText('RDI: recommended daily intake');
  await expect(page.locator('main')).not.toContainText('(RDI)');
});

test('staff under full guidance: a restricted meal can never be added', async ({ page }) => {
  // staff@ has declared hypertension (H = 1); the pre-filled meals give P2 = 1, so G = 1.
  await logIn(page, 'staff@chopwise.ng', DEMO);
  const today = await (await page.request.get('/api/checkin/today')).json();
  await apiPost(page, '/api/checkin', { prev1: { mealId: today.prefill.prev1.id }, prev2: { mealId: today.prefill.prev2.id } });
  expect((await (await page.request.get('/api/checkin/today')).json()).checkin.g).toBe(1);
  await page.goto('/checkin');
  await expect(page.getByRole('heading', { name: 'Firm guidance today' })).toBeVisible();
  await expect(page.locator('.gate-out')).toContainText('Firm');
  const menu = await (await page.request.get('/api/catalogue')).json();
  const dish = (prefix) => menu.catalogue.find((m) => m.name.startsWith(prefix));
  await buy(page, [{ dishId: dish('Eba').id, quantity: 1 }]); // carbohydrates now 50%

  // One serving of Jollof (48% carbohydrates) would end at 98%: "Not today" (Restricted today), Add disabled.
  await page.goto('/order');
  const jollof = dish('Jollof');
  const locked = page.getByRole('button', { name: `${jollof.name}: Not today` });
  await expect(locked).toBeVisible();
  await expect(locked).toBeDisabled();
  const looks = await locked.evaluate((el) => {
    const s = getComputedStyle(el);
    const add = document.querySelector('.add-idle');
    return { border: s.borderStyle, bg: s.backgroundColor, addBg: add ? getComputedStyle(add).backgroundColor : null };
  });
  expect(looks.border, '"Not today" has a dashed outline').toBe('dashed');
  expect(looks.bg, '"Not today" is not filled like the Add button').not.toBe(looks.addBg);
  await expect(page.getByRole('button', { name: `Add ${jollof.name} to cart` })).toHaveCount(0);
  // On desktop cards the alternatives are one link away ("See alternatives"); phones list them inline.
  const seeAlternatives = page.locator('#restricted .row').filter({ hasText: jollof.name }).getByRole('link', { name: 'See alternatives' });
  await expectClickable(seeAlternatives);
  await expect(seeAlternatives).toHaveAttribute('href', `/dish/${jollof.id}`);
  await page.locator('#restricted').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/.results/restricted-order.png' });

  // The dish page shows the same lock, and every suggested alternative can be added.
  await page.goto(`/dish/${jollof.id}`);
  await expect(page.getByRole('button', { name: `${jollof.name}: Not today` })).toBeDisabled();
  const alternative = page.locator('.alt-list a').first();
  await alternative.click();
  await expectClickable(page.getByRole('button', { name: /^Add .+ to cart$/ }));

  // The server refuses it too, at cart evaluation and at checkout.
  const lines = [{ dishId: jollof.id, quantity: 1 }];
  expect((await apiPost(page, '/api/cart/evaluate', { lines })).status()).toBe(409);
  expect((await apiPost(page, '/api/orders/checkout', { lines })).status()).toBe(409);

  // Restricted inside the cart: Fruit platter fits alone (vitamins 14% → 52%), but two balanced
  // salads on top take vitamins past 90%. Its line is locked and checkout is blocked.
  await page.goto('/order');
  const platter = dish('Fruit platter');
  const salad = dish('Vegetable salad');
  await page.getByRole('button', { name: `Add ${platter.name} to cart` }).click();
  await page.getByRole('button', { name: `Add ${salad.name} to cart` }).click();
  await page.getByRole('button', { name: `Add one ${salad.name}` }).click();
  await page.getByRole('button', { name: /^Cart, 3 items/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Your cart' });
  await expect(sheet.getByText('Not today: reduce or remove')).toBeVisible();
  await expect(sheet.getByRole('button', { name: `Add one ${platter.name}` })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Go to checkout' })).toBeDisabled();
  await expect(sheet.getByRole('alert').first()).toContainText(`${platter.name} is restricted today`);
  await sheet.getByRole('button', { name: `Remove one ${salad.name}` }).click();
  await expect(sheet.getByRole('button', { name: 'Go to checkout' })).toBeEnabled();
  await sheet.getByRole('button', { name: 'Empty cart' }).click();
});

test('caterer: orders, dishes, stock and sold out', async ({ page }) => {
  await logIn(page, catererLogin().email, catererLogin().password);
  await expect(page).toHaveURL(/\/caterer$/);
  await page.goto('/');
  await expect(page, 'a signed-in caterer opening / goes to their home').toHaveURL(/\/caterer$/);
  await page.goto('/caterer/orders');
  await expect(page.getByText(staff.name).first()).toBeVisible();
  // A board: one column per status at 1440 px, stacked into one column at 390 px.
  const board = page.locator('.board');
  for (const col of ['Paid', 'Preparing', 'Out for delivery', 'Delivered today']) await expect(board.getByRole('heading', { name: new RegExp(`^${col}`) })).toBeVisible();
  expect(await gridColumns(board), 'board at 1440 px').toBeGreaterThan(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await gridColumns(board), 'board at 390 px').toBe(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  const prepare = page.getByRole('button', { name: 'Start preparing' }).first();
  await expectClickable(prepare);
  await prepare.click();
  await expectClickable(page.getByRole('button', { name: 'Send out for delivery' }).first());
  await expectTouchTargets(page);

  await page.goto('/caterer');
  await expectClickable(page.getByRole('button', { name: 'Add dish' }));
  const stock = page.getByLabel('Plates left today').first();
  await expectClickable(stock);
  await stock.fill('7');
  const save = page.getByRole('button', { name: 'Save' }).first();
  await expectClickable(save);
  await save.click();
  await expect(page.getByText(/7 plates left today/)).toBeVisible();
  await expectClickable(page.getByRole('switch').first());
  await expectClickable(page.getByRole('button', { name: 'Edit' }).first());
  await expectTouchTargets(page);
  await page.getByRole('button', { name: 'Add dish' }).click();
  await expectClickable(page.getByLabel('Name'));
  await expectClickable(page.getByRole('button', { name: 'Save dish' }));
});

test('caterer: upload a dish photo and set today\'s plates, both found in the navigation', async ({ page }) => {
  await logIn(page, catererLogin().email, catererLogin().password);
  const nav = page.getByRole('navigation', { name: 'Main' });
  // Photos: on My dishes, each dish row has its own upload button.
  await nav.getByRole('link', { name: 'My dishes and photos' }).click();
  await expect(page).toHaveURL(/\/caterer$/);
  const row = page.locator('.dish-row').filter({ hasText: 'Moi moi (1 wrap)' });
  await expectClickable(row.locator('label.file-button'));
  await expect(row.locator('img')).toHaveCount(0);
  await row.getByLabel('Upload photo for Moi moi (1 wrap)').setInputFiles({ name: 'moimoi.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Moi moi (1 wrap): photo saved.')).toBeVisible();
  await expect(row.locator('img')).toHaveAttribute('src', /\/uploads\/dishes\/[0-9a-f-]+\.webp$/);
  await expect(row.getByText('Change photo')).toBeVisible();
  await expectTouchTargets(page);

  // Stock: Today's stock lists every dish with its plates-left field.
  await nav.getByRole('link', { name: "Today's stock" }).click();
  await expect(page).toHaveURL(/\/caterer\/stock$/);
  await expect(page.getByRole('heading', { name: "Today's stock", level: 1 })).toBeVisible();
  for (const section of ['Meals', 'Extras', 'Add-ons']) await expect(page.getByRole('heading', { name: section, level: 2 })).toBeVisible();
  const okpa = page.locator('.stock-row').filter({ hasText: 'Okpa (1 wrap)' });
  const plates = okpa.getByLabel('Plates left today');
  await expectClickable(plates);
  await plates.fill('4');
  await okpa.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Okpa (1 wrap): 4 plates left today.')).toBeVisible();
  await expect(okpa.getByText('Only 4 left')).toBeVisible();
  await expectTouchTargets(page);
});

test('admin: meal approval, users, settings, audit log and report', async ({ page }) => {
  const admin = adminLogin();
  await logIn(page, admin.email, admin.password);
  await expect(page).toHaveURL(/\/admin\/meals$/);
  await page.goto('/');
  await expect(page, 'a signed-in admin opening / goes to their home').toHaveURL(/\/admin\/meals$/);
  await expectClickable(page.getByRole('button', { name: 'Unapprove' }).first());
  await expectTouchTargets(page);
  await page.goto('/admin/users');
  await expectClickable(page.getByLabel('Search by name or email'));
  await expectClickable(page.getByRole('combobox', { name: /^Role for / }).first());
  // Changing a role asks first, in a pop-up; ✕ (top right) and Escape cancel and keep the role.
  const role = page.getByRole('combobox', { name: /^Role for Mr\. Emeka Obi/ });
  await role.selectOption('caterer');
  const ask = page.getByRole('alertdialog', { name: /^Make Mr\. Emeka Obi a caterer\?/ });
  await expect(ask).toBeVisible();
  const close = ask.getByRole('button', { name: 'Close, keep the current role' });
  await expectClickable(close);
  await expectTouchTargets(page);
  await close.click();
  await expect(ask).toBeHidden();
  await expect(role).toHaveValue('staff');
  await expect(role).toBeFocused();
  await role.selectOption('admin');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(role).toHaveValue('staff');
  await expectTouchTargets(page);
  // A caterer account with a temporary password, then a password reset; both audited.
  await page.getByLabel('Business or caterer name').fill(newCaterer.name);
  await page.getByLabel('Email', { exact: true }).fill(newCaterer.email);
  await page.getByLabel('Temporary password', { exact: true }).fill(newCaterer.temp);
  await page.getByRole('button', { name: 'Create caterer account' }).click();
  await expect(page.getByText(`Caterer account created for ${newCaterer.email}`)).toBeVisible();
  await page.getByLabel('Search by name or email').fill(newCaterer.email);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Temporary password/ })).toBeVisible();
  const reset = page.getByRole('button', { name: `Reset password for ${newCaterer.name}` });
  await expectClickable(reset);
  await reset.click();
  await page.getByLabel('New temporary password').fill(newCaterer.reset);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText(`${newCaterer.name}'s password is reset.`)).toBeVisible();
  await page.goto('/admin/audit');
  await expect(page.getByText(/user\.password_reset|Password reset/i).first()).toBeVisible();
  await page.goto('/admin/settings');
  await expectClickable(page.getByLabel('VAT rate (%)'));
  await expectClickable(page.getByLabel('Delivery fee (₦)'));
  await expectClickable(page.getByRole('button', { name: 'Save settings' }));
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await page.goto('/admin/report');
  await expect(page.getByText('Revenue today')).toBeVisible();
  const fb = page.locator('.feedback-summary');
  await expect(fb.getByRole('heading', { name: 'Staff feedback' })).toBeVisible();
  await expect(fb).toContainText('Responses');
  await expect(fb).toContainText('Sometimes');
  await expect(fb).toContainText('Sample response (demo data)');
  await expect(fb).toContainText('Visible to admins only.');
});

test('a caterer with a temporary password must change it at first login', async ({ page }) => {
  await logIn(page, newCaterer.email, newCaterer.reset);
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto('/caterer');
  await expect(page, 'every other page sends them back').toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
  await expectTouchTargets(page);
  await page.getByLabel('Temporary password', { exact: true }).fill(newCaterer.reset);
  await page.getByLabel('New password', { exact: true }).fill(newCaterer.own);
  await page.getByLabel('Confirm new password', { exact: true }).fill(newCaterer.own);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/caterer$/);
  await expect(page.getByRole('heading', { name: 'My dishes' })).toBeVisible();
});

test('forgot password: same message for any email; the link works once and signs out other sessions', async ({ page, browser }) => {
  const email = 'staff2@chopwise.ng';
  const newPassword = 'staff2-reset-pass-1';
  // A session that is open before the reset.
  await logIn(page, email, DEMO);
  await expect(page).not.toHaveURL(/\/login$/);

  const other = await browser.newContext({ baseURL: 'http://localhost:5180' });
  const tab = await other.newPage();
  const message = "If an account exists for that email, we've sent a reset link.";
  for (const address of ['nobody.at.all@chopwise.ng', email]) {
    await tab.goto('/login');
    await tab.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(tab).toHaveURL(/\/forgot-password$/);
    await tab.getByLabel('Email').fill(address);
    await tab.getByRole('button', { name: 'Send reset link' }).click();
    await expect(tab.getByText(message)).toBeVisible();
  }
  const link = lastResetLink(email);
  expect(link, 'a reset link was "emailed"').toMatch(/\/reset-password\?token=[0-9a-f]{64}$/);
  expect(lastResetLink('nobody.at.all@chopwise.ng'), 'no link for an unknown email').toBeNull();

  await tab.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await tab.getByLabel('New password', { exact: true }).fill(newPassword);
  await tab.getByLabel('Confirm password', { exact: true }).fill(`${newPassword}x`);
  await expect(tab.getByText("Passwords don't match")).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Save new password' })).toBeDisabled();
  await tab.getByLabel('Confirm password', { exact: true }).fill(newPassword);
  await tab.getByRole('button', { name: 'Save new password' }).click();
  await expect(tab.getByText(/Your password has been reset/)).toBeVisible();
  await expectTouchTargets(tab);

  // The same link a second time is refused.
  await tab.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await tab.getByLabel('New password', { exact: true }).fill('another-pass-123');
  await tab.getByLabel('Confirm password', { exact: true }).fill('another-pass-123');
  await tab.getByRole('button', { name: 'Save new password' }).click();
  await expect(tab.getByText(/invalid, already used or expired/)).toBeVisible();
  await other.close();

  // The session opened before the reset is signed out.
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, email, newPassword);
  await expect(page).not.toHaveURL(/\/login$/);
});

// Every page at 320, 390 and 1440 px in both themes: no sideways scroll, every control on screen
// clickable (split in three so a
// slow machine stays inside each test's time budget).
test('public pages fit 320, 390 and 1440 px in both themes, every control on screen clickable', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  for (const path of ['/', '/login', '/register', '/forgot-password', `/reset-password?token=${'a'.repeat(64)}`]) await expectFitsWidths(page, path);
});

test('staff pages fit 320, 390 and 1440 px in both themes, every control on screen clickable', async ({ page }) => {
  test.setTimeout(400_000);
  await logIn(page, staff.email, staff.password);
  for (const path of ['/order', '/checkin', '/checkout', '/orders', '/intake', '/health', '/notifications']) await expectFitsWidths(page, path);
  const dishId = await page.evaluate(async () => (await (await fetch('/api/catalogue')).json()).catalogue[0].id);
  await expectFitsWidths(page, `/dish/${dishId}`);
});

test('caterer and admin pages fit 320, 390 and 1440 px in both themes, every control on screen clickable', async ({ page }) => {
  test.setTimeout(400_000);
  await logIn(page, catererLogin().email, catererLogin().password);
  for (const path of ['/caterer', '/caterer/orders', '/caterer/stock']) await expectFitsWidths(page, path);
  await page.context().clearCookies();
  const admin = adminLogin();
  await logIn(page, admin.email, admin.password);
  for (const path of ['/admin/meals', '/admin/users', '/admin/settings', '/admin/audit', '/admin/report']) await expectFitsWidths(page, path);
});
