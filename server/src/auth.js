// Cookie sessions: a signed JWT in an httpOnly cookie. The token holds the user id and the user's
// session version; the role and version are read from the database on every request, so a role
// change takes effect at once and raising the version signs out every session of that user.
import jwt from 'jsonwebtoken';
import { jwtSecret, isProduction } from './config.js';

export const SESSION_COOKIE = 'chopwise_session';
export const SESSION_HOURS = 8;
export const PUBLIC = 'public';

const cookieOptions = () => ({ httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/' });

export function signSession(userId, version = 0) {
  return jwt.sign({ sub: String(userId), ver: version }, jwtSecret(), { expiresIn: `${SESSION_HOURS}h` });
}

export function setSessionCookie(res, userId, version = 0) {
  res.cookie(SESSION_COOKIE, signSession(userId, version), { ...cookieOptions(), maxAge: SESSION_HOURS * 3600_000 });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * Default-deny guard. `roles` is PUBLIC or a list of roles; anything else is refused when the
 * app is built. sessionUser(id) loads { id, name, email, role, sessionVersion } or null.
 */
export function guard(roles, sessionUser) {
  return async (req, res, next) => {
    if (roles === PUBLIC) return next();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: 'Please log in' });
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret());
    } catch {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    }
    try {
      req.user = await sessionUser(Number(payload.sub));
    } catch (err) {
      return next(err);
    }
    if (!req.user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Please log in' });
    }
    // Signed out everywhere after a password reset or change.
    if ((payload.ver ?? 0) !== (req.user.sessionVersion ?? 0)) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Your password was changed, so please log in again.' });
    }
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this page' });
    next();
  };
}
