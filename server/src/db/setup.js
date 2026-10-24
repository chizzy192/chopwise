// Rebuilds the database from scratch with the sample data: npm run db:setup
// DELETES EVERY TABLE AND ROW first, then runs db:migrate and db:seed. For local development and
// the test runs only: it refuses when NODE_ENV=production, or when DATABASE_URL points anywhere
// but this computer (such as Neon), unless you pass --force (npm run db:setup -- --force), so live
// data can't be wiped by accident.
import { pool } from './pool.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { accountsFromEnv } from './accounts.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const ASK_FORCE = ' Use npm run db:migrate (and db:seed for sample data) instead. If you really mean to wipe it, run: npm run db:setup -- --force';

async function main() {
  if (!process.argv.includes('--force')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`db:setup deletes all data and NODE_ENV is production, so it stopped.${ASK_FORCE}`);
    }
    const host = (() => { try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ''; } })();
    if (!LOCAL_HOSTS.includes(host)) {
      throw new Error(`db:setup deletes all data and DATABASE_URL points to ${host || 'an unknown host'}, not this computer, so it stopped.${ASK_FORCE}`);
    }
  }
  // Check .env before touching the database, so a bad config never leaves it half-built.
  accountsFromEnv();
  await pool.query(`
    DROP TABLE IF EXISTS dish_photos, feedback, feedback_prompts, password_resets, order_items, daily_checkins, audit_log,
      settings, notifications, health_profiles, session_intake, orders, meals, users CASCADE;
    DROP TYPE IF EXISTS user_role, intake_level, meal_source, dish_type, order_status, feedback_answer CASCADE;
  `);
  await migrate(pool);
  await seed(pool);
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exitCode = 1; })
  .finally(() => pool.end());
