// Audit log of admin actions and account lockouts. `db` is the pool's query function or a
// transaction client, so the entry commits or rolls back with the change it describes.
import { query } from '../db/pool.js';

export async function audit({ actorId, action, targetType, targetId = null, details = {} }, db = { query }) {
  await db.query(
    'INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)',
    [actorId, action, targetType, targetId, details],
  );
}
