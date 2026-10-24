import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ReceiptLines } from '../cartUi.jsx';
import { PageHead, Loading, Empty, ErrorState, formatKobo } from '../components.jsx';

const LABEL = { paid: 'Paid', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered' };
const ACTION = { preparing: 'Start preparing', out_for_delivery: 'Send out for delivery' };
// The board's columns, left to right (CLAUDE.md item 13). The list holds today's orders only.
const COLUMNS = [['paid', 'Paid'], ['preparing', 'Preparing'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered today']];
const EMPTY_COLUMN = {
  paid: 'New paid orders appear here.', preparing: 'Nothing being prepared.', out_for_delivery: 'Nothing out for delivery.', delivered: 'Nothing delivered yet today.',
};

// Today's paid orders for this caterer's dishes (CLAUDE.md item 13).
export default function CatererOrders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [codes, setCodes] = useState({});
  const [notes, setNotes] = useState({});

  const load = () => api('/caterer/orders').then(setOrders).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  const replace = (o) => setOrders((list) => list.map((x) => (x.id === o.id ? o : x)));

  async function advance(o) {
    try { replace(await api(`/caterer/orders/${o.id}/status`, { method: 'PATCH', body: { status: o.nextStatus } })); setNotes((prev) => ({ ...prev, [o.id]: '' })); }
    catch (e) { setNotes((prev) => ({ ...prev, [o.id]: e.message })); }
  }

  async function deliver(e, o) {
    e.preventDefault();
    try {
      replace(await api(`/caterer/orders/${o.id}/deliver`, { method: 'POST', body: { code: codes[o.id] ?? '' } }));
      setNotes((prev) => ({ ...prev, [o.id]: '' }));
    } catch (err) {
      setNotes((prev) => ({ ...prev, [o.id]: err.message }));
      setCodes((prev) => ({ ...prev, [o.id]: '' }));
      if (err.status === 423) load();
    }
  }

  if (error && !orders) return <ErrorState message={error} onRetry={load} />;
  if (!orders) return <Loading label="Loading today's orders…" />;
  return (
    <>
      <PageHead title="Today's orders" lead="Paid orders for your dishes. To mark an order delivered, enter the 4-digit code the staff member gives you." />
      {orders.length === 0 && <Empty title="No paid orders yet today">New orders appear here as soon as they are paid. This page refreshes every 30 seconds.</Empty>}
      {orders.length > 0 && (
      <div className="board">
        {COLUMNS.map(([status, title]) => {
          const list = orders.filter((o) => o.status === status);
          return (
            <section key={status} className="board-col" aria-labelledby={`col-${status}`}>
              <h2 id={`col-${status}`} className="board-title">{title} <span className="board-count tnum">{list.length}</span></h2>
              <div className="board-cards">
                {list.length === 0 && <p className="board-empty hint">{EMPTY_COLUMN[status]}</p>}
        {list.map((o) => (
          <section key={o.id} className="panel order-card" aria-labelledby={`co-${o.id}`}>
            <div className="page-head">
              <h3 id={`co-${o.id}`}>Order {o.id} · {o.staffName}</h3>
              <span className={`pill ${o.status === 'delivered' ? 'ok' : 'wait'}`}>{LABEL[o.status]}</span>
            </div>
            <ReceiptLines items={o.items} prices={false} />
            <p className="order-total"><span>Total</span><b className="tnum">{formatKobo(o.breakdown.totalKobo)}</b></p>
            {o.status !== 'delivered' && (
              o.status === 'out_for_delivery' ? (
                o.codeLocked ? <p className="error">The code is locked after 5 wrong attempts. An admin has been alerted.</p> : (
                  <form className="code-form" onSubmit={(e) => deliver(e, o)}>
                    <label htmlFor={`code-${o.id}`}>Delivery code</label>
                    <input id={`code-${o.id}`} inputMode="numeric" autoComplete="off" pattern="\d{4}" maxLength={4}
                      value={codes[o.id] ?? ''} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setCodes((prev) => ({ ...prev, [o.id]: v })); }} />
                    <button type="submit" disabled={(codes[o.id] ?? '').length !== 4}>Mark delivered</button>
                    <p className="hint">{o.codeAttemptsLeft} attempt{o.codeAttemptsLeft === 1 ? '' : 's'} left.</p>
                  </form>
                )
              ) : <button onClick={() => advance(o)}>{ACTION[o.nextStatus]}</button>
            )}
            {notes[o.id] && <p className="error" role="alert">{notes[o.id]}</p>}
          </section>
        ))}
              </div>
            </section>
          );
        })}
      </div>
      )}
    </>
  );
}
