import { useEffect, useId, useRef, useState } from 'react';
import { CLASSES, LABELS } from './api.js';
import { setTheme, useTheme } from './theme.js';

export const formatKobo = (kobo) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(kobo / 100);

// ---------- Fit signal (design strategy §6): shape + word + colour, never colour alone ----------
const FIT_KEY = { Balanced: 'balanced', Recommended: 'recommended', Caution: 'caution', 'Restricted today': 'restricted' };
// Plain words on screen (CLAUDE.md item 16). The server's state names stay the same and show in
// the badge's tooltip as the technical name.
export const FIT_LABEL = { Recommended: 'Good for you right now', Caution: 'Careful', 'Restricted today': 'Not today' };
export const fitLabel = (fit) => FIT_LABEL[fit] ?? fit;

export function FitIcon({ fit }) {
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true, focusable: 'false' };
  switch (fit) {
    case 'Balanced': return <svg {...common}><circle cx="7" cy="7" r="5.5" fill="currentColor" /></svg>;
    case 'Recommended': return <svg {...common}><path d="M2 10 7 4.5 12 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'Caution': return <svg {...common}><path d="M7 1.5 13 12.5H1Z" fill="currentColor" /><path d="M7 5.5v3.2" stroke="var(--surface-float)" strokeWidth="1.6" strokeLinecap="round" /><circle cx="7" cy="10.6" r=".9" fill="var(--surface-float)" /></svg>;
    case 'Restricted today': return <svg {...common}><rect x="2.5" y="6" width="9" height="7" rx="1.5" fill="currentColor" /><path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
    default: return null;
  }
}

/**
 * The Fit badge. With reasons, it is a button that opens a small popover explaining why, citing
 * the numbers the server gave (as % of the daily limit). Esc or a click elsewhere closes it.
 */
export function FitBadge({ fit, why = [], dishName }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);
  if (!fit) return null;
  const technical = fitLabel(fit) !== fit;
  const body = <><FitIcon fit={fit} /><span>{fitLabel(fit)}</span></>;
  if (!why.length) return technical ? <Term tech={`Technical name: ${fit}`}><span className={`fit fit-${FIT_KEY[fit]}`}>{body}</span></Term> : <span className={`fit fit-${FIT_KEY[fit]}`}>{body}</span>;
  return (
    <span className="fit-wrap" ref={ref}>
      <button type="button" className={`fit fit-${FIT_KEY[fit]}`} aria-expanded={open} aria-controls={id}
        aria-label={`${fitLabel(fit)}${dishName ? ` for ${dishName}` : ''}: why?`} aria-describedby={technical ? `${id}-tech` : undefined} onClick={() => setOpen(!open)}>
        {body}<span className="fit-why" aria-hidden="true">Why?</span>
        {technical && <span role="tooltip" id={`${id}-tech`} className="term-tip">Technical name: {fit}</span>}
      </button>
      {open && (
        <span className="popover" id={id} role="note">
          {why.map((w) => <span key={w} className="popover-line">{w}</span>)}
          <span className="popover-foot">Guidance, not medical advice.</span>
        </span>
      )}
    </span>
  );
}

// ---------- Dish photos (§5): 20 px radius, ratio reserved, lazy; a named placeholder until uploaded ----------
// Thumbnails are too small to read a name, so their placeholder shows the dish's initials.
const initials = (name = '') => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !['and', 'with'].includes(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function DishPhoto({ name, url, className = '', eager = false }) {
  if (url) return <img className={`dish-photo ${className}`} src={url} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />;
  const thumb = className.includes('thumb');
  return (
    <div className={`dish-photo photo-ph ${className}`} aria-hidden="true">
      <span>{thumb ? initials(name) : name || 'No photo yet'}</span>
    </div>
  );
}

// ---------- Intake ----------
// Five food-class bars with the real 40 / 70 / 90 % thresholds marked.
export function IntakeMeter({ intake, bands, compact = false }) {
  const scaleMax = 120;
  const pos = (v) => `${(Math.min(v, scaleMax) / scaleMax) * 100}%`;
  return (
    <div className={`meter ${compact ? 'compact' : ''}`}>
      <ul>
        {CLASSES.map((c) => (
          <li key={c}>
            <div className="meter-row">
              <span>{compact ? LABELS[c].split(' ')[0] : LABELS[c]}</span>
              <span className={`band band-${bands[c].toLowerCase()}`}>{bands[c]}</span>
              <b className="tnum">{Math.round(intake[c])}%</b>
            </div>
            <div className="track" role="meter" aria-label={`${LABELS[c]} intake`} aria-valuemin={0} aria-valuemax={scaleMax}
              aria-valuenow={Math.round(intake[c])} aria-valuetext={`${Math.round(intake[c])}% of your daily limit, ${bands[c]}`}>
              <div className={`fill band-${bands[c].toLowerCase()}`} style={{ inlineSize: pos(intake[c]) }} />
              {[40, 70, 90].map((t) => <div key={t} className="tick" style={{ insetInlineStart: pos(t) }} />)}
            </div>
          </li>
        ))}
      </ul>
      {!compact && (
        <div className="scale" aria-hidden="true">
          {[40, 70, 90].map((t) => <span key={t} style={{ insetInlineStart: `${(t / scaleMax) * 100}%` }}>{t}%</span>)}
        </div>
      )}
    </div>
  );
}

// A plain word with its technical term in a small tooltip, shown on hover or keyboard focus.
export function Term({ tech, children }) {
  const id = useId();
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable so keyboard users can read the tooltip
    <span className="term" tabIndex={0} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className="term-tip">{tech}</span>
    </span>
  );
}

// Today's three checks and the guidance level, in plain words (technical names in the tooltips).
// "Earlier meal" (P2) checks the older meal on its own; "Last two meals" (P1) checks both together.
export function GateLights({ inputs, gate }) {
  const items = [['H', 'Health check'], ['P1', 'Last two meals'], ['P2', 'Earlier meal']];
  return (
    <div className="gate">
      {items.map(([k, label]) => (
        <span key={k} className={`light ${inputs[k] ? 'on' : ''}`}>
          <b>{inputs[k] ? 'Yes' : 'No'}</b>
          <Term tech={`${k} = ${inputs[k]}`}>{label}</Term>
        </span>
      ))}
      <span className={`gate-out ${gate ? 'full' : 'soft'}`}>
        <span>Guidance level</span>
        <b><Term tech={`Majority gate G = ${gate}`}>{gate ? 'Firm' : 'Gentle'}</Term></b>
      </span>
    </div>
  );
}

// The five values of one serving (% of the daily limit), in one quiet line.
export function Mix({ meal, strong }) {
  return (
    <span className="mix tnum">
      {CLASSES.map((c) => <span key={c} className={strong === c ? 'strong' : ''}>{LABELS[c].split(' ')[0]} {meal[c]}%</span>)}
    </span>
  );
}

// ---------- Page furniture ----------
export function PageHead({ title, lead, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="state state-loading" role="status">
      <span className="skeleton" aria-hidden="true" />
      <span className="skeleton short" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <p className="hint">{label}</p>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children && <div className="hint">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">Something went wrong</p>
      <p className="hint">{message}</p>
      {onRetry && <button className="quiet" onClick={onRetry}>Try again</button>}
    </div>
  );
}

// A password field with a show/hide switch. Pass id, value, onChange, autoComplete and the like.
export function PasswordInput(props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-field">
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="text password-toggle" onClick={() => setShown((s) => !s)}
        aria-controls={props.id} aria-pressed={shown} aria-label={shown ? 'Hide password' : 'Show password'}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="quiet icon-button" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor" /><g stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></g></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" fill="currentColor" /></svg>
      )}
    </button>
  );
}

// "Confirm password", with "Passwords don't match" under it as soon as the two differ.
export function ConfirmPassword({ id, password, value, onChange, label = 'Confirm password' }) {
  const mismatch = value.length > 0 && value !== password;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <PasswordInput id={id} autoComplete="new-password" value={value} onChange={onChange}
        aria-invalid={mismatch} aria-describedby={mismatch ? `${id}-error` : undefined} />
      {mismatch && <p className="field-error" id={`${id}-error`} role="alert">Passwords don't match</p>}
    </div>
  );
}
export const passwordsMatch = (a, b) => a.length > 0 && a === b;
