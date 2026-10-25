// Cart controls (design strategy §7): the add-to-cart morph with a slot-roll counter, the cart
// badge and the cart sheet. Everything shown about Fit, limits and totals comes from the server.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from './cart.jsx';
import { DishPhoto, FitBadge, FitIcon, formatKobo, fitLabel } from './components.jsx';
import { afterExit } from './motion.js';
import { CLASSES, LABELS } from './api.js';

const MAX_QUANTITY = 2; // plates of one dish per order (the server enforces it too)

// Fixed footprint in every state, so nothing around it moves when "Add" becomes − 1 +.
export function AddToCartControl({ dish, blockedReason }) {
  const cart = useCart();
  const qty = cart.quantityOf(dish.id);
  // Restricted inside the cart (another line pushed this dish's class past 90%): it can only be reduced or removed.
  const cartLocked = qty > 0 && cart.evaluation?.lines?.some((l) => l.dishId === dish.id && l.locked);
  const max = cartLocked ? qty - 1 : Math.min(dish.platesLeft ?? MAX_QUANTITY, MAX_QUANTITY);
  const [direction, setDirection] = useState('up');

  function change(next) {
    setDirection(next > qty ? 'up' : 'down');
    if (cart.setQuantity(dish, next) === 'conflict') {
      if (window.confirm(`Your cart has dishes from another caterer. Start a new cart with ${dish.name}?`)) {
        cart.setQuantity(dish, next, { replace: true });
      }
    }
  }

  if (blockedReason && qty === 0) {
    // "Not today" (Restricted today): a dashed, square-cornered lock, never mistaken for the Add button.
    const restricted = blockedReason === 'Restricted today';
    const label = fitLabel(blockedReason);
    return (
      <button className={`add-control is-blocked ${restricted ? 'is-restricted' : ''}`} disabled aria-label={`${dish.name}: ${label}`}>
        {restricted && <FitIcon fit="Restricted today" />}{label}
      </button>
    );
  }
  return (
    <span className="add-wrap">
    <div className={`add-control ${qty > 0 ? 'is-counting' : ''}`}>
      <button className="add-idle" onClick={() => change(1)} tabIndex={qty > 0 ? -1 : 0} aria-hidden={qty > 0} aria-label={`Add ${dish.name} to cart`}>
        Add
      </button>
      <div className="add-counter" aria-hidden={qty === 0}>
        <button onClick={() => change(qty - 1)} tabIndex={qty > 0 ? 0 : -1} aria-label={`Remove one ${dish.name}`}>−</button>
        <span className="qty-slot" aria-live="polite" aria-label={`${qty} ${dish.name} in cart`}>
          <span key={qty} className={`slot-num roll-${direction}`}>{qty}</span>
        </span>
        <button onClick={() => change(qty + 1)} tabIndex={qty > 0 ? 0 : -1} disabled={qty >= max} aria-label={`Add one ${dish.name}`}
          title={cartLocked ? 'Not today' : qty >= max ? (max === MAX_QUANTITY ? `Up to ${MAX_QUANTITY} plates per order` : `Only ${max} left`) : undefined}>+</button>
      </div>
    </div>
    {/* In normal flow under the fixed-size control, so it never covers what's below. */}
    {cartLocked && <span className="qty-note is-restricted" role="status"><FitIcon fit="Restricted today" /> Not today: reduce or remove</span>}
    {!cartLocked && qty > 0 && qty >= max && (
      <span className="qty-note" role="status">{max === MAX_QUANTITY ? `Up to ${MAX_QUANTITY} plates per order` : `Only ${max} left`}</span>
    )}
    </span>
  );
}

export function CartBadge() {
  const cart = useCart();
  return (
    <button className="quiet cart-badge" onClick={() => cart.setOpen(true)} aria-label={`Cart, ${cart.count} item${cart.count === 1 ? '' : 's'}`}>
      Cart
      <span key={cart.bump} className={`cart-count tnum ${cart.bump ? 'bump' : ''}`}>{cart.count}</span>
    </button>
  );
}

export function CartSheet() {
  const cart = useCart();
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);
  const title = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    if (!cart.open) return undefined;
    returnTo.current = document.activeElement;
    title.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cart.open]);

  function close() {
    setClosing(true);
    afterExit(() => { setClosing(false); cart.setOpen(false); returnTo.current?.focus?.(); });
  }

  if (!cart.open) return null;
  const ev = cart.evaluation && !cart.evaluation.error ? cart.evaluation : null;
  const lines = ev ? ev.lines.map((l) => ({ ...l, id: l.dishId, priceKobo: l.unitPriceKobo })) : cart.lines.map((l) => ({ ...l, id: l.dishId }));

  return (
    <div className={`sheet-layer ${closing ? 'is-closing' : ''}`}>
      <div className="scrim" onClick={close} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <div className="sheet-head">
          <h2 id="cart-title" tabIndex={-1} ref={title}>Your cart</h2>
          <button className="quiet" onClick={close}>Close</button>
        </div>
        {lines.length === 0 ? <p className="hint">Your cart is empty. Add a dish from the menu.</p> : (
          <>
            <ul className="cart-lines">
              {lines.map((l) => (
                <li key={l.id} className="cart-line">
                  <DishPhoto name={l.name} url={l.photoUrl} className="thumb small" />
                  <div>
                    <p className="dish-name">{l.name}</p>
                    <div className="row-title">
                      <FitBadge fit={l.fit} why={l.why} dishName={l.name} />
                      {l.stockLabel && <span className="pill wait">{l.stockLabel}</span>}
                    </div>
                    {l.type === 'meal' && <WaterSwitch line={l} />}
                  </div>
                  <div className="cart-line-end">
                    <AddToCartControl dish={l} />
                    {ev && <span className="tnum hint">{formatKobo(l.lineTotalKobo)}</span>}
                  </div>
                </li>
              ))}
            </ul>
            {cart.evaluation?.error && <p className="error" role="alert">{cart.evaluation.error}</p>}
            {ev?.problems.map((p) => <p key={p.message} className="notice Critical" role="alert">{p.message}</p>)}
            {ev?.warnings.map((w) => <p key={w.foodClass} className={`notice ${w.intakeLevel}`}>{w.message}</p>)}
            {ev && (
              <>
                <p className="hint projected">
                  After this order: {CLASSES.map((c) => `${LABELS[c].split(' ')[0]} ${Math.round(ev.projected[c])}%`).join(' · ')}
                </p>
                <Breakdown b={ev.breakdown} />
              </>
            )}
            <div className="actions">
              <button disabled={!ev?.canCheckout || cart.evaluating} onClick={() => { cart.setOpen(false); navigate('/checkout'); }}>
                {cart.evaluating ? 'Checking your cart…' : 'Go to checkout'}
              </button>
              <button className="quiet" onClick={cart.clear}>Empty cart</button>
            </div>
            <p className="hint">Guidance, not medical advice.</p>
          </>
        )}
      </div>
    </div>
  );
}

const TYPE_NOTE = { extra: ' (extra)', addon: ' (add-on)' };

// The bottled water that comes with a meal line (CLAUDE.md item 6): on by default, charged at the
// admin's price per plate, and removable. The price comes from the server's cart check.
function WaterSwitch({ line }) {
  const cart = useCart();
  const on = cart.lines.find((l) => l.dishId === line.id)?.water !== false;
  // Priced once the server has checked the cart; until then the line only knows on or off.
  const w = line.water && typeof line.water === 'object' ? line.water : null;
  return (
    <label className="switch water-switch">
      <input type="checkbox" role="switch" checked={on} onChange={(e) => cart.setWater(line.id, e.target.checked)}
        aria-label={`Bottled water with ${line.name}`} />
      <span>
        Bottled water{w ? <span className="tnum"> {formatKobo(w.unitPriceKobo)} × {w.quantity}</span> : ''}
        {w && <span className="tnum water-total">{on ? formatKobo(w.lineTotalKobo) : 'Removed'}</span>}
      </span>
    </label>
  );
}

// Order lines as the server sent them. Each meal line is followed by the water bought with it.
export function ReceiptLines({ items, prices = true }) {
  return (
    <ul className="receipt">
      {items.flatMap((i) => [
        <li key={i.dishId}>
          <span>{i.quantity} × {i.name}{TYPE_NOTE[i.type] && <span className="hint">{TYPE_NOTE[i.type]}</span>}</span>
          {prices && <span className="tnum">{formatKobo(i.lineTotalKobo)}</span>}
        </li>,
        ...(i.water && i.water.chosen !== false ? [
          <li key={`${i.dishId}-water`} className="included">
            <span>{i.water.quantity} × {i.water.name}</span>{prices && <span className="tnum">{formatKobo(i.water.lineTotalKobo)}</span>}
          </li>,
        ] : []),
      ])}
    </ul>
  );
}

// The breakdown exactly as the server worked it out (whole kobo).
export function Breakdown({ b }) {
  return (
    <dl className="breakdown tnum">
      <div><dt>Subtotal</dt><dd>{formatKobo(b.subtotalKobo)}</dd></div>
      <div><dt>VAT ({b.vatRate}%)</dt><dd>{formatKobo(b.vatKobo)}</dd></div>
      <div><dt>Delivery fee</dt><dd>{formatKobo(b.deliveryFeeKobo)}</dd></div>
      <div className="total"><dt>Total</dt><dd>{formatKobo(b.totalKobo)}</dd></div>
    </dl>
  );
}
