// Copies the dish photos caterers uploaded into server/sample-photos/, one file per dish, named after
// the dish (e.g. jollof-rice-and-chicken.webp). Read-only: it never changes the database.
//   npm run photos:export            (reads the database in DATABASE_URL, e.g. the live one on Neon)
// db:seed then gives every sample dish with a matching file its photo, so local test runs and
// screenshots show the real pictures. The folder is git-ignored and stays on this computer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { SAMPLE_PHOTO_DIR, photoFileName } from '../src/db/samplePhotos.js';

async function main() {
  const { rows } = await pool.query(
    `SELECT m.name, p.bytes FROM meals m JOIN dish_photos p ON p.photo_id::text || '.webp' = m.photo ORDER BY m.name`,
  );
  if (!rows.length) {
    console.log('No dish photos found in this database, so nothing was copied.');
    return;
  }
  fs.mkdirSync(SAMPLE_PHOTO_DIR, { recursive: true });
  for (const { name, bytes } of rows) fs.writeFileSync(path.join(SAMPLE_PHOTO_DIR, photoFileName(name)), bytes);
  console.log(`Copied ${rows.length} dish photo${rows.length === 1 ? '' : 's'} to ${path.relative(process.cwd(), SAMPLE_PHOTO_DIR)}:`);
  for (const { name } of rows) console.log(`  ${photoFileName(name)}  (${name})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => pool.end());
}
