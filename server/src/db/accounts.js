// Accounts that come from .env (the first admin, the sample caterer) and the demo staff accounts.
// Shared by db:migrate (the first admin), db:seed (sample data) and db:setup.

// Sample staff accounts for the demo and system tests. The password meets the 10-character rule.
export const DEMO_PASSWORD = 'password123';
export const DEMO_USERS = [
  ['Dr. Ada Okafor', 'staff@chopwise.ng', 'staff'],
  ['Mr. Emeka Obi', 'staff2@chopwise.ng', 'staff'],
];

// Reads PREFIX_EMAIL, PREFIX_PASSWORD and PREFIX_NAME, adding any problems to `problems`.
export function accountFromEnv(prefix, label, defaultName, problems) {
  const email = (process.env[`${prefix}_EMAIL`] || '').trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`] || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`${prefix}_EMAIL must be a valid email`);
  if (password.length < 10) problems.push(`${prefix}_PASSWORD must be at least 10 characters`);
  if (password === DEMO_PASSWORD) problems.push(`${prefix}_PASSWORD must not be the demo staff password`);
  if (DEMO_USERS.some(([, e]) => e === email)) problems.push(`${prefix}_EMAIL must not be one of the demo staff accounts`);
  return { label, name: process.env[`${prefix}_NAME`]?.trim() || defaultName, email, password };
}

// The first admin. Throws with every problem at once, before the database is touched.
export function adminFromEnv() {
  const problems = [];
  const admin = accountFromEnv('ADMIN', 'Admin', 'System Administrator', problems);
  if (problems.length) throw new Error(`Set the first admin in .env: ${problems.join('; ')}`);
  return admin;
}

// The first admin and the sample caterer, checked together.
export function accountsFromEnv() {
  const problems = [];
  const admin = accountFromEnv('ADMIN', 'Admin', 'System Administrator', problems);
  const caterer = accountFromEnv('CATERER', 'Caterer', 'Campus Kitchen', problems);
  if (admin.email && admin.email === caterer.email) problems.push('ADMIN_EMAIL and CATERER_EMAIL must be different');
  if (problems.length) throw new Error(`Set the sample accounts in .env: ${problems.join('; ')}`);
  return { admin, caterer };
}
