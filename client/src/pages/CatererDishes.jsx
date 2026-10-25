import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, CLASSES, LABELS } from '../api.js';
import { DishPhoto, formatKobo, Loading, Empty } from '../components.jsx';
import { preparePhoto } from '../photoPrep.js';
import { prefersReducedMotion } from '../motion.js';

const blankRdi = Object.fromEntries(CLASSES.map((c) => [c, '']));

// Mirrors the server's meal.js rules so caterers see the result while typing.
function classify(f) {
  const v = Object.fromEntries(CLASSES.map((c) => [c, Number(f[c])]));
  if (CLASSES.some((c) => f[c] === '' || Number.isNaN(v[c]))) return null;
  return {
    dominant: CLASSES.reduce((b, c) => (v[c] > v[b] ? c : b), CLASSES[0]),
    balanced: CLASSES.every((c) => v[c] >= 5 && v[c] <= 35),
  };
}

const toForm = (d) => ({
  type: d?.type ?? 'meal',
  name: d?.name ?? '',
  description: d?.description ?? '',
  price: d ? String(d.priceKobo / 100) : '',
  ...(d && d.type !== 'addon' ? Object.fromEntries(CLASSES.map((c) => [c, String(d[c])])) : blankRdi),
});

const STATUS_CLASS = {
  Approved: 'ok', 'Awaiting approval': 'wait', 'Awaiting re-approval': 'wait', 'No approval needed': 'info',
};

export default function CatererDishes() {
  const [dishes, setDishes] = useState([]);
  const [editing, setEditing] = useState(null); // null, 'new' or a dish
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [loaded, setLoaded] = useState(false);
  const load = () => api('/caterer/dishes').then((d) => { setDishes(d); setLoaded(true); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function toggle(d) {
    try {
      const next = await api(`/caterer/dishes/${d.id}/availability`, { method: 'PATCH', body: { available: d.soldOutToday } });
      setDishes(dishes.map((x) => (x.id === d.id ? next : x)));
      setMsg(next.soldOutToday ? `${d.name} is sold out for today. It will be available again at midnight.` : `${d.name} is available again.`);
      setError('');
    } catch (e) { setError(e.message); }
  }

  const done = (text) => { setEditing(null); setMsg(text); setError(''); load(); };

  return (
    <>
      <div className="page-head">
        <h1>My dishes</h1>
        {!editing && <button onClick={() => { setEditing('new'); setMsg(''); }}>Add dish</button>}
      </div>
      <p className="hint">Meals and extras need an admin's approval before staff can see them. Sold out lasts for today only. Upload a photo from each dish's row, and set plates on <Link to="/caterer/stock">Today's stock</Link>.</p>
      {msg && <p className="ok" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {editing && (
        <DishForm
          key={editing === 'new' ? 'new' : editing.id}
          dish={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={done}
        />
      )}

      {!loaded && !error && <Loading label="Loading your dishes…" />}
      {loaded && dishes.length === 0 && !editing && <Empty title="No dishes yet">Add your first dish to start your library.</Empty>}
      <ul className="dish-list">
        {dishes.map((d) => (
          <li key={d.id} className={`dish-row${d.soldOutToday ? ' is-sold-out' : ''}`}>
            <DishPhoto name={d.name} url={d.photoUrl} className="thumb" />
            <div className="dish-main">
              <p className="dish-name">
                {d.name}
                {d.type !== 'meal' && <span className="pill info">{d.type === 'extra' ? 'Extra' : 'Add-on'}</span>}
              </p>
              {d.description && <p className="hint">{d.description}</p>}
              <span className={`pill ${STATUS_CLASS[d.status]}`}>{d.status}</span>
            </div>
            <span className="price tnum">{formatKobo(d.priceKobo)}</span>
            <StockInput dish={d} onSaved={(next) => { setDishes(dishes.map((x) => (x.id === d.id ? next : x))); setMsg(`${d.name}: ${next.platesLeftToday} plates left today.`); setError(''); }} onError={setError} />
            <label className="switch">
              <input type="checkbox" role="switch" checked={!d.soldOutToday} onChange={() => toggle(d)} />
              <span>{d.soldOutToday ? 'Sold out today' : 'Available'}</span>
            </label>
            <div className="dish-actions">
              <PhotoButton dish={d} onSaved={() => { setError(''); load(); }} />
              <button className="quiet" onClick={() => { setEditing(d); setMsg(''); }}>Edit</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// Upload or replace a dish photo straight from the list. A new photo never needs approval.
// Big phone photos are shrunk first (photoPrep.js); the result shows on this dish's own card.
function PhotoButton({ dish, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }
  async function pick(e) {
    const chosen = e.target.files[0];
    e.target.value = '';
    if (!chosen) return;
    setBusy(true); setNote(null);
    try {
      await uploadPhoto(dish.id, await preparePhoto(chosen));
      setNote({ ok: true, text: 'Photo saved.' });
      onSaved(`${dish.name}: photo saved.`);
    } catch (err) { setNote({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }
  return (
    <>
      <label className="btn quiet file-button">
        {busy ? 'Uploading…' : dish.photoUrl ? 'Change photo' : 'Upload photo'}
        <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={pick} disabled={busy}
          aria-label={`${dish.photoUrl ? 'Change' : 'Upload'} photo for ${dish.name}`} />
      </label>
      {note && <p className={`photo-note ${note.ok ? 'ok' : 'error'}`} role={note.ok ? 'status' : 'alert'}>{note.text}</p>}
    </>
  );
}

// Today's plates left (CLAUDE.md item 14). Empty until set each day: a dish with no stock
// today can't be ordered. Reserved plates are already taken off this number.
export function StockInput({ dish, onSaved, onError }) {
  const [value, setValue] = useState(dish.platesLeftToday ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(dish.platesLeftToday ?? ''); }, [dish.platesLeftToday]);

  async function save(e) {
    e.preventDefault();
    const n = Number(value);
    if (value === '' || !Number.isInteger(n) || n < 0 || n > 1000) return onError('Plates left must be a whole number from 0 to 1,000');
    setBusy(true);
    try { onSaved(await api(`/caterer/dishes/${dish.id}/stock`, { method: 'PUT', body: { platesLeft: n } })); }
    catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="stock-form" onSubmit={save}>
      <label htmlFor={`stock-${dish.id}`}>Plates left today</label>
      <div className="search-row">
        <input id={`stock-${dish.id}`} type="number" inputMode="numeric" min="0" max="1000" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="quiet" disabled={busy}>Save</button>
      </div>
      <span className="hint">{dish.platesLeftToday === null ? 'Not set today, so not orderable' : dish.stockLabel ?? `${dish.platesLeftToday} left`}</span>
    </form>
  );
}

function DishForm({ dish, onCancel, onSaved }) {
  const [f, setF] = useState(() => toForm(dish));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = !dish;
  const isMeal = f.type !== 'addon'; // meals and extras carry RDI values
  const set = (k) => (e) => { const { value } = e.target; setF((prev) => ({ ...prev, [k]: value })); setError(''); };
  const p = isMeal ? classify(f) : null;

  // Changing a nutrition value on an approved meal sends it back for approval: say so before saving.
  const rdiChanged = dish && dish.type !== 'addon' && CLASSES.some((c) => Number(f[c]) !== Number(dish[c]));
  const willResubmit = rdiChanged && dish.isApproved;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // The form sits above the dish list; opened from a card further down, it would be out of sight.
  const formRef = useRef(null);
  const headingRef = useRef(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  async function pickPhoto(e) {
    const chosen = e.target.files[0];
    if (!chosen) return;
    try {
      const ready = await preparePhoto(chosen);
      setFile(ready); setPreview(URL.createObjectURL(ready)); setError('');
    } catch (err) { e.target.value = ''; setError(err.message); }
  }

  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return setError('Enter the dish name');
    const naira = Number(f.price);
    if (f.price === '' || Number.isNaN(naira) || naira < 1) return setError('Enter a price of at least ₦1');
    if (naira > 100_000) return setError('The price must be ₦100,000 or less');
    if (Math.round(naira * 100) !== naira * 100) return setError('Use at most 2 decimal places for the price');
    if (isMeal) {
      for (const c of CLASSES) {
        const n = Number(f[c]);
        if (f[c] === '' || Number.isNaN(n) || n < 0 || n > 100) return setError(`${LABELS[c]} must be a number from 0 to 100`);
      }
    }
    const body = {
      name: f.name, description: f.description.trim() || null, priceKobo: Math.round(naira * 100),
      ...(isMeal ? Object.fromEntries(CLASSES.map((c) => [c, Number(f[c])])) : {}),
    };
    setBusy(true);
    try {
      let saved;
      let resent = false;
      if (isNew) saved = await api('/caterer/dishes', { method: 'POST', body: { type: f.type, ...body } });
      else ({ dish: saved, sentForApproval: resent } = await api(`/caterer/dishes/${dish.id}`, { method: 'PUT', body }));
      if (file) await uploadPhoto(saved.id, file);
      const name = saved.name;
      onSaved(isNew
        ? (isMeal ? `${name} is saved and waiting for an admin's approval.` : `${name} is saved and on the menu.`)
        : (resent ? `${name} is saved and sent back for approval. Staff won't see it until an admin approves it.` : `${name} is saved.`));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="panel dish-form" onSubmit={submit} noValidate ref={formRef}>
      <h2 tabIndex={-1} ref={headingRef}>{isNew ? 'Add a dish' : `Edit ${dish.name}`}</h2>
      {isNew && (
        <fieldset className="choice-row">
          <legend className="sr-only">Type of dish</legend>
          <label><input type="radio" name="type" checked={f.type === 'meal'} onChange={() => setF((prev) => ({ ...prev, type: 'meal' }))} /> Meal</label>
          <label><input type="radio" name="type" checked={f.type === 'extra'} onChange={() => setF((prev) => ({ ...prev, type: 'extra' }))} /> Extra with nutrition values (for example yoghurt)</label>
          <label><input type="radio" name="type" checked={f.type === 'addon'} onChange={() => setF((prev) => ({ ...prev, type: 'addon' }))} /> Add-on without nutrition values (for example extra bottled water)</label>
        </fieldset>
      )}
      <div className="form-grid">
        <div className="field"><label htmlFor="d-name">Name</label><input id="d-name" maxLength={150} value={f.name} onChange={set('name')} /></div>
        <div className="field">
          <label htmlFor="d-price">Price (₦)</label>
          <input id="d-price" type="number" inputMode="decimal" min="1" step="0.01" value={f.price} onChange={set('price')} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="d-desc">Description (optional)</label>
        <textarea id="d-desc" rows={2} maxLength={200} value={f.description} onChange={set('description')} aria-describedby="d-desc-count" />
        <p className="hint tnum" id="d-desc-count">{f.description.length}/200</p>
      </div>

      {isMeal ? (
        <>
          <p className="hint">How much of the daily recommended intake (RDI) one serving provides for each food class.</p>
          <div className="grid-5">
            {CLASSES.map((c) => (
              <div className="field" key={c}>
                <label htmlFor={`d-${c}`}>{LABELS[c]} (%)</label>
                <input id={`d-${c}`} type="number" inputMode="decimal" min="0" max="100" value={f[c]} onChange={set(c)} />
              </div>
            ))}
          </div>
          <p className="preview" aria-live="polite">
            {p ? <>Dominant class: <b>{LABELS[p.dominant]}</b>. Balanced: <b>{p.balanced ? 'Yes' : 'No'}</b>.</> : 'Enter all five values to see the dominant class and whether it is balanced.'}
          </p>
          {willResubmit && (
            <p className="notice" role="status">
              Changing nutrition values sends this meal back for approval. Staff won't see it until an admin approves it again.
            </p>
          )}
        </>
      ) : (
        <p className="hint">Add-ons have no nutrition values, need no approval and don't count towards anyone's intake.</p>
      )}

      <div className="field photo-field">
        <DishPhoto name={f.name} url={preview || dish?.photoUrl} className="thumb" />
        <div>
          <label htmlFor="d-photo">{dish?.photoUrl ? 'Replace photo' : 'Photo (optional)'}</label>
          <input id="d-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPhoto} />
          <p className="hint">JPEG, PNG or WebP. Big phone photos are made smaller before upload. A new photo doesn't need approval.</p>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : willResubmit ? 'Save and send for approval' : 'Save dish'}</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

async function uploadPhoto(id, file) {
  const form = new FormData();
  form.append('photo', file);
  try {
    await api(`/caterer/dishes/${id}/photo`, { method: 'PUT', body: form });
  } catch (err) {
    throw new Error(`The dish is saved, but the photo wasn't: ${err.message}`);
  }
}
