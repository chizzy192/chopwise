// Brings an existing database up to the current schema without deleting anything:
//   npm run db:migrate
// Every step is additive and safe to run again. `npm run db:setup` is still the way to start
// from scratch with the demo data.
import { pool } from './pool.js';

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
];

async function main() {
  for (const sql of STEPS) await pool.query(sql);
  console.log(`Database up to date (${STEPS.length} steps checked). No data was removed.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
