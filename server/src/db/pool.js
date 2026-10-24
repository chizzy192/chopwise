import pg from 'pg';
import 'dotenv/config';

// NUMERIC comes back as a string by default; parse it as a number.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// DATE as plain YYYY-MM-DD string.
pg.types.setTypeParser(1082, (v) => v);

/**
 * Hosted PostgreSQL (Neon) needs TLS: its DATABASE_URL ends with ?sslmode=require. node-postgres
 * already treats require as verify-full (the server's certificate is checked); saying so
 * explicitly keeps that behaviour and silences its warning about the mode changing later.
 */
export function connectionString(url = process.env.DATABASE_URL) {
  return url?.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full');
}

export const pool = new pg.Pool({ connectionString: connectionString() });

export const query = (text, params) => pool.query(text, params);
