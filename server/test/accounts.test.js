import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { checkRoleChange, HOME } from '../src/logic/roles.js';
import { applyFailure, applySuccess, isLocked, minutesLeft } from '../src/logic/lockout.js';
import { hashPassword, verifyPassword } from '../src/services/passwords.js';

const admin = { id: 1, role: 'admin' };
const staff = { id: 2, role: 'staff' };

test('roles: an admin can promote and demote other users', () => {
  assert.equal(checkRoleChange({ actorId: 1, target: staff, newRole: 'caterer', adminCount: 1 }), null);
  assert.equal(checkRoleChange({ actorId: 1, target: staff, newRole: 'admin', adminCount: 1 }), null);
  assert.equal(checkRoleChange({ actorId: 1, target: { id: 3, role: 'admin' }, newRole: 'staff', adminCount: 2 }), null);
});

test("roles: an admin can't remove their own admin role", () => {
  assert.match(checkRoleChange({ actorId: 1, target: admin, newRole: 'staff', adminCount: 3 }), /can't remove your own admin role/);
});

test('roles: the last admin is protected', () => {
  // Reached when two admins demote each other at once: the second sees only one admin left.
  assert.match(checkRoleChange({ actorId: 9, target: admin, newRole: 'caterer', adminCount: 1 }), /at least one admin/);
});

test('roles: unknown roles and no-op changes are refused', () => {
  assert.match(checkRoleChange({ actorId: 1, target: staff, newRole: 'super_admin', adminCount: 1 }), /Choose staff, caterer or admin/);
  assert.match(checkRoleChange({ actorId: 1, target: staff, newRole: 'staff', adminCount: 1 }), /already a staff/);
});

test('roles: each role lands on its own page after login', () => {
  assert.deepEqual(HOME, { staff: '/order', caterer: '/caterer', admin: '/admin/meals' });
});

test('lockout: 5 failed logins lock the account for 15 minutes', () => {
  const now = new Date('2026-10-23T09:00:00Z');
  let state = { failedAttempts: 0 };
  for (let i = 1; i <= 4; i += 1) {
    state = applyFailure(state, now);
    assert.equal(state.locked, false);
    assert.equal(state.failedAttempts, i);
  }
  state = applyFailure(state, now);
  assert.equal(state.locked, true);
  assert.equal(state.lockedUntil.toISOString(), '2026-10-23T09:15:00.000Z');
  assert.equal(isLocked(state.lockedUntil, new Date('2026-10-23T09:14:59Z')), true);
  assert.equal(isLocked(state.lockedUntil, new Date('2026-10-23T09:15:01Z')), false);
  assert.equal(minutesLeft(state.lockedUntil, new Date('2026-10-23T09:05:30Z')), 10);
});

test('lockout: a successful login resets the count', () => {
  let state = { failedAttempts: 0 };
  for (let i = 0; i < 3; i += 1) state = applyFailure(state, new Date());
  assert.deepEqual(applySuccess(), { failedAttempts: 0, lockedUntil: null });
  state = applyFailure(applySuccess(), new Date());
  assert.equal(state.failedAttempts, 1, 'counting starts again from zero');
});

test('passwords: new hashes are Argon2id with OWASP parameters', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  assert.deepEqual(await verifyPassword(hash, 'correct horse battery'), { ok: true, needsRehash: false });
  assert.deepEqual(await verifyPassword(hash, 'wrong password'), { ok: false, needsRehash: false });
});

test('passwords: a bcrypt hash still verifies and is flagged for rehash to Argon2id', async () => {
  const legacy = await bcrypt.hash('password123', 10);
  assert.deepEqual(await verifyPassword(legacy, 'password123'), { ok: true, needsRehash: true });
  assert.deepEqual(await verifyPassword(legacy, 'wrong'), { ok: false, needsRehash: false });
});

test('passwords: unknown hash formats never verify', async () => {
  assert.deepEqual(await verifyPassword('plaintext', 'plaintext'), { ok: false, needsRehash: false });
});
