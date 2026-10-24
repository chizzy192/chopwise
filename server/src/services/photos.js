// Dish photo storage. Every upload is re-encoded, so only pixels survive: no metadata
// (such as phone GPS data), no embedded scripts and nothing from the original filename.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// UPLOADS_DIR lets a test run keep its photos apart from the dev server's.
export const UPLOADS_ROOT = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
export const DISH_PHOTO_DIR = path.join(UPLOADS_ROOT, 'dishes');
export const PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
export const MAX_WIDTH = 1200;

// Refuse images that decode to more than 40 megapixels, so a tiny file cannot expand to gigabytes in memory.
const MAX_PIXELS = 40_000_000;

export const photoUrl = (name) => (name ? `/uploads/dishes/${name}` : null);

/** Re-encodes an image to WebP (max 1200 px wide) and saves it under a random name. Returns the name. */
export async function saveDishPhoto(buffer, dir = DISH_PHOTO_DIR) {
  const webp = await sharp(buffer, { limitInputPixels: MAX_PIXELS })
    .rotate() // apply the camera's orientation before the metadata is dropped
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await fs.mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.webp`;
  await fs.writeFile(path.join(dir, name), webp, { flag: 'wx' });
  return name;
}

export async function deleteDishPhoto(name, dir = DISH_PHOTO_DIR) {
  if (!name || !PHOTO_NAME.test(name)) return;
  await fs.rm(path.join(dir, name), { force: true });
}
