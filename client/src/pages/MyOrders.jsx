import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Breakdown, ReceiptLines } from '../cartUi.jsx';
import { PageHead, Loading, Empty, ErrorState } from '../components.jsx';

const STEPS = [['paid', 'Paid'], ['preparing', 'Preparing'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered']];
const LABEL = { pending_payment: 'Waiting for payment', cancelled: 'Cancelled', ...Object.fromEntries(STEPS) };

export default function MyOrders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/orders/mine').then(setOrders).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function checkPayment(o) {
    try { await api('/orders/verify', { method: 'POST', body: { reference: o.reference } }); } catch (e) { setError(e.message); }
    load();
  }

  if (error && !orders) return <ErrorState message={error} onRetry={load} />;
  if (!orders) return <Loading label="Loading your orders…" />;
  return (
    <div className="orders-page">
      <PageHead title="My orders" lead="Status, receipt and delivery code for each order, newest first." />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="order-list">
      {orders.length === 0 && <Empty title="No orders yet"><Link to="/order">Choose a meal</Link> to place your first order.</Empty>}
      {orders.map((o) => {
        const step = STEPS.findIndex(([s]) => s === o.status);
        return (
          <section key={o.id} className="panel order-card" aria-labelledby={`o-${o.id}`}>
            <div className="page-head">
              <h2 id={`o-${o.id}`}>Order {o.id} · {o.catererName}</h2>
              <span className={`pill ${o.status === 'cancelled' ? 'stop' : o.status === 'delivered' ? 'ok' : 'wait'}`}>{LABEL[o.status]}</span>
            </div>
            <p className="hint">{new Date(o.orderedAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            {step >= 0 && (
              <ol className="steps" aria-label="Order progress">
                {STEPS.map(([s, label], i) => <li key={s} className={i <= step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>{label}</li>)}
              </ol>
            )}
            {o.deliveryCode && (
              <p className="code-line">Delivery code: <b className="delivery-code small tnum">{o.deliveryCode}</b> <span className="hint">Give it to whoever delivers your order.</span></p>
            )}
            {o.codeLocked && <p className="error">The caterer entered the wrong code too many times. An admin has been alerted.</p>}
            {o.status === 'pending_payment' && (
              <p>Not paid yet. Your plates are held until {new Date(o.reservedUntil).toLocaleTimeString('en-NG', { timeStyle: 'short' })}.{' '}
                <button className="quiet" onClick={() => checkPayment(o)}>Check payment</button></p>
            )}
            {o.status === 'cancelled' && <p className="hint">{o.cancelReason}</p>}
            <ReceiptLines items={o.items} />
            <Breakdown b={o.breakdown} />
          </section>
        );
      })}
      </div>
    </div>
  );
}
