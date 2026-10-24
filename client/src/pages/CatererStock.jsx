import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { DishPhoto, Loading, Empty, PageHead } from '../components.jsx';
import { StockInput } from './CatererDishes.jsx';

const TYPE_LABEL = { meal: 'Meals', extra: 'Extras', addon: 'Add-ons' };

// Today's plates left for every dish on one page (CLAUDE.md item 14). Stock resets at midnight
// Lagos time, so this is the caterer's first stop each morning.
export default function CatererStock() {
  const [dishes, setDishes] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api('/caterer/dishes').then(setDishes).catch((e) => setError(e.message)); }, []);

  const saved = (next) => {
    setDishes((list) => list.map((x) => (x.id === next.id ? next : x)));
    setMsg(`${next.name}: ${next.platesLeftToday} plates left today.`);
    setError('');
  };

  const notSet = dishes?.filter((d) => d.platesLeftToday === null).length ?? 0;
  return (
    <>
      <PageHead title="Today's stock" lead="Set how many plates of each dish you can sell today. A dish with no number today can't be ordered. Numbers reset at midnight." />
      {msg && <p className="ok" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!dishes && !error && <Loading label="Loading your dishes…" />}
      {dishes?.length === 0 && <Empty title="No dishes yet"><Link to="/caterer">Add a dish</Link> first.</Empty>}
      {notSet > 0 && <p className="notice">{notSet} {notSet === 1 ? 'dish has' : 'dishes have'} no plates set for today, so staff can't order {notSet === 1 ? 'it' : 'them'}.</p>}
      {dishes && ['meal', 'extra', 'addon'].map((type) => {
        const list = dishes.filter((d) => d.type === type);
        if (!list.length) return null;
        return (
          <section key={type} className="section" aria-labelledby={`stock-${type}-h`}>
            <h2 id={`stock-${type}-h`}>{TYPE_LABEL[type]}</h2>
            <ul className="dish-list">
              {list.map((d) => (
                <li key={d.id} className={`dish-row stock-row${d.soldOutToday ? ' is-sold-out' : ''}`}>
                  <DishPhoto name={d.name} url={d.photoUrl} className="thumb" />
                  <div className="dish-main">
                    <p className="dish-name">{d.name}</p>
                    {d.status !== 'Approved' && d.status !== 'No approval needed' && <span className="pill wait">{d.status}</span>}
                    {d.soldOutToday && <span className="pill">Marked sold out today</span>}
                  </div>
                  <StockInput dish={d} onSaved={saved} onError={setError} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
