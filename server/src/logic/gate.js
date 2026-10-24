// 3-input majority gate (Chapter 2.1.1): G = H·P1 + H·P2 + P1·P2
function bit(v) {
  if (v !== 0 && v !== 1) throw new TypeError(`Gate inputs must be 0 or 1, got ${v}`);
  return v;
}

export function majorityGate(h, p1, p2) {
  const H = bit(h), P1 = bit(p1), P2 = bit(p2);
  const and1 = H & P1;
  const and2 = H & P2;
  const and3 = P1 & P2;
  return { and1, and2, and3, g: and1 | and2 | and3 };
}
