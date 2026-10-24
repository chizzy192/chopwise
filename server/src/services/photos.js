// Dish photo storage. Every upload is re-encoded, so only pixels survive: no metadata (such as
// phone GPS data), no embedded scripts and nothing from the original filename. Photos are kept in
// PostgreSQL (dish_photos), not on disk, because the host's disk is wiped on every restart. Each
// is served at /uploads/dishes/<random id>.webp (app.js).
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '../db/pool.js';

export const PHOTO_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;
export const MAX_WIDTH = 1200;
export const PHOTO_TYPE = 'image/webp';

// Refuse images that decode to more than 40 megapixels, so a tiny file cannot expand to gigabytes in memory.
const MAX_PIXELS = 40_000_000;

export const photoUrl = (name) => (name ? `/uploads/dishes/${name}` : null);

/** Re-encodes an image to WebP, at most 1200 px wide, with all metadata dropped. */
export async function encodeDishPhoto(buffer) {
  return sharp(buffer, { limitInputPixels: MAX_PIXELS })
    .rotate() // apply the camera's orientation before the metadata is dropped
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

/** Re-encodes and stores a photo under a new random id. Returns its name (<id>.webp). */
export async function saveDishPhoto(buffer, db = pool) {
  const webp = await encodeDishPhoto(buffer);
  const id = randomUUID();
  await db.query('INSERT INTO dish_photos (photo_id, content_type, bytes) VALUES ($1, $2, $3)', [id, PHOTO_TYPE, webp]);
  return `${id}.webp`;
}

/** Deletes a stored photo. Anything that isn't one of our names is ignored. */
export async function deleteDishPhoto(name, db = pool) {
  const match = PHOTO_NAME.exec(name ?? '');
  if (!match) return;
  await db.query('DELETE FROM dish_photos WHERE photo_id = $1', [match[1]]);
}

/** The stored photo for a name, or null. */
export async function loadDishPhoto(name, db = pool) {
  const match = PHOTO_NAME.exec(name ?? '');
  if (!match) return null;
  const { rows } = await db.query('SELECT content_type, bytes FROM dish_photos WHERE photo_id = $1', [match[1]]);
  return rows[0] ? { contentType: rows[0].content_type, bytes: rows[0].bytes } : null;
}
