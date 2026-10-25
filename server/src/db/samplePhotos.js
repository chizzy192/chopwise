// Real dish photos for the sample data (optional). `npm run photos:export` copies the photos caterers
// uploaded into server/sample-photos/; db:seed gives each sample dish with a matching file its photo.
// The files are already re-encoded WebP (the upload path did that), so they are stored as they are.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SAMPLE_PHOTO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sample-photos');

// "Jollof rice and chicken" → "jollof-rice-and-chicken.webp"
export const photoFileName = (dishName) => `${dishName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.webp`;

/** Gives each of this caterer's dishes that has a saved photo file its photo. Returns how many. */
export async function attachSamplePhotos(db, catererId) {
  // SAMPLE_PHOTOS=0 leaves them out (the browser smoke tests upload photos to dishes that have none).
  if (process.env.SAMPLE_PHOTOS === '0' || !fs.existsSync(SAMPLE_PHOTO_DIR)) return 0;
  const { rows } = await db.query('SELECT meal_id, name FROM meals WHERE caterer_id = $1 AND photo IS NULL', [catererId]);
  let attached = 0;
  for (const { meal_id: mealId, name } of rows) {
    const file = path.join(SAMPLE_PHOTO_DIR, photoFileName(name));
    if (!fs.existsSync(file)) continue;
    const id = randomUUID();
    await db.query("INSERT INTO dish_photos (photo_id, content_type, bytes) VALUES ($1, 'image/webp', $2)", [id, fs.readFileSync(file)]);
    await db.query('UPDATE meals SET photo = $1 WHERE meal_id = $2', [`${id}.webp`, mealId]);
    attached += 1;
  }
  return attached;
}
