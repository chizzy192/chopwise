import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageHead, Loading, Empty, ErrorState } from '../components.jsx';

export default function Notifications() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api('/notifications').then(setItems).catch((e) => setError(e.message)); };
  useEffect(load, []);

  return (
    <div className="narrow">
      <PageHead title="Notifications" lead="Warnings when a food type goes above 70% or 90% of your daily limit." />
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && !items && <Loading label="Loading your notifications…" />}
      {items?.length === 0 && <Empty title="No warnings yet">You'll see one here when any food type goes above 70% of your daily limit.</Empty>}
      {items?.length > 0 && (
        <ul className="note-list">
          {items.map((n) => (
            <li key={n.notification_id} className={`notice ${n.intake_level}`}>
              <p>{n.message}</p>
              <p className="hint">{new Date(n.issued_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
