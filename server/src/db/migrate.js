// Brings a database up to the current schema without deleting anything:
//   npm run db:migrate
// On an empty database it creates every table from schema.sql. On an existing one it applies only
// additive steps, each safe to run again. Then it makes sure the settings row and the first admin
// (ADMIN_EMAIL / ADMIN_PASSWORD) exist, never changing them if they do. Safe to run on live data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { hashPassword } from '../services/passwords.js';
import { adminFromEnv } from './accounts.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Changes made after the first release, in order. Every step is additive and idempotent.
const STEPS = [
  // Admin-given temporary passwords (caterer accounts).
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE',
  // Session versions: a password reset or change signs out every session.
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0 CHECK (session_version >= 0)',
  // Extras (yoghurt): RDI values, counted toward intake.
  "ALTER TYPE dish_type ADD VALUE IF NOT EXISTS 'extra'",
  `CREATE TABLE IF NOT EXISTS password_resets (
     reset_id    SERIAL       PRIMARY KEY,
     user_id     INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
     token_hash  CHAR(64)     NOT NULL UNIQUE,
     expires_at  TIMESTAMPTZ  NOT NULL,
     used_at     TIMESTAMPTZ,
     created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id)',
  `DO $$ BEGIN
     CREATE TYPE feedback_answer AS ENUM ('yes', 'no', 'sometimes');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS feedback (
     feedback_id     SERIAL          PRIMARY KEY,
     user_id         INT             NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
     ordering_score  SMALLINT        NOT NULL CHECK (ordering_score BETWEEN 1 AND 5),
     guidance_score  SMALLINT        NOT NULL CHECK (guidance_score BETWEEN 1 AND 5),
     changed_order   feedback_answer NOT NULL,
     comment         VARCHAR(500),
     created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS feedback_prompts (
     user_id             INT          PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
     times_shown         INT          NOT NULL CHECK (times_shown BETWEEN 1 AND 3),
     shown_at_delivered  INT          NOT NULL CHECK (shown_at_delivered >= 0),
     last_shown_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
   )`,
  // Bottled water with each meal is charged at an admin-set price and can be removed per meal line.
  'ALTER TABLE settings ADD COLUMN IF NOT EXISTS water_price NUMERIC(12,2) NOT NULL DEFAULT 300 CHECK (water_price BETWEEN 0 AND 100000)',
  // Orders from before that change came with one free bottle per meal plate: record it at ₦0.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'water_quantity') THEN
       ALTER TABLE order_items ADD COLUMN water_quantity INT NOT NULL DEFAULT 0 CHECK (water_quantity >= 0);
       ALTER TABLE order_items ADD COLUMN water_unit_price_kobo INT NOT NULL DEFAULT 0 CHECK (water_unit_price_kobo >= 0);
       UPDATE order_items SET water_quantity = quantity WHERE dish_type = 'meal';
     END IF;
   END $$`,
  // A third warning level, for intake past 100% of the daily limit.
  "ALTER TYPE intake_level ADD VALUE IF NOT EXISTS 'Over'",
  // Dish photos live in the database, because the host's disk is wiped on every restart.
  `CREATE TABLE IF NOT EXISTS dish_photos (
     photo_id      UUID         PRIMARY KEY,
     content_type  VARCHAR(30)  NOT NULL CHECK (content_type = 'image/webp'),
     bytes         BYTEA        NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 3145728),
     created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
   )`,
];

// VAT starts at Nigeria's standard rate of 7.5%; the delivery fee at ₦0 until the admin sets it.
export const DEFAULT_SETTINGS = { vatRate: 7.5, deliveryFee: 0 };

// Photo files saved on disk by older versions (server/uploads/dishes), copied into dish_photos.
const LEGACY_PHOTO_DIR = path.resolve(dir, '../../uploads/dishes');

/** Creates or updates the schema. Never drops or deletes anything. Returns what it did. */
export async function migrate(db = pool) {
  const done = [];
  const { rows } = await db.query("SELECT to_regclass('public.users') IS NOT NULL AS exists");
  if (!rows[0].exists) {
    await db.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
    done.push('created every table (empty database)');
  }
  for (const sql of STEPS) await db.query(sql);
  done.push(`checked ${STEPS.length} additive steps`);

  const settings = await db.query(
    'INSERT INTO settings (vat_rate, delivery_fee) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM settings) RETURNING setting_id',
    [DEFAULT_SETTINGS.vatRate, DEFAULT_SETTINGS.deliveryFee],
  );
  if (settings.rowCount) done.push(`set VAT to ${DEFAULT_SETTINGS.vatRate}% and the delivery fee to ₦${DEFAULT_SETTINGS.deliveryFee}`);

  // The first admin, only if no account has that email yet; an existing account is left alone.
  if (process.env.ADMIN_EMAIL) {
    const admin = adminFromEnv();
    const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [admin.email]);
    if (!exists.rowCount) {
      await db.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
        [admin.name, admin.email, await hashPassword(admin.password)]);
      done.push(`created the first admin, ${admin.email}`);
    }
  } else {
    done.push('ADMIN_EMAIL is not set, so no admin account was created');
  }

  done.push(...await importLegacyPhotos(db));
  return done;
}

async function importLegacyPhotos(db) {
  if (!fs.existsSync(LEGACY_PHOTO_DIR)) return [];
  const { rows } = await db.query(
    `SELECT m.photo FROM meals m WHERE m.photo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dish_photos p WHERE p.photo_id::text || '.webp' = m.photo)`,
  );
  let copied = 0;
  for (const { photo } of rows) {
    const file = path.join(LEGACY_PHOTO_DIR, photo);
    if (!fs.existsSync(file)) continue;
    await db.query("INSERT INTO dish_photos (photo_id, content_type, bytes) VALUES ($1, 'image/webp', $2) ON CONFLICT DO NOTHING",
      [photo.replace(/\.webp$/, ''), fs.readFileSync(file)]);
    copied += 1;
  }
  return copied ? [`copied ${copied} dish photo${copied === 1 ? '' : 's'} from server/uploads into the database`] : [];
}

// Run directly: npm run db:migrate
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then((done) => { console.log(`Database up to date. No data was removed.\n${done.map((d) => `  - ${d}`).join('\n')}`); })
    .catch((e) => { console.error(e.message ?? e); process.exitCode = 1; })
    .finally(() => pool.end());
}
