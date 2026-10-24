import { Link } from 'react-router-dom';
import { ThemeToggle } from '../components.jsx';

// Shared frame for log in and sign up: the promise on one side, the form on the other.
export default function AuthLayout({ title, children, footer }) {
  return (
    <div className="auth-page">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="auth-side">
        <Link to="/" className="brand">Chop<b>Wise</b></Link>
        <p className="auth-quote display">Campus meals that keep your day in balance.</p>
        <p className="hint">For staff of the University of Nigeria, Nsukka.</p>
      </aside>
      <main id="main" tabIndex={-1} className="auth-main">
        <div className="auth-tools"><ThemeToggle /></div>
        <div className="auth-form">
          <h1>{title}</h1>
          {children}
          {footer && <p className="hint auth-footer">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
