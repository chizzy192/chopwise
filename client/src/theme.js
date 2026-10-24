// Light and dark themes: the system setting until the user picks one, then their saved choice.
import { useEffect, useState } from 'react';

const KEY = 'chopwise.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return media().matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable: lasts for this visit */ }
  window.dispatchEvent(new Event('chopwise-theme'));
}

// Re-renders when the theme changes, by the toggle or by the system.
export function useTheme() {
  const [theme, setState] = useState(currentTheme);
  useEffect(() => {
    const update = () => setState(currentTheme());
    const m = media();
    m.addEventListener('change', update);
    window.addEventListener('chopwise-theme', update);
    return () => { m.removeEventListener('change', update); window.removeEventListener('chopwise-theme', update); };
  }, []);
  return theme;
}

// A token's resolved colour for libraries that need a literal value (the report chart). Reading the
// custom property directly would return the unresolved light-dark(...) text, so a probe element
// lets the browser pick the current theme's value.
export function tokenColor(name) {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}
