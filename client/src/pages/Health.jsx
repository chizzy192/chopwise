import { useEffect, useState } from 'react';
import { api } from '../api.js';
import HealthForm from './HealthForm.jsx';
import { Loading, ErrorState } from '../components.jsx';

const APPLIES = {
  tomorrow: "You've already checked in today, so changes apply from tomorrow's check-in. Today's guidance stays as it is.",
  today: 'Changes apply when you check in today.',
};

export default function Health() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api('/health-profile').then(setData).catch((e) => setError(e.message)); }, []);

  function saved(next) {
    setData(next);
    setMsg(next.appliesFrom === 'tomorrow' ? "Saved. Today's guidance stays as it is; this applies from tomorrow's check-in." : 'Saved. This applies when you check in today.');
  }

  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Loading your health profile…" />;

  return (
    <div className="narrow">
      <h1>Health profile</h1>
      <p className="explain">{data.explanation}</p>
      <p className="hint">{APPLIES[data.appliesFrom]}</p>
      {/* key remounts the form with the saved answer */}
      <HealthForm key={data.profile.updatedAt} profile={data.profile} submitLabel="Save health profile" onSaved={saved} />
      {msg && <p className="ok" role="status">{msg}</p>}
    </div>
  );
}
