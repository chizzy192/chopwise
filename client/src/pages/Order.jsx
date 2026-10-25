import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, CLASSES, LABELS } from '../api.js';
import {
  IntakeMeter, Mix, DishPhoto, FitBadge, formatKobo, Loading, ErrorState, Empty, Term,
} from '../components.jsx';
import { AddToCartControl } from '../cartUi.jsx';
import { useCart } from '../cart.jsx';

// The server sends staff back to onboarding or today's check-in when either is missing.
const REDIRECT = { ONBOARDING_REQUIRED: '/onboarding', CHECKIN_REQUIRED: '/checkin' };

// Editorial home (design strategy §3): cover, index, a calm list for what fits, a broken grid for
// the rest, then uniform rows wherever ordering is the task.
export default function Order() {
  const navigate = useNavigate();
  const cart = useCart();
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api('/catalogue').then(setData).catch((e) => (REDIRECT[e.code] ? navigate(REDIRECT[e.code], { replace: true }) : setError(e.message)));
    api('/orders/mine').then(setHistory).catch(() => setHistory([]));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading label="Loading today's menu…" />;

  const byFit = (...fits) => data.catalogue.filter((m) => fits.includes(m.fit));
  const forYou = byFit('Balanced', 'Recommended');
  const rest = byFit(null, 'Caution');
  const restricted = byFit('Restricted today');
  // Extras: yoghurt has RDI values (Fit, intake, limits); extra bottled water has none.
  const extras = [...(data.extras ?? []), ...data.addons].filter((a) => !a.unavailable);
  const orderable = new Map([...data.catalogue.filter((m) => !m.locked), ...extras.filter((x) => !x.locked)].map((d) => [d.id, d]));
  const again = [...new Set(history.filter((o) => o.status !== 'cancelled' && o.status !== 'pending_payment')
    .flatMap((o) => o.items.map((i) => i.dishId)))].map((id) => orderable.get(id)).filter(Boolean).slice(0, 6);

  const index = [
    ['for-you', 'Good for you right now', forYou.length], ['available', 'Available today', rest.length],
    ['restricted', 'Not today', restricted.length], ['extras', 'Extras', extras.length],
    ['again', 'Order again', again.length], ['unavailable', 'Not available', data.unavailable.length],
  ].filter(([, , n]) => n > 0);

  return (
    <div className="home">
      <GuidanceStrip data={data} />
      {data.notifications.map((n) => <p key={`${n.foodClass}-${n.intakeLevel}`} className={`notice ${n.intakeLevel}`} role="status">{n.message}</p>)}

      <CatererCover data={data} />

      {index.length > 1 && (
        <nav className="index" aria-label="Menu sections">
          {index.map(([id, label, n]) => <a key={id} href={`#${id}`}>{label}<sup className="tnum">{n}</sup></a>)}
        </nav>
      )}

      {data.catalogue.length === 0 && extras.length === 0 && (
        <Empty title="Nothing on the menu yet today">Caterers set their plates each morning. Check back soon.</Empty>
      )}

      {forYou.length > 0 && (
        <section id="for-you" className="section" aria-labelledby="for-you-h">
          <div className="section-title"><h2 id="for-you-h">Meals that are good for you right now</h2>{cart.count > 0 && <button onClick={() => cart.setOpen(true)}>View cart ({cart.count})</button>}</div>
          <p className="summary">{summary(data.intake)}</p>
          <ul className="rows">{forYou.map((m) => <DishRow key={m.id} dish={m} />)}</ul>
        </section>
      )}

      {rest.length > 0 && (
        <section id="available" className="section" aria-labelledby="available-h">
          <div className="section-title"><h2 id="available-h">Available today</h2></div>
          <div className="broken-grid">{rest.map((m, i) => <DishTile key={m.id} dish={m} lead={i === 0} />)}</div>
        </section>
      )}

      {restricted.length > 0 && (
        <section id="restricted" className="section" aria-labelledby="restricted-h">
          <div className="section-title"><h2 id="restricted-h">Not today</h2><p className="hint">These would take a food type past the 90% cut-off, so they're locked until midnight. Try one of the suggestions.</p></div>
          <ul className="rows">{restricted.map((m) => <DishRow key={m.id} dish={m} />)}</ul>
        </section>
      )}

      {extras.length > 0 && (
        <section id="extras" className="section" aria-labelledby="extras-h">
          <div className="section-title">
            <h2 id="extras-h">Extras</h2>
            <p className="hint">Every meal already comes with a bottle of water. Yoghurt counts towards your intake; extra water doesn't.</p>
          </div>
          <ul className="rows">{extras.map((a) => <DishRow key={a.id} dish={a} />)}</ul>
        </section>
      )}

      {again.length > 0 && (
        <section id="again" className="section" aria-labelledby="again-h">
          <div className="section-title"><h2 id="again-h">Order again</h2></div>
          <ul className="rail">
            {again.map((d) => (
              <li key={d.id} className="rail-card">
                <DishPhoto name={d.name} url={d.photoUrl} />
                <Link className="dish-name" to={`/dish/${d.id}`}>{d.name}</Link>
                <FitBadge fit={d.fit} why={d.why} dishName={d.name} />
                <AddToCartControl dish={d} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.unavailable.length > 0 && (
        <section id="unavailable" className="section" aria-labelledby="unavailable-h">
          <div className="section-title"><h2 id="unavailable-h">Not available right now</h2></div>
          <ul className="rows">
            {data.unavailable.map((m) => (
              <li key={m.id} className="row is-muted">
                <DishPhoto name={m.name} url={m.photoUrl} className="thumb" />
                <div className="row-main"><span className="dish-name">{m.name}</span><Mix meal={m} /></div>
                <div className="row-end"><span className="price">{formatKobo(m.priceKobo)}</span><span className="pill">{m.unavailable}</span></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="closing-line hint">Guidance, not medical advice. Fit is worked out from today's check-in and what you've paid for today.</p>
    </div>
  );
}

const GUIDANCE_OPEN = 'chopwise.guidanceOpen';

// Today's guidance at a glance, folded into one line: the guidance level and the food class
// nearest its limit. Opening it shows the five classes and where to read more. The open/closed
// choice is remembered on this device only.
function GuidanceStrip({ data }) {
  const full = data.gate === 1;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(GUIDANCE_OPEN) === '1'; } catch { return false; } });
  const toggle = (e) => {
    const next = e.currentTarget.open;
    setOpen(next);
    try { localStorage.setItem(GUIDANCE_OPEN, next ? '1' : '0'); } catch { /* storage unavailable: just this visit */ }
  };
  return (
    <details className="guidance-strip" open={open} onToggle={toggle}>
      <summary className={`guidance-summary ${full ? 'full' : 'soft'}`}>
        <span className="display">{full ? 'Firm guidance today' : 'Gentle guidance today'}</span>
        <span className="hint guidance-line">{summary(data.intake)}</span>
        <span className="guidance-toggle" aria-hidden="true">{open ? 'Hide details' : 'Show details'}</span>
      </summary>
      <div className="guidance-body">
        <div className="guidance-chip">
          <span className="hint">
            Guidance level: <Term tech={`Technical: H = ${data.inputs.H}, P1 = ${data.inputs.P1}, P2 = ${data.inputs.P2}, so the majority gate G = ${data.gate}`}>{full ? 'firm' : 'gentle'}</Term>
          </span>
          <Link to="/checkin">See why</Link>
        </div>
        <div className="guidance-meter"><IntakeMeter intake={data.intake} bands={data.bands} compact /></div>
        <p className="hint">Updates once an order is paid. <Link to="/intake">My intake</Link></p>
      </div>
    </details>
  );
}

// "Featured chefs" are the campus caterers, with facts from the menu only.
function CatererCover({ data }) {
  const caterers = new Map();
  for (const m of [...data.catalogue, ...data.unavailable]) {
    const c = caterers.get(m.catererId) ?? { id: m.catererId, name: m.catererName ?? 'Campus caterer', dishes: 0, fits: 0, photo: null, photoName: m.name };
    if (!m.unavailable) c.dishes += 1;
    if (m.fit === 'Balanced' || m.fit === 'Recommended') c.fits += 1;
    if (!c.photo && m.photoUrl) { c.photo = m.photoUrl; c.photoName = m.name; }
    caterers.set(m.catererId, c);
  }
  if (!caterers.size) return null;
  return (
    <section className="cover" aria-labelledby="cover-h">
      <h2 id="cover-h" className="sr-only">Today's caterers</h2>
      <ul className="cover-track">
        {[...caterers.values()].map((c) => (
          <li key={c.id} className={`cover-slide ${c.photo ? '' : 'no-photo'}`}>
            {/* No stock photos: until the caterer uploads one, the cover is typographic. */}
            {c.photo && <DishPhoto name={c.photoName} url={c.photo} className="portrait cover-photo" eager />}
            <div className="cover-facts">
              <p className="kicker">Caterer</p>
              <p className="cover-name display">{c.name}</p>
              <p className="tnum">{c.dishes} dish{c.dishes === 1 ? '' : 'es'} available today</p>
              <p className="tnum">{c.fits} balanced or good for you right now</p>
              {c.fits > 0 && <a className="btn quiet" href="#for-you">See what fits you</a>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DishRow({ dish: m }) {
  return (
    <li className={`row ${m.locked ? 'is-locked' : ''}`}>
      <DishPhoto name={m.name} url={m.photoUrl} className="thumb" />
      <div className="row-main">
        <div className="row-title">
          <Link className="dish-name" to={`/dish/${m.id}`}>{m.name}</Link>
          <FitBadge fit={m.fit} why={m.why} dishName={m.name} />
          {m.stockLabel && <span className="pill wait">{m.stockLabel}</span>}
        </div>
        {m.description && <span className="why-line">{m.description}</span>}
        {m.locked && m.alternatives?.length > 0 && (
          <span className="why-line">Try instead: {m.alternatives.map((a) => `${a.name} (${a.text.toLowerCase()})`).join(', ')}</span>
        )}
        {m.locked && <Link className="alt-link" to={`/dish/${m.id}`}>See alternatives</Link>}
        {m.type !== 'addon' && <Mix meal={m} strong={m.dominantClass} />}
      </div>
      <div className="row-end">
        <span className="price">{formatKobo(m.priceKobo)}</span>
        <AddToCartControl dish={m} blockedReason={m.locked ? 'Restricted today' : null} />
      </div>
    </li>
  );
}

function DishTile({ dish: m, lead }) {
  return (
    <article className={`tile ${lead ? 'tile-lead' : ''}`}>
      <DishPhoto name={m.name} url={m.photoUrl} className={lead ? 'portrait' : ''} />
      <div className="tile-body">
        <Link className="dish-name" to={`/dish/${m.id}`}>{m.name}</Link>
        <div className="row-title">
          <span className="price">{formatKobo(m.priceKobo)}</span>
          <FitBadge fit={m.fit} why={m.why} dishName={m.name} />
          {m.stockLabel && <span className="pill wait">{m.stockLabel}</span>}
        </div>
        <Mix meal={m} strong={m.dominantClass} />
        <AddToCartControl dish={m} />
      </div>
    </article>
  );
}

// One plain line about the class nearest its limit, from the server's numbers.
function summary(intake) {
  const top = CLASSES.reduce((a, c) => (intake[c] > intake[a] ? c : a), CLASSES[0]);
  const v = Math.round(intake[top]);
  if (v === 0) return 'Nothing paid for yet today. Balanced meals are listed first.';
  if (v > 90) return `${LABELS[top]} are at ${v}% of your daily limit today, past the 90% cut-off.`;
  return `${LABELS[top]} are at ${v}% of your daily limit today; ${90 - v}% left before the 90% cut-off.`;
}
