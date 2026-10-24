// CSRF defence: a state-changing request must come from the ChopWise site itself.
// The Origin header is checked first; the Referer is the fallback. A request with neither is refused.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// `exempt` paths are called server-to-server (the Paystack webhook) and prove themselves another
// way, with a signature; browsers never call them.
export function requireSameOrigin(allowedOrigin, { exempt = [] } = {}) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || exempt.includes(req.path)) return next();
    const origin = req.get('origin');
    if (origin) return origin === allowedOrigin ? next() : deny(res);
    const referer = req.get('referer');
    if (referer) {
      try {
        if (new URL(referer).origin === allowedOrigin) return next();
      } catch { /* malformed referer: refuse below */ }
    }
    return deny(res);
  };
}

function deny(res) {
  res.status(403).json({ error: "This request was blocked because it didn't come from the ChopWise site." });
}
