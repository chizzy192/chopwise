// Account lockout: 5 failed logins lock the account for 15 minutes.
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export function isLocked(lockedUntil, now) {
  return Boolean(lockedUntil) && new Date(lockedUntil) > now;
}

// The count restarts once the account locks, so each lock follows 5 fresh failures.
export function applyFailure({ failedAttempts }, now) {
  const attempts = failedAttempts + 1;
  if (attempts >= MAX_FAILED_LOGINS) {
    return { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000), locked: true };
  }
  return { failedAttempts: attempts, lockedUntil: null, locked: false };
}

export function applySuccess() {
  return { failedAttempts: 0, lockedUntil: null };
}

export function minutesLeft(lockedUntil, now) {
  return Math.max(1, Math.ceil((new Date(lockedUntil) - now) / 60_000));
}
