import { useState } from 'react';
import { api, CONDITIONS } from '../api.js';

const QUESTION = 'Do you have a diet-related health condition, such as diabetes, hypertension or heart disease?';

function fromProfile(p) {
  if (!p) return { hasCondition: null, conditions: [], hasOther: false, otherCondition: '' };
  return {
    hasCondition: p.hasCondition,
    conditions: p.conditions,
    hasOther: Boolean(p.otherCondition),
    otherCondition: p.otherCondition || '',
  };
}

// The onboarding question (CLAUDE.md item 9), used by onboarding and the Health profile page.
export default function HealthForm({ profile, submitLabel, onSaved }) {
  const [f, setF] = useState(() => fromProfile(profile));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => { setF((prev) => ({ ...prev, ...patch })); setError(''); };
  const toggle = (c) => set({ conditions: f.conditions.includes(c) ? f.conditions.filter((x) => x !== c) : [...f.conditions, c] });

  async function submit(e) {
    e.preventDefault();
    if (f.hasCondition === null) return setError('Answer yes or no to the health question');
    const other = f.hasOther ? f.otherCondition.trim() : '';
    if (f.hasCondition) {
      if (f.hasOther && !other) return setError('Describe the other condition, or untick Other');
      if (!f.conditions.length && !other) return setError('Tick at least one condition, or describe it under Other');
    }
    const body = f.hasCondition
      ? { hasCondition: true, conditions: f.conditions, ...(other ? { otherCondition: other } : {}) }
      : { hasCondition: false };
    setBusy(true);
    try { onSaved(await api('/health-profile', { method: 'PUT', body })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="panel health-form" noValidate>
      <fieldset>
        <legend>{QUESTION}</legend>
        <div className="choice-row">
          <label><input type="radio" name="has" checked={f.hasCondition === true} onChange={() => set({ hasCondition: true })} /> Yes</label>
          <label><input type="radio" name="has" checked={f.hasCondition === false} onChange={() => set({ hasCondition: false })} /> No</label>
        </div>
      </fieldset>

      {f.hasCondition && (
        <>
          <fieldset>
            <legend>Which conditions?</legend>
            {CONDITIONS.map((c) => (
              <label key={c} className="check"><input type="checkbox" checked={f.conditions.includes(c)} onChange={() => toggle(c)} /> {c}</label>
            ))}
            <label className="check"><input type="checkbox" checked={f.hasOther} onChange={(e) => set({ hasOther: e.target.checked })} /> Other</label>
            {f.hasOther && (
              <div className="field indent">
                <label htmlFor="other">Describe the other condition</label>
                <input id="other" maxLength={100} value={f.otherCondition} onChange={(e) => set({ otherCondition: e.target.value })} />
              </div>
            )}
          </fieldset>
        </>
      )}

      <p className="hint">Guidance, not medical advice.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
