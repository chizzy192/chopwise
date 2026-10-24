// npm run test:contrast — checks WCAG 2 contrast for every token pair the UI uses, in both themes,
// straight from src/styles/tokens.css (design strategy §8). Text needs 4.5:1; borders, focus rings
// and meter bars 3:1 (WCAG 1.4.11).
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const tokens = {};
for (const [, name, value] of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[name] = value.trim();

const OKLCH = /oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)/g;
// Resolve a token to its [light, dark] OKLCH values, following var() references.
function resolve(name) {
  const v = tokens[name];
  if (!v) throw new Error(`Unknown token --${name}`);
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  if (ref) return resolve(ref[1]);
  const values = [...v.matchAll(OKLCH)].map((m) => m.slice(1, 4).map(Number));
  if (values.length !== 2) throw new Error(`--${name} is not a light-dark() pair of OKLCH colours`);
  return values;
}

function luminance([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((x) => Math.min(1, Math.max(0, x)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
const ratio = (x, y) => { const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

const SURFACES = ['surface', 'surface-raised', 'surface-sunken', 'surface-float'];
const checks = [];
for (const s of SURFACES) for (const t of ['ink', 'ink-muted']) checks.push([t, s, 4.5]);
for (const s of ['surface', 'surface-raised', 'surface-float']) checks.push(['action', s, 4.5], ['field-border', s, 3], ['accent', s, 3]);
checks.push(['on-action', 'action', 4.5], ['on-action', 'action-hover', 4.5]);
for (const f of ['balanced', 'recommended', 'caution', 'restricted']) {
  checks.push([`fit-${f}`, `fit-${f}-wash`, 4.5], [`fit-${f}`, 'surface', 4.5], [`fit-${f}`, 'surface-raised', 4.5]);
}
for (const b of ['low', 'moderate', 'high', 'critical']) checks.push([`band-${b}`, 'surface-sunken', 3], [`band-${b}`, 'surface-raised', 4.5]);

let failed = 0;
for (const [fg, bg, min] of checks) {
  const [fl, fd] = resolve(fg);
  const [bl, bd] = resolve(bg);
  for (const [theme, f, b] of [['light', fl, bl], ['dark', fd, bd]]) {
    const r = ratio(f, b);
    const ok = r >= min;
    if (!ok) failed += 1;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${theme.padEnd(5)}  --${fg} on --${bg}`.padEnd(64), `${r.toFixed(2)}:1 (needs ${min}:1)`);
  }
}
console.log(`\n${checks.length * 2 - failed} of ${checks.length * 2} pairs pass`);
process.exit(failed ? 1 : 0);
