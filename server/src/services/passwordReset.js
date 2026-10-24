// Password reset tokens (CLAUDE.md item 18). The token goes only into the emailed link; the
// database keeps its SHA-256 hash, so a copy of the database can't be used to reset anyone.
import { randomBytes, createHash } from 'node:crypto';

export const RESET_MINUTES = 30;
export const FORGOT_MESSAGE = "If an account exists for that email, we've sent a reset link.";
export const INVALID_LINK = 'This reset link is invalid, already used or expired. Ask for a new one.';

export const hashResetToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

// 32 random bytes, sent as 64 hex characters.
export function newResetToken() {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashResetToken(token) };
}

export const resetExpiry = (now = new Date()) => new Date(now.getTime() + RESET_MINUTES * 60_000);

// A token works once, and only before it expires.
export function resetTokenUsable({ expiresAt, usedAt }, now = new Date()) {
  return !usedAt && new Date(expiresAt).getTime() > now.getTime();
}
