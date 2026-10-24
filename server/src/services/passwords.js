// Password hashing with Argon2id (OWASP Password Storage Cheat Sheet: m = 19 MiB, t = 2, p = 1).
// bcrypt is kept only to verify old hashes, which are rehashed to Argon2id on the next successful login.
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argon2.hash(password, ARGON2_OPTIONS);

export async function verifyPassword(hash, password) {
  if (hash.startsWith('$argon2')) {
    const ok = await argon2.verify(hash, password);
    return { ok, needsRehash: ok && argon2.needsRehash(hash, ARGON2_OPTIONS) };
  }
  if (/^\$2[aby]\$/.test(hash)) {
    const ok = await bcrypt.compare(password, hash);
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}

// Spend the same time on an unknown email as on a real one, so timing does not reveal which emails exist.
let dummyHash;
export async function burnVerify(password) {
  dummyHash ??= await hashPassword('not-a-real-password');
  await argon2.verify(dummyHash, password);
}
