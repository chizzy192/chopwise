// Applies a saved light or dark choice before the page paints, so there is no flash of the wrong
// theme. A separate file (not an inline script) so the Content Security Policy can stay strict.
try {
  var saved = localStorage.getItem('chopwise.theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch (e) { /* storage unavailable: follow the system setting */ }
