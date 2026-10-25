import { useEffect, useState } from 'react';
import { api, naira } from '../api.js';
import { PageHead, Loading } from '../components.jsx';

const twoDecimals = (n) => Math.round(n * 100) === n * 100;

function check(vat, fee, water) {
  if (vat === '' || Number.isNaN(Number(vat)) || Number(vat) < 0 || Number(vat) > 100) return 'VAT rate must be between 0% and 100%';
  if (!twoDecimals(Number(vat))) return 'Use at most 2 decimal places for the VAT rate';
  if (fee === '' || Number.isNaN(Number(fee)) || Number(fee) < 0) return 'Delivery fee must be ₦0 or more';
  if (Number(fee) > 1_000_000) return 'Delivery fee must be ₦1,000,000 or less';
  if (!twoDecimals(Number(fee))) return 'Use at most 2 decimal places for the delivery fee';
  if (water === '' || Number.isNaN(Number(water)) || Number(water) < 0) return 'Bottled water price must be ₦0 or more';
  if (Number(water) > 100_000) return 'Bottled water price must be ₦100,000 or less';
  if (!twoDecimals(Number(water))) return 'Use at most 2 decimal places for the bottled water price';
  return '';
}

export default function AdminSettings() {
  const [saved, setSaved] = useState(null);
  const [vat, setVat] = useState('');
  const [fee, setFee] = useState('');
  const [water, setWater] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const show = (s) => { setSaved(s); setVat(String(s.vatRate)); setFee(String(s.deliveryFee)); setWater(String(s.waterPrice)); };
  useEffect(() => { api('/admin/settings').then(show).catch((e) => setError(e.message)); }, []);

  async function save(e) {
    e.preventDefault();
    const problem = check(vat, fee, water);
    if (problem) { setMsg(''); return setError(problem); }
    setBusy(true);
    try {
      show(await api('/admin/settings', { method: 'PUT', body: { vatRate: Number(vat), deliveryFee: Number(fee), waterPrice: Number(water) } }));
      setError(''); setMsg('Settings saved.');
    } catch (err) { setMsg(''); setError(err.message); }
    finally { setBusy(false); }
  }

  const feePreview = fee !== '' && !Number.isNaN(Number(fee)) ? naira.format(Number(fee)) : null;

  return (
    <>
      <PageHead title="Settings" lead="Checkout adds VAT and a flat delivery fee to every order, and offers a bottle of water with each meal at the price below. Changes apply to new orders and are recorded in the audit log." />
      {!saved && !error && <Loading label="Loading settings…" />}
      <form onSubmit={save} className="panel form-narrow" noValidate>
        <div className="field">
          <label htmlFor="vat">VAT rate (%)</label>
          <input id="vat" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="fee">Delivery fee (₦)</label>
          <input id="fee" type="number" inputMode="decimal" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} aria-describedby="fee-preview" />
          {feePreview && <p className="hint tnum" id="fee-preview">Shown to staff as {feePreview}</p>}
        </div>
        <div className="field">
          <label htmlFor="water">Bottled water with each meal (₦)</label>
          <input id="water" type="number" inputMode="decimal" min="0" step="0.01" value={water} onChange={(e) => setWater(e.target.value)} aria-describedby="water-hint" />
          <p className="hint" id="water-hint">Charged per plate. Staff can remove it from any meal in their cart.</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {msg && <p className="ok" role="status">{msg}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        {saved?.updatedAt && (
          <p className="hint spaced">
            Last changed {new Date(saved.updatedAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
            {saved.updatedBy ? ` by ${saved.updatedBy}` : ' at setup'}.
          </p>
        )}
      </form>
    </>
  );
}
