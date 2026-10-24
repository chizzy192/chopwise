// Caterer dish library: rules, request schemas and photo uploads (no database).
// Ownership, hiding re-submitted meals and blocking sold-out orders run against the real
// database in scripts/system-scenarios.js (T37–T44).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  changedClasses, needsReapproval, isSoldOut, dishStatus, splitMenu, rdiOf, hasRdi,
} from '../src/logic/dish.js';
import { evaluate, emptyIntake } from '../src/logic/engine.js';
import { todayInLagos } from '../src/logic/time.js';
import { dishCreateBody, dishEditBody, rdiProblem } from '../src/http/schemas.js';
import {
  encodeDishPhoto, saveDishPhoto, deleteDishPhoto, loadDishPhoto, PHOTO_NAME, MAX_WIDTH,
} from '../src/services/photos.js';

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

// ---------- Photo storage (in PostgreSQL; a fake db records the queries) ----------
const png = (width, height) => sharp({ create: { width, height, channels: 3, background: '#b5651d' } }).png().toBuffer();
function fakeDb(rows = []) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows }; } };
}

test('photos are re-encoded to WebP, at most 1200 px wide, with metadata stripped', async () => {
  // A JPEG carrying EXIF data, as a phone photo would (camera make, GPS, etc.).
  const phone = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#556b2f' } })
    .withExif({ IFD0: { Make: 'PhoneCo', Copyright: 'secret location' } }).jpeg().toBuffer();
  assert.ok((await sharp(phone).metadata()).exif, 'the test input really has EXIF');
  const stored = await encodeDishPhoto(phone);
  const meta = await sharp(stored).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, MAX_WIDTH);
  assert.equal(meta.exif, undefined, 'EXIF removed');
  assert.ok(!stored.includes(Buffer.from('secret location')));
  assert.equal((await sharp(await encodeDishPhoto(await png(400, 300))).metadata()).width, 400, 'small photos are not enlarged');
});

test('a saved photo goes into dish_photos under a new random id, never the uploaded name', async () => {
  const db = fakeDb();
  const input = await png(50, 50);
  const [a, b] = [await saveDishPhoto(input, db), await saveDishPhoto(input, db)];
  assert.match(a, PHOTO_NAME);
  assert.notEqual(a, b);
  const insert = db.calls[0];
  assert.match(insert.sql, /^INSERT INTO dish_photos/);
  assert.equal(`${insert.params[0]}.webp`, a);
  assert.equal(insert.params[1], 'image/webp');
  assert.equal((await sharp(insert.params[2]).metadata()).format, 'webp', 'the stored bytes are the re-encoded WebP');
});

test('deleting or loading a photo only ever uses one of our names', async () => {
  const db = fakeDb();
  await deleteDishPhoto('../keep.txt', db);
  await deleteDishPhoto('keep.txt', db);
  assert.equal(await loadDishPhoto('x.webp; DROP TABLE meals', db), null);
  assert.equal(db.calls.length, 0, 'no query for a name that is not ours');
  const name = '0b6f2f0e-4d3c-4a6b-9f1e-2c3d4e5f6a7b.webp';
  await deleteDishPhoto(name, db);
  assert.deepEqual(db.calls[0].params, ['0b6f2f0e-4d3c-4a6b-9f1e-2c3d4e5f6a7b']);
  const found = await loadDishPhoto(name, fakeDb([{ content_type: 'image/webp', bytes: Buffer.from('x') }]));
  assert.deepEqual(found, { contentType: 'image/webp', bytes: Buffer.from('x') });
});

test('stored photos are served with their type, nosniff and a one-year cache; anything else is 404', async () => {
  const name = '0b6f2f0e-4d3c-4a6b-9f1e-2c3d4e5f6a7b.webp';
  const bytes = await encodeDishPhoto(await png(20, 20));
  const app = createApp({ stubHandlers: true, loadPhoto: async (n) => (n === name ? { contentType: 'image/webp', bytes } : null) });
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  const site = `http://127.0.0.1:${s.address().port}`;
  try {
    const ok = await fetch(`${site}/uploads/dishes/${name}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/webp');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(ok.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), bytes);
    assert.equal((await fetch(`${site}/uploads/dishes/1b6f2f0e-4d3c-4a6b-9f1e-2c3d4e5f6a7b.webp`)).status, 404);
    assert.equal((await fetch(`${site}/uploads/dishes/..%2f..%2fpackage.json`)).status, 404);
    assert.equal((await fetch(`${site}/uploads/other.txt`)).status, 404);
  } finally { s.close(); }
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
