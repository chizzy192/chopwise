import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useCart } from '../cart.jsx';
import { formatKobo } from '../components.jsx';

// Paystack sends the staff member here. The server checks the payment with Paystack itself;
// nothing in this page's address can mark an order paid.
export default function PaymentReturn() {
  const [params] = useSearchParams();
  const reference = params.get('reference') || params.get('trxref');
  const cart = useCart();
  const [state, setState] = useState({ checking: true });
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || !reference) return;
    asked.current = true;
    api('/orders/verify', { method: 'POST', body: { reference } })
      .then((r) => { setState(r); if (r.order.status !== 'cancelled') cart.clear(); })
      .catch((e) => setState({ error: e.message }));
  }, [reference]);

  if (!reference) return <div className="narrow"><h1>Payment</h1><p className="error">There's no payment to check. <Link to="/orders">See my orders</Link>.</p></div>;
  if (state.checking) return <div className="narrow"><h1>Checking your payment…</h1><p className="hint" role="status">Asking Paystack to confirm it.</p></div>;
  if (state.error) return <div className="narrow"><h1>We couldn't confirm the payment yet</h1><p className="error" role="alert">{state.error}</p><Link to="/orders">See my orders</Link></div>;

  const { order } = state;
  if (order.status === 'cancelled') {
    return (
      <div className="narrow">
        <h1>Payment not completed</h1>
        <p>Nothing was taken for this order, and its plates have been released. {order.cancelReason}</p>
        <div className="actions"><Link className="btn" to="/checkout">Try again</Link><Link to="/order">Back to the menu</Link></div>
      </div>
    );
  }
  return (
    <div className="narrow">
      <h1>Paid. Your order is in.</h1>
      <p>You paid {formatKobo(order.breakdown.totalKobo)}. The caterer will start preparing it.</p>
      {order.deliveryCode && (
        <section className="panel code-panel" aria-labelledby="code-h">
          <h2 id="code-h">Your delivery code</h2>
          <p className="delivery-code tnum">{order.deliveryCode}</p>
          <p className="hint">Give this code to the person who delivers your order. Don't share it before then.</p>
        </section>
      )}
      <Link className="btn" to="/orders">See my orders</Link>
    </div>
  );
}
