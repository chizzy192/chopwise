// ChopWise days run midnight to midnight in Africa/Lagos (CLAUDE.md item 8), whatever the
// server's or PostgreSQL's own timezone. Every "today" in the system comes from todayInLagos().
export const TIMEZONE = 'Africa/Lagos';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

// The Lagos calendar date for an instant, as YYYY-MM-DD (the form PostgreSQL DATE columns use).
export function todayInLagos(now = new Date()) {
  const p = Object.fromEntries(parts.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Calendar arithmetic on a YYYY-MM-DD date (no time of day, so no timezone involved).
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
