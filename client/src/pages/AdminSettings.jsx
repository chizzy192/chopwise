import { useEffect, useState } from 'react';
import { api, naira } from '../api.js';
import { PageHead, Loading } from '../components.jsx';

const twoDecimals = (n) => Math.round(n * 100) === n * 100;

function check(vat, fee) {
  if (vat === '' || Number.isNaN(Number(vat)) || Number(vat) < 0 || Number(vat) > 100) return 'VAT rate must be between 0% and 100%';
  if (!twoDecimals(Number(vat))) return 'Use at most 2 decimal places for the VAT rate';
  if (fee === '' || Number.isNaN(Number(fee)) || Number(fee) < 0) return 'Delivery fee must be ₦0 or more';
  if (Number(fee) > 1_000_000) return 'Delivery fee must be ₦1,000,000 or less';
  if (!twoDecimals(Number(fee))) return 'Use at most 2 decimal places for the delivery fee';
  return '';
}

export default function AdminSettings() {
  const [saved, setSaved] = useState(null);
  const [vat, setVat] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const show = (s) => { setSaved(s); setVat(String(s.vatRate)); setFee(String(s.deliveryFee)); };
  useEffect(() => { api('/admin/settings').then(show).catch((e) => setError(e.message)); }, []);

  async function save(e) {
    e.preventDefault();
    const problem = check(vat, fee);
    if (problem) { setMsg(''); return setError(problem); }
    setBusy(true);
    try {
      show(await api('/admin/settings', { method: 'PUT', body: { vatRate: Number(vat), deliveryFee: Number(fee) } }));
      setError(''); setMsg('Settings saved.');
    } catch (err) { setMsg(''); setError(err.message); }
    finally { setBusy(false); }
  }

  const feePreview = fee !== '' && !Number.isNaN(Number(fee)) ? naira.format(Number(fee)) : null;

  return (
    <>
      <PageHead title="Settings" lead="Checkout adds VAT and a flat delivery fee to every order. Changes apply to new orders and are recorded in the audit log." />
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
