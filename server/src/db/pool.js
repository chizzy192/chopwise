import pg from 'pg';
import 'dotenv/config';

// NUMERIC comes back as a string by default; parse it as a number.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// DATE as plain YYYY-MM-DD string.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text, params) => pool.query(text, params);
