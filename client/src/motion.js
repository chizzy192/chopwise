// The motion tokens for JavaScript (design strategy §7). Values live in styles/tokens.css, so CSS
// and JS can never disagree; reduced motion is already applied there.
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// A duration token in milliseconds, e.g. ms('--dur-exit').
export const ms = (name) => parseFloat(css(name)) || 0;

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Waits for an exit animation to finish before removing an element.
export const afterExit = (fn) => setTimeout(fn, ms('--dur-exit'));
