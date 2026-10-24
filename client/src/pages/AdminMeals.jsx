import { useEffect, useState } from 'react';
import { api, CLASSES, LABELS } from '../api.js';
import { DishPhoto, formatKobo, PageHead, Loading, Empty, ErrorState } from '../components.jsx';

export default function AdminMeals() {
  const [meals, setMeals] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const load = () => { setError(''); api('/admin/meals').then((m) => { setMeals(m); setLoaded(true); }).catch((e) => setError(e.message)); };
  useEffect(() => { load(); }, []);

  async function setApproved(m, approve) {
    try { await api(`/admin/meals/${m.id}`, { method: 'PATCH', body: { approve } }); setError(''); load(); }
    catch (e) { setError(e.message); }
  }

  const pending = meals.filter((m) => !m.isApproved);
  const live = meals.filter((m) => m.isApproved);
  return (
    <>
      <PageHead title="Meal approval" lead="Check each meal's nutrition values before staff can see it. Highlighted values changed since the meal was last approved." />
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && !loaded && <Loading label="Loading meals…" />}
      <MealCards
        title={`Awaiting approval (${pending.length})`}
        meals={pending}
        empty="Nothing waiting. New meals and meals with changed nutrition values appear here."
        action={(m) => <button onClick={() => setApproved(m, true)}>{m.status === 'Awaiting re-approval' ? 'Re-approve' : 'Approve'}</button>}
      />
      <MealCards
        title={`Live meals (${live.length})`}
        meals={live}
        empty="No live meals yet."
        action={(m) => <button className="quiet" onClick={() => setApproved(m, false)}>Unapprove</button>}
      />
    </>
  );
}

// Meals as cards (photo, RDI values with changes highlighted, dominant class, balanced flag, action).
function MealCards({ title, meals, empty, action }) {
  return (
    <section className="group">
      <h2>{title}</h2>
      <ul className="card-grid meal-cards">
        {meals.length === 0 && <li className="grid-empty"><Empty title={empty} /></li>}
        {meals.map((m) => (
          <li key={m.id} className="panel meal-card">
            <DishPhoto name={m.name} url={m.photoUrl} />
            <div className="meal-card-head">
              <h3 className="dish-name">{m.name}</h3>
              {m.status === 'Awaiting re-approval' && <span className="pill wait">Changed</span>}
            </div>
            <p className="hint">{m.catererName} · <span className="tnum">{formatKobo(m.priceKobo)}</span></p>
            <dl className="rdi-list tnum">
              {CLASSES.map((c) => {
                const changed = m.changedSinceApproval.includes(c);
                return (
                  <div key={c} className={changed ? 'changed' : ''}>
                    <dt>{LABELS[c]}</dt>
                    <dd>{m[c]}%{changed && <span className="was"> (was {m.approvedValues[c]}%)</span>}</dd>
                  </div>
                );
              })}
            </dl>
            <p className="meal-facts">Dominant: <b>{LABELS[m.dominantClass]}</b> · Balanced: <b>{m.isBalanced ? 'Yes' : 'No'}</b></p>
            <div className="card-actions">{action(m)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
