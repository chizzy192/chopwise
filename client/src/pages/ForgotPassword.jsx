import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import AuthLayout from './AuthLayout.jsx';

// Always the same answer, whether or not an account exists (the server decides; CLAUDE.md item 18).
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email');
    setBusy(true); setError('');
    try { setSent((await api('/auth/forgot-password', { method: 'POST', body: { email } })).message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout title="Reset your password" footer={<>Remembered it? <Link to="/login">Log in</Link></>}>
      {sent ? (
        <div role="status">
          <p className="ok">{sent}</p>
          <p className="hint">The link works once, for 30 minutes. Check your spam folder if it doesn't arrive.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="hint">Enter the email you use for ChopWise and we'll send you a link to choose a new password.</p>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className="wide">{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </AuthLayout>
  );
}
