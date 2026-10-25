import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, CLASSES, LABELS } from '../api.js';
import { DishPhoto, FitBadge, FitIcon, formatKobo, Loading, ErrorState, Empty, Term, fitLabel } from '../components.jsx';
import { AddToCartControl } from '../cartUi.jsx';

const REDIRECT = { ONBOARDING_REQUIRED: '/onboarding', CHECKIN_REQUIRED: '/checkin' };

// One dish: photo, price, what one serving gives, and why it has its Fit signal today.
export default function DishDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    api('/catalogue').then(setData).catch((e) => (REDIRECT[e.code] ? navigate(REDIRECT[e.code], { replace: true }) : setError(e.message)));
  };
  useEffect(load, [id]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading label="Loading the dish…" />;
  const all = [...data.catalogue, ...data.unavailable, ...(data.extras ?? []), ...data.addons];
  const dish = all.find((d) => d.id === Number(id));
  if (!dish) return <Empty title="That dish isn't on today's menu">It may be awaiting approval or removed. <Link to="/order">Back to the menu</Link></Empty>;

  return (
    <article className="dish-detail">
      <p><Link to="/order">← Back to the menu</Link></p>
      <div className="dish-detail-grid">
        <DishPhoto name={dish.name} url={dish.photoUrl} className="portrait" eager />
        <div className="dish-detail-body">
          {dish.catererName && <p className="kicker">{dish.catererName}</p>}
          <h1>{dish.name}</h1>
          {dish.description && <p className="lead">{dish.description}</p>}
          <p className="price detail-price">{formatKobo(dish.priceKobo)}</p>
          <div className="row-title">
            <FitBadge fit={dish.fit} why={dish.why} dishName={dish.name} />
            {(dish.stockLabel || dish.unavailable) && <span className="pill wait">{dish.unavailable ?? dish.stockLabel}</span>}
          </div>
          {dish.why?.length > 0 && (
            <section className="panel why-panel" aria-labelledby="why-h">
              <h2 id="why-h" className="why-title"><FitIcon fit={dish.fit} /> Why it's {fitLabel(dish.fit)?.toLowerCase()}</h2>
              <ul>{dish.why.map((w) => <li key={w}>{w}</li>)}</ul>
              {dish.locked && dish.alternatives?.length > 0 && (
                <div>
                  <p>Try instead:</p>
                  <ul className="alt-list">
                    {dish.alternatives.map((a) => <li key={a.id}><Link to={`/dish/${a.id}`}>{a.name}</Link> <span className="hint">{a.text}</span></li>)}
                  </ul>
                </div>
              )}
              <p className="hint">Guidance, not medical advice.</p>
            </section>
          )}
          {dish.type !== 'addon' ? (
            <section aria-labelledby="serving-h">
              <h2 id="serving-h">One serving</h2>
              <p className="hint">Share of your <Term tech="RDI: recommended daily intake">daily limit</Term> for each food type.</p>
              <ul className="serving">
                {CLASSES.map((c) => (
                  <li key={c} className={dish.dominantClass === c ? 'is-dominant' : ''}>
                    <span>{LABELS[c]}{dish.dominantClass === c && <span className="hint"> (main class)</span>}</span>
                    <span className="serving-bar" aria-hidden="true"><span style={{ inlineSize: `${Math.min(dish[c], 100)}%` }} /></span>
                    <b className="tnum">{dish[c]}%</b>
                  </li>
                ))}
              </ul>
              {dish.isBalanced && <p className="hint">Every food type is between 5% and 35%, so this meal is balanced and never restricted.</p>}
            </section>
          ) : <p className="hint">Add-ons have no nutrition values and don't count towards your intake.</p>}
          {dish.type === 'meal' && <p className="hint">A bottle of water is added with each plate, at the standard price. You can remove it in your cart.</p>}
          {dish.type === 'extra' && <p className="hint">An extra: it counts towards your intake like a meal, and a cart still needs a meal.</p>}
          <div className="actions">
            {dish.unavailable
              ? <span className="pill">{dish.unavailable}</span>
              : <AddToCartControl dish={dish} blockedReason={dish.locked ? 'Restricted today' : null} />}
          </div>
        </div>
      </div>
    </article>
  );
}
