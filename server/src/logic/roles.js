// Roles (CLAUDE.md item 10). There is no separate super admin; the admin has full control.
export const ROLES = ['staff', 'caterer', 'admin'];

// Where each role lands after logging in.
export const HOME = { staff: '/order', caterer: '/caterer', admin: '/admin/meals' };

/**
 * Checks whether an admin may change a user's role. Returns a plain error message, or null if allowed.
 * adminCount is the number of admins right now (counted inside the same transaction).
 * The last-admin rule guards against two admins demoting each other at the same time.
 */
export function checkRoleChange({ actorId, target, newRole, adminCount }) {
  if (!ROLES.includes(newRole)) return 'Choose staff, caterer or admin';
  if (target.role === newRole) return `This user is already ${newRole === 'admin' ? 'an' : 'a'} ${newRole}`;
  if (target.role === 'admin') {
    if (target.id === actorId) return "You can't remove your own admin role. Ask another admin to do it.";
    if (adminCount <= 1) return 'ChopWise must always have at least one admin.';
  }
  return null;
}
