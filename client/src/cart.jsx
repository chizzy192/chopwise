// The cart (CLAUDE.md item 5): one store shared by the add controls, the cart badge and the cart
// sheet. It holds only dish ids and quantities plus display details; Fit, warnings, limits and
// totals always come from POST /api/cart/evaluate. The cart empties at midnight Lagos time.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const keyFor = (userId) => `chopwise.cart.${userId}`;
const lagosToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());

function load(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved?.date === lagosToday() && Array.isArray(saved.lines) ? saved.lines : [];
  } catch { return []; }
}
function save(key, lines) {
  try { localStorage.setItem(key, JSON.stringify({ date: lagosToday(), lines })); } catch { /* storage unavailable: the cart lasts for this visit */ }
}

// What the server needs: dish, quantity and, for a meal whose bottled water was removed, water: false.
export const requestLines = (lines) => lines.map(({ dishId, quantity, water }) => ({ dishId, quantity, ...(water === false ? { water: false } : {}) }));

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

// Keyed by user, so two people on one browser never share a cart.
export function CartProvider({ userId, children }) {
  const key = keyFor(userId);
  const [lines, setLines] = useState(() => load(key));
  const [evaluation, setEvaluation] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [open, setOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const day = useRef(lagosToday());

  useEffect(() => { save(key, lines); }, [key, lines]);

  // Midnight in Lagos: yesterday's cart is gone, like yesterday's stock and check-in.
  useEffect(() => {
    const t = setInterval(() => {
      if (lagosToday() !== day.current) { day.current = lagosToday(); setLines([]); }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Ask the server about the cart whenever it changes (debounced so fast taps send one request).
  useEffect(() => {
    if (!lines.length) { setEvaluation(null); return undefined; }
    let cancelled = false;
    setEvaluating(true);
    const t = setTimeout(() => {
      api('/cart/evaluate', { method: 'POST', body: { lines: requestLines(lines) } })
        .then((r) => { if (!cancelled) setEvaluation(r); })
        // 409: a line is Restricted today. The body is still the full evaluation, so the cart can show it.
        .catch((e) => {
          if (cancelled) return;
          if (e.status === 409 && e.data?.lines) setEvaluation({ ...e.data, error: undefined }); // its error repeats problems[0]
          else setEvaluation({ error: e.message, code: e.code });
        })
        .finally(() => { if (!cancelled) setEvaluating(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [lines]);

  const quantityOf = useCallback((dishId) => lines.find((l) => l.dishId === dishId)?.quantity ?? 0, [lines]);

  /** Sets a dish's quantity (0 removes it). Returns 'conflict' if the dish is from another caterer. */
  const setQuantity = useCallback((dish, quantity, { replace = false } = {}) => {
    // One caterer per cart (CLAUDE.md item 15): a dish from another caterer asks to start over.
    const otherCaterer = lines.length > 0 && lines[0].catererId !== dish.catererId;
    if (otherCaterer && !replace && quantity > 0) return 'conflict';
    const base = otherCaterer ? [] : lines;
    // A meal keeps its bottled water choice (on unless removed) when its quantity changes.
    const water = base.find((l) => l.dishId === dish.id)?.water ?? true;
    const line = { dishId: dish.id, quantity, name: dish.name, priceKobo: dish.priceKobo, catererId: dish.catererId, type: dish.type, photoUrl: dish.photoUrl, water };
    const next = quantity <= 0
      ? base.filter((l) => l.dishId !== dish.id)
      : base.some((l) => l.dishId === dish.id) ? base.map((l) => (l.dishId === dish.id ? line : l)) : [...base, line];
    if (quantity > quantityOf(dish.id)) setBump((n) => n + 1);
    setLines(next);
    return 'ok';
  }, [lines, quantityOf]);

  /** Keeps or removes the bottled water that comes with a meal line. */
  const setWater = useCallback((dishId, on) => setLines((ls) => ls.map((l) => (l.dishId === dishId ? { ...l, water: on } : l))), []);

  const clear = useCallback(() => setLines([]), []);
  const count = lines.reduce((s, l) => s + l.quantity, 0);

  const value = useMemo(() => ({
    lines, count, evaluation, evaluating, open, setOpen, bump, quantityOf, setQuantity, setWater, clear,
  }), [lines, count, evaluation, evaluating, open, bump, quantityOf, setQuantity, setWater, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
