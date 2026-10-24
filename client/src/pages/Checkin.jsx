import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { GateLights, DishPhoto, Loading, ErrorState } from '../components.jsx';

const SLOTS = [['prev1', 'Most recent meal'], ['prev2', 'Meal before that']];
const blank = (meal) => ({ mealId: meal?.id ?? '', ateElsewhere: false, editing: !meal });

// Daily check-in (CLAUDE.md item 8): confirm the last two meals once a day, before the first order.
export default function Checkin({ onDone }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [meals, setMeals] = useState([]);
  const [form, setForm] = useState(null);
  const [redo, setRedo] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // `alive` stops a stale load (for example React's second development run) from resetting
  // choices the user has already made.
  async function load(alive = () => true) {
    try {
      const [today, list] = await Promise.all([api('/checkin/today'), api('/meals')]);
      if (!alive()) return;
      setData(today); setMeals(list);
      setForm({ prev1: blank(today.prefill.prev1), prev2: blank(today.prefill.prev2) });
    } catch (e) {
      if (!alive()) return;
      if (e.code === 'ONBOARDING_REQUIRED') return navigate('/onboarding', { replace: true });
      setError(e.message);
    }
  }
  useEffect(() => {
    let current = true;
    load(() => current);
    return () => { current = false; };
  }, []);

  if (error && !data) return <ErrorState message={error} onRetry={() => load()} />;
  if (!data || !form) return <Loading label="Loading today's check-in…" />;

  const byId = new Map([...meals, ...Object.values(data.meals)].map((m) => [m.id, m]));
  // Functional update: two quick changes must both survive, even before React re-renders.
  const setSlot = (k, patch) => { setForm((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } })); setError(''); };

  async function submit(e) {
    e.preventDefault();
    if (SLOTS.some(([k]) => !form[k].mealId)) return setError('Choose both of your last two meals');
    const body = Object.fromEntries(SLOTS.map(([k]) => [k, { mealId: Number(form[k].mealId), ateElsewhere: form[k].ateElsewhere }]));
    setBusy(true);
    try {
      const res = await api('/checkin', { method: 'POST', body });
      setData({ ...data, checkin: res.checkin });
      setRedo(false);
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const { checkin } = data;
  if (checkin && !redo) {
    const meal = (k) => byId.get(checkin[k]?.mealId);
    return (
      <div className="narrow">
        <h1>Today's check-in</h1>
        <section className={`panel result ${checkin.guidance}`} aria-labelledby="result-h">
          <h2 id="result-h">{checkin.title}</h2>
          <p>{checkin.reason}</p>
          <GateLights inputs={{ H: checkin.h, P1: checkin.p1, P2: checkin.p2 }} gate={checkin.g} />
          <ul className="slot-summary">
            {SLOTS.map(([k, label]) => (
              <li key={k}><span className="hint">{label}:</span> {meal(k)?.name ?? 'Not recorded'}{checkin[k]?.source === 'manual' ? ' (chosen by you)' : ' (from your orders)'}</li>
            ))}
          </ul>
          <p className="hint">This stays the same until midnight. Guidance, not medical advice.</p>
        </section>
        <div className="actions">
          <button onClick={() => navigate('/order')}>Continue to order</button>
          {data.locked
            ? <p className="hint">You've ordered today, so this check-in is locked until tomorrow.</p>
            : <button className="quiet" onClick={() => { setRedo(true); setForm({ prev1: { ...blank(meal('prev1')), editing: false }, prev2: { ...blank(meal('prev2')), editing: false } }); }}>Change my check-in</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>{redo ? 'Change your check-in' : "Today's check-in"}</h1>
      <p>We use your last two meals and your health profile to decide how much guidance you get today.</p>
      <form onSubmit={submit} noValidate>
        <div className="slots">
          {SLOTS.map(([k, label]) => {
            const slot = form[k];
            const chosen = byId.get(Number(slot.mealId));
            const fromHistory = data.prefill[k] && Number(slot.mealId) === data.prefill[k].id && !slot.ateElsewhere;
            return (
              <fieldset key={k} className="slot">
                <legend>{label}</legend>
                <DishPhoto name={chosen?.name} url={chosen?.photoUrl} />
                <div className="slot-body">
                  <p className="slot-name">{chosen ? chosen.name : 'Not chosen yet'}</p>
                  {chosen && <p className="hint">{fromHistory ? 'From your orders' : slot.ateElsewhere ? 'Eaten elsewhere; closest match' : 'Chosen by you'}</p>}
                  {!slot.editing && <button type="button" className="quiet" onClick={() => setSlot(k, { editing: true })}>Change</button>}
                  {slot.editing && (
                    <div className="slot-edit">
                      <label className="check">
                        <input type="checkbox" checked={slot.ateElsewhere} onChange={(e) => setSlot(k, { ateElsewhere: e.target.checked })} />
                        I ate something not on ChopWise
                      </label>
                      <label htmlFor={`${k}-meal`}>{slot.ateElsewhere ? 'Closest match on ChopWise' : 'Meal'}</label>
                      <select id={`${k}-meal`} value={slot.mealId} onChange={(e) => setSlot(k, { mealId: e.target.value })}>
                        <option value="">Choose a meal</option>
                        {data.prefill[k] && !meals.some((m) => m.id === data.prefill[k].id) && (
                          <option value={data.prefill[k].id}>{data.prefill[k].name} (no longer on the menu)</option>
                        )}
                        {meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>
        {meals.length === 0 && <p className="notice" role="status">No meals are on the menu yet, so there's nothing to choose from. Check back once the caterers have added their dishes.</p>}
        {!data.prefill.prev1 && <p className="hint">You haven't ordered on ChopWise yet, so choose both meals.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Confirm my last two meals'}</button>
          {redo && <button type="button" className="quiet" onClick={() => setRedo(false)}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
