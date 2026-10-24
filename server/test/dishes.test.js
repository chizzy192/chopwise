// Caterer dish library: rules, request schemas and photo uploads (no database).
// Ownership, hiding re-submitted meals and blocking sold-out orders run against the real
// database in scripts/system-scenarios.js (T37–T44).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  changedClasses, needsReapproval, isSoldOut, dishStatus, splitMenu, rdiOf, hasRdi,
} from '../src/logic/dish.js';
import { evaluate, emptyIntake } from '../src/logic/engine.js';
import { todayInLagos } from '../src/logic/time.js';
import { dishCreateBody, dishEditBody, rdiProblem } from '../src/http/schemas.js';
import { saveDishPhoto, deleteDishPhoto, PHOTO_NAME, MAX_WIDTH } from '../src/services/photos.js';

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-the-config-check';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
const { createApp } = await import('../src/app.js');
const { signSession, SESSION_COOKIE } = await import('../src/auth.js');

const rdi = { carb: 30, protein: 28, fat: 14, vitamin: 22, mineral: 15 };
const meal = (over = {}) => ({ id: 1, type: 'meal', isApproved: true, soldOutOn: null, ...rdi, dominantClass: 'carb', isBalanced: true, ...over });

// ---------- Re-approval ----------
test('editing any RDI value on an approved meal sends it back for approval', () => {
  assert.deepEqual(changedClasses(rdi, { ...rdi, fat: 20 }), ['fat']);
  assert.equal(needsReapproval({ type: 'meal', isApproved: true, before: rdi, after: { ...rdi, fat: 20 } }), true);
  assert.equal(dishStatus({ type: 'meal', isApproved: false, approvedValues: rdi }), 'Awaiting re-approval');
});

test('editing only the name, description, price or photo needs no re-approval', () => {
  // These fields are not RDI values, so the before and after RDI are the same.
  assert.equal(needsReapproval({ type: 'meal', isApproved: true, before: rdi, after: { ...rdi } }), false);
  assert.deepEqual(changedClasses(rdi, rdiOf({ ...rdi, name: 'New name', priceKobo: 1, photo: 'x' })), []);
  assert.equal(changedClasses(rdi, { ...rdi, carb: '30.00' }).length, 0, 'the same value read back from the database is not a change');
});

test('a meal still awaiting its first approval is not re-submitted, and add-ons never are', () => {
  assert.equal(needsReapproval({ type: 'meal', isApproved: false, before: rdi, after: { ...rdi, fat: 20 } }), false);
  assert.equal(needsReapproval({ type: 'addon', isApproved: true, before: null, after: null }), false);
  assert.equal(dishStatus({ type: 'meal', isApproved: false, approvedValues: null }), 'Awaiting approval');
  assert.equal(dishStatus({ type: 'addon', isApproved: true }), 'No approval needed');
});

test('changed classes are empty for a meal that has never been approved', () => {
  assert.deepEqual(changedClasses(null, rdi), []);
});

// ---------- Request schemas ----------
const validMeal = { type: 'meal', name: 'Beans porridge', priceKobo: 150000, ...rdi };

test('the client cannot send dominant_class, is_balanced or the approval flag', () => {
  for (const field of ['dominant_class', 'dominantClass', 'is_balanced', 'isBalanced', 'isApproved', 'caterer_id']) {
    const r = dishCreateBody.safeParse({ ...validMeal, [field]: true });
    assert.equal(r.success, false, field);
    assert.equal(r.error.issues[0].code, 'unrecognized_keys', field);
  }
  assert.equal(dishEditBody.safeParse({ name: 'x', priceKobo: 100, ...rdi, type: 'addon' }).success, false, 'type cannot change');
});

test('meals need all five RDI values; add-ons must have none', () => {
  assert.equal(dishCreateBody.safeParse(validMeal).success, true);
  const missing = dishCreateBody.safeParse({ ...validMeal, mineral: undefined });
  assert.equal(missing.error.issues[0].message, 'Enter minerals as a % of daily RDI');
  const addon = dishCreateBody.safeParse({ type: 'addon', name: 'Bottled water', priceKobo: 30000, carb: 0 });
  assert.match(addon.error.issues[0].message, /Add-ons don't have RDI values/);
  assert.equal(dishCreateBody.safeParse({ type: 'addon', name: 'Bottled water', priceKobo: 30000 }).success, true);
  assert.equal(rdiProblem('addon', { name: 'x' }), null);
});

test('prices are whole kobo between ₦1 and ₦100,000; descriptions are at most 200 characters', () => {
  assert.equal(dishCreateBody.safeParse({ ...validMeal, priceKobo: 1500.5 }).error.issues[0].message, 'Enter the price in whole kobo');
  assert.equal(dishCreateBody.safeParse({ ...validMeal, priceKobo: 99 }).error.issues[0].message, 'The price must be at least ₦1');
  assert.equal(dishCreateBody.safeParse({ ...validMeal, priceKobo: 10_000_001 }).success, false);
  assert.equal(dishCreateBody.safeParse({ ...validMeal, description: 'x'.repeat(201) }).success, false);
  assert.equal(dishCreateBody.parse({ ...validMeal, description: '   ' }).description, null, 'a blank description is stored as none');
});

// ---------- Add-ons and sold out on the staff menu ----------
test('add-ons have no RDI values and never reach the engine, so they carry no Fit', () => {
  const water = { id: 9, type: 'addon', isApproved: true, soldOutOn: null, carb: null, dominantClass: null, isBalanced: null };
  const { available, soldOut } = splitMenu([meal(), water], '2026-10-24');
  assert.deepEqual(available.map((d) => d.id), [1]);
  assert.deepEqual(soldOut, []);
  const r = evaluate({ gate: 1, intake: emptyIntake(), meals: available });
  assert.ok(r.catalogue.every((d) => d.type === 'meal' && d.fit));
});

test('unapproved meals are hidden from staff', () => {
  const { available, soldOut } = splitMenu([meal({ id: 2, isApproved: false })], '2026-10-24');
  assert.equal(available.length + soldOut.length, 0);
});

test('a sold-out meal is listed apart, never offered by the engine, so it cannot be ordered or suggested', () => {
  const today = '2026-10-24';
  const { available, soldOut } = splitMenu([meal({ id: 1 }), meal({ id: 2, soldOutOn: today })], today);
  assert.deepEqual(available.map((d) => d.id), [1]);
  assert.deepEqual(soldOut.map((d) => d.id), [2]);
  const r = evaluate({ gate: 1, intake: emptyIntake(), meals: available });
  assert.ok(!r.catalogue.some((d) => d.id === 2));
});

test('sold out resets at the Lagos midnight', () => {
  const markedOn = todayInLagos(new Date('2026-10-24T22:59:00Z')); // 23:59 in Lagos
  assert.equal(markedOn, '2026-10-24');
  assert.equal(isSoldOut(markedOn, todayInLagos(new Date('2026-10-24T22:59:30Z'))), true);
  assert.equal(isSoldOut(markedOn, todayInLagos(new Date('2026-10-24T23:00:00Z'))), false, '00:00 in Lagos: available again');
  assert.equal(isSoldOut(null, '2026-10-24'), false);
});

// ---------- Photo storage ----------
let dir;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chopwise-photos-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

// sharp caches open files, which Windows then refuses to delete; read stored files as buffers.
sharp.cache(false);
const metaOf = async (file) => sharp(await fs.readFile(file)).metadata();
const png = (width, height) => sharp({ create: { width, height, channels: 3, background: '#b5651d' } }).png().toBuffer();

test('photos are saved as WebP under a generated name, at most 1200 px wide, with metadata stripped', async () => {
  // A JPEG carrying EXIF data, as a phone photo would (camera make, GPS, etc.).
  const phone = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#556b2f' } })
    .withExif({ IFD0: { Make: 'PhoneCo', Copyright: 'secret location' } }).jpeg().toBuffer();
  assert.ok((await sharp(phone).metadata()).exif, 'the test input really has EXIF');
  const name = await saveDishPhoto(phone, dir);
  assert.match(name, PHOTO_NAME);
  const stored = await fs.readFile(path.join(dir, name));
  const meta = await metaOf(path.join(dir, name));
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, MAX_WIDTH);
  assert.equal(meta.exif, undefined, 'EXIF removed');
  assert.ok(!stored.includes(Buffer.from('secret location')));
});

test('small photos are not enlarged, and each upload gets a new name', async () => {
  const input = await png(400, 300);
  const [a, b] = [await saveDishPhoto(input, dir), await saveDishPhoto(input, dir)];
  assert.notEqual(a, b);
  assert.equal((await metaOf(path.join(dir, a))).width, 400);
});

test('replacing a photo deletes the old file; names that are not ours are never touched', async () => {
  const name = await saveDishPhoto(await png(50, 50), dir);
  await deleteDishPhoto(name, dir);
  await assert.rejects(fs.access(path.join(dir, name)));
  await fs.writeFile(path.join(dir, 'keep.txt'), 'x');
  await deleteDishPhoto('../keep.txt', dir);
  await deleteDishPhoto('keep.txt', dir);
  await fs.access(path.join(dir, 'keep.txt'));
});

// ---------- Upload checks over HTTP (handler stubbed) ----------
let server; let base;
before(async () => {
  const app = createApp({
    stubHandlers: true,
    sessionUser: async (id) => ({ 2: { id: 2, role: 'caterer' }, 1: { id: 1, role: 'staff', onboarded: true } })[id] ?? null,
    todayCheckin: async () => null,
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
// The 413 test leaves an upload half-sent; close every connection so the process can exit.
after(() => { server.closeAllConnections(); server.close(); });

async function upload(bytes, { filename = 'dish.jpg', type = 'image/jpeg', field = 'photo', userId = 2 } = {}) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), filename);
  return fetch(`${base}/caterer/dishes/1/photo`, {
    method: 'PUT',
    headers: { Origin: process.env.CLIENT_ORIGIN, Cookie: `${SESSION_COOKIE}=${signSession(userId)}` },
    body: form,
  });
}

test('upload rejects a .jpg file that is really a PDF', async () => {
  const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj << /Type /Catalog >> endobj\n');
  const res = await upload(pdf, { filename: 'jollof.jpg', type: 'image/jpeg' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'The photo must be a JPEG, PNG or WebP image' });
});

test('upload rejects files over 2 MB', async () => {
  const big = Buffer.concat([await png(10, 10), Buffer.alloc(2 * 1024 * 1024)]);
  const res = await upload(big, { filename: 'big.png', type: 'image/png' });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'The photo must be 2 MB or smaller' });
});

test('upload accepts a real image whatever its claimed name and type', async () => {
  const res = await upload(await png(20, 20), { filename: 'photo.pdf', type: 'application/pdf' });
  assert.equal(res.status, 200);
});

test('upload needs the photo field, and only caterers may upload', async () => {
  assert.equal((await upload(await png(5, 5), { field: 'file' })).status, 400);
  assert.equal((await upload(await png(5, 5), { userId: 1 })).status, 403);
});

test('extras (yoghurt) carry RDI values and need approval like meals; add-ons (water) carry none', () => {
  const rdi = { carb: 11, protein: 14, fat: 8, vitamin: 8, mineral: 20 };
  assert.equal(hasRdi('extra'), true);
  assert.equal(hasRdi('meal'), true);
  assert.equal(hasRdi('addon'), false);
  assert.equal(dishCreateBody.safeParse({ type: 'extra', name: 'Yoghurt (1 cup)', priceKobo: 100_000, ...rdi }).success, true);
  assert.match(dishCreateBody.safeParse({ type: 'extra', name: 'Yoghurt (1 cup)', priceKobo: 100_000 }).error.issues[0].message, /% of daily RDI/);
  assert.equal(dishStatus({ type: 'extra', isApproved: false }), 'Awaiting approval');
  assert.equal(needsReapproval({ type: 'extra', isApproved: true, before: rdi, after: { ...rdi, carb: 12 } }), true);
});
