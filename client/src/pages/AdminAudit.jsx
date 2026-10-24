import { useEffect, useState } from 'react';
import { api, naira, LABELS } from '../api.js';
import { PageHead, Loading, Empty, ErrorState } from '../components.jsx';

const a = (role) => (role === 'admin' ? 'an admin' : `a ${role}`);
const listClasses = (classes = []) => classes.map((c) => LABELS[c].toLowerCase()).join(', ') || 'nutrition values';

// One plain sentence per entry. Unknown actions fall back to their code.
function describe({ action, details: d }) {
  switch (action) {
    case 'user.role_changed': return `Changed ${d.name} (${d.email}) from ${d.from} to ${d.to}`;
    case 'user.created': return `Created ${a(d.role)} account for ${d.name} (${d.email})`;
    case 'meal.approved': return `Approved ${d.name}`;
    case 'meal.unapproved': return `Unapproved ${d.name}`;
    case 'meal.reapproved': return `Re-approved ${d.name} after changes to ${listClasses(d.changed)}`;
    case 'meal.sent_for_reapproval': return `Changed ${listClasses(d.changed)} on ${d.name}, sending it back for approval`;
    case 'meal.deleted': return `Deleted ${d.name}`;
    case 'settings.updated':
      return `Changed VAT from ${d.from.vatRate}% to ${d.to.vatRate}% and the delivery fee from ${naira.format(d.from.deliveryFee)} to ${naira.format(d.to.deliveryFee)}`;
    case 'account.locked': return `Locked ${d.email} for ${d.minutes} minutes after 5 failed logins`;
    case 'account.unlocked': return `Unlocked ${d.email}`;
    default: return action;
  }
}

export default function AdminAudit() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/admin/audit-log').then(setEntries).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <PageHead title="Audit log" lead="Every admin action, account lockout and payment alert, newest first. Showing the latest 100." />
      {error && <ErrorState message={error} />}
      {!error && !entries && <Loading label="Loading the audit log…" />}
      {entries && entries.length === 0 && <Empty title="Nothing recorded yet">Role changes, meal approvals, settings changes and lockouts appear here.</Empty>}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What happened</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="tnum nowrap">{new Date(e.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{e.actor_name ?? 'System'}</td>
                  <td>{describe(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
