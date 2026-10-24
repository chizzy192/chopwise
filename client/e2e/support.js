// Shared helpers for the browser smoke tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

// Every test fails on uncaught errors, console errors and server errors. Refusals the app expects
// (401 signed out, 403 onboarding/check-in gates, 409 business rules) are not errors.
export const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url ?? '';
      if (/status of (400|401|403|409|423)/.test(m.text()) && url.includes('/api/')) return;
      problems.push(`console error: ${m.text()} ${url}`);
    });
    page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await use(page);
    expect(problems, 'browser errors on this page').toEqual([]);
  },
});
export { expect };

/**
 * Visible, enabled and actually reachable: the element (or something inside it) is what a click at
 * its centre would hit. Catches controls hidden under other elements or clipped out of view.
 */
export async function expectClickable(locator) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.scrollIntoViewIfNeeded();
  const hit = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const ok = top === el || el.contains(top) || [...(el.labels ?? [])].some((l) => l.contains(top));
    return ok ? 'ok' : `covered by <${top?.tagName.toLowerCase()} class="${top?.className}">`;
  });
  expect(hit, `${locator} must be clickable`).toBe('ok');
}

export const WIDTHS = [320, 390, 1440];

/**
 * A page at 320, 390 and 1440 px, in both themes: no horizontal page scroll, and every control on
 * screen can really be hit (a click at its centre reaches it, not something drawn over it). The
 * page loads once; width and theme change in place, as they would on a real device.
 */
export async function expectFitsWidths(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const where = `${path} at ${width}px, ${theme} theme`;
      const { overflow, covered, wide } = await page.evaluate(() => new Promise((resolve) => {
        window.scrollTo(0, 0);
        // Two frames, so layout and styles for the new width and theme have settled.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const doc = document.documentElement;
          const blocked = [...document.querySelectorAll('button, a[href], input, select, textarea, summary')]
            .filter((el) => {
              if (el.disabled || el.closest('[aria-hidden="true"], [inert]')) return false;
              // Content folded inside a closed <details> isn't on screen (its summary is).
              const folded = el.closest('details:not([open])');
              if (folded && !el.closest('summary')) return false;
              const s = getComputedStyle(el);
              if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
              const r = el.getBoundingClientRect();
              // Only controls fully on screen; visually hidden inputs (1 px) work through their labels.
              if (!(r.width > 2 && r.height > 2 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth)) return false;
              // ...and not scrolled out of view inside a scrolling area (a rail, a board column).
              for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                const o = getComputedStyle(a);
                if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
                const box = a.getBoundingClientRect();
                if (r.top < box.top || r.bottom > box.bottom || r.left < box.left || r.right > box.right) return false;
              }
              return true;
            })
            // A link that wraps onto two lines is tested at the middle of its first line.
            .map((el) => {
              const r = el.getClientRects()[0];
              return { el, top: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) };
            })
            .filter(({ el, top }) => !(top === el || el.contains(top) || [...(el.labels ?? [])].some((l) => l.contains(top))))
            .map(({ el, top }) => {
              return `<${el.tagName.toLowerCase()}> "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" covered by <${top?.tagName.toLowerCase()} class="${top?.className}">`;
            });
          const overflow = doc.scrollWidth - doc.clientWidth;
          // On failure, name the elements that stick out past the right edge (outside scrolling rails).
          const wide = overflow <= 0 ? [] : [...document.querySelectorAll('body *')]
            .filter((el) => {
              if (el.getBoundingClientRect().right <= doc.clientWidth + 0.5) return false;
              for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(a).overflowX)) return false;
              }
              return true;
            })
            .filter((el) => ![...el.children].some((c) => c.getBoundingClientRect().right > doc.clientWidth + 0.5))
            .slice(0, 4)
            .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}"> "${(el.textContent || '').trim().slice(0, 40)}"`);
          resolve({ overflow, covered: blocked, wide });
        }));
      }));
      expect(overflow, `${where}: horizontal scroll from ${wide.join(', ')}`).toBeLessThanOrEqual(0);
      expect(covered, `${where}: controls that can't be clicked`).toEqual([]);
    }
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.setViewportSize({ width: 1440, height: 900 });
}

// Touch targets of at least 44 × 44 px: buttons, fields and nav links; a checkbox, radio or switch
// counts through its label. Links inside running text are excluded, as WCAG allows.
export async function expectTouchTargets(page) {
  const small = await page.evaluate(() => {
    const sel = 'button, a.btn, label.btn, select, input:not([type=checkbox]):not([type=radio]):not([type=file]), .nav a, .index a, label.check, .choice-row label, label.switch';
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.height < 43.5 || r.width < 43.5))
      .map(({ el, r }) => `<${el.tagName.toLowerCase()} class="${el.className}"> "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
  });
  expect(small, 'touch targets smaller than 44 × 44 px').toEqual([]);
}

// The first admin's and the sample caterer's logins come from server/.env, as the app's own setup does.
function envLogin(prefix) {
  const env = fs.readFileSync(new URL('../../server/.env', import.meta.url), 'utf8');
  const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim();
  return { email: get(`${prefix}_EMAIL`), password: get(`${prefix}_PASSWORD`) };
}
export const adminLogin = () => envLogin('ADMIN');
export const catererLogin = () => envLogin('CATERER');

export async function logIn(page, email, password) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Wait until the session cookie is set and the app has moved on to the role's home page.
  await expect(page).not.toHaveURL(/\/login$/);
}

// Requests through the page's own session. Writes send the Origin header the server checks.
const WEB = 'http://localhost:5180';
export const apiPost = (page, url, data) => page.request.post(url, { data, headers: { Origin: WEB } });

// Cart → checkout → mock Paystack → verify, through the API, as a user would.
export async function buy(page, lines) {
  const co = await (await apiPost(page, '/api/orders/checkout', { lines })).json();
  await page.request.get(co.authorizationUrl, { maxRedirects: 0 });
  return (await apiPost(page, '/api/orders/verify', { reference: co.reference })).json();
}

// The UI test server has no SMTP: it writes each reset link to this file instead (scripts/ui-server.js).
export function lastResetLink(email) {
  const lines = fs.readFileSync(path.join(os.tmpdir(), 'chopwise-ui-test-mailbox.txt'), 'utf8').trim().split('\n');
  return lines.filter((l) => l.startsWith(`${email} `)).at(-1)?.split(' ')[1] ?? null;
}

// How many columns a CSS grid actually lays out (a block list counts as one column).
export const gridColumns = (locator) => locator.evaluate((el) => {
  const cols = getComputedStyle(el).gridTemplateColumns;
  return cols === 'none' ? 1 : cols.split(' ').filter(Boolean).length;
});
