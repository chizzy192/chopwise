import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useCart } from '../cart.jsx';
import { Breakdown } from '../cartUi.jsx';
import { formatKobo, PageHead, Loading, Empty, ErrorState } from '../components.jsx';

// Shows the breakdown exactly as the server calculated it, then hands over to Paystack.
export default function Checkout() {
  const cart = useCart();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ev = cart.evaluation && !cart.evaluation.error ? cart.evaluation : null;

  async function pay() {
    setBusy(true); setError('');
    try {
      const res = await api('/orders/checkout', { method: 'POST', body: { lines: cart.lines.map(({ dishId, quantity }) => ({ dishId, quantity })) } });
      // Paystack's own checkout page takes the payment; it sends the staff member back to /payment/return.
      window.location.assign(res.authorizationUrl);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  if (!cart.lines.length) {
    return <div className="narrow"><PageHead title="Checkout" /><Empty title="Your cart is empty"><Link to="/order">Choose a meal</Link> to start an order.</Empty></div>;
  }
  if (cart.evaluation?.error) return <ErrorState message={cart.evaluation.error} />;
  if (!ev) return <Loading label="Checking your cart…" />;

  return (
    <div className="narrow">
      <PageHead title="Checkout" lead="Worked out by ChopWise from today's prices and settings." />
      <section className="panel">
        <table>
          <thead><tr><th>Dish</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {ev.lines.flatMap((l) => [
              <tr key={l.dishId}>
                <td>{l.name}{l.type !== 'meal' && <span className="hint"> ({l.type === 'extra' ? 'extra' : 'add-on'})</span>}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{formatKobo(l.unitPriceKobo)}</td>
                <td className="num">{formatKobo(l.lineTotalKobo)}</td>
              </tr>,
              // Every meal comes with one bottle of water at no charge.
              ...(l.included ?? []).map((w) => (
                <tr key={`${l.dishId}-${w.name}`} className="included">
                  <td>{w.name}</td><td className="num">{w.quantity}</td><td className="num">₦0</td><td className="num">₦0</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        <Breakdown b={ev.breakdown} />
      </section>
      {ev.problems.map((p) => <p key={p.message} className="error" role="alert">{p.message}</p>)}
      {ev.warnings.map((w) => <p key={w.foodClass} className={`notice ${w.intakeLevel}`}>{w.message}</p>)}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint">You'll pay on Paystack's secure page. Your plates are held for 15 minutes while you pay. Online payment only.</p>
      <div className="actions">
        <button onClick={pay} disabled={busy || !ev.canCheckout}>{busy ? 'Opening Paystack…' : `Pay ${formatKobo(ev.breakdown.totalKobo)} with Paystack`}</button>
        <button className="quiet" onClick={() => cart.setOpen(true)}>Change cart</button>
      </div>
    </div>
  );
}
