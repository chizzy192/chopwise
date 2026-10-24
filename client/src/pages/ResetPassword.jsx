import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { ConfirmPassword, PasswordInput, passwordsMatch } from '../components.jsx';
import AuthLayout from './AuthLayout.jsx';

const MIN_PASSWORD = 10;

// Opened from the emailed link (/reset-password?token=…). The token works once, for 30 minutes.
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { const { value } = e.target; setForm((prev) => ({ ...prev, [k]: value })); };
  const matches = passwordsMatch(form.password, form.confirmPassword);

  async function submit(e) {
    e.preventDefault();
    if (form.password.length < MIN_PASSWORD) return setError(`Use a password of at least ${MIN_PASSWORD} characters`);
    if (!matches) return setError("Passwords don't match");
    setBusy(true); setError('');
    try { setDone((await api('/auth/reset-password', { method: 'POST', body: { token, ...form } })).message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return (
      <AuthLayout title="Reset your password">
        <p className="error" role="alert">This reset link isn't complete. Open the link from your email again, or ask for a new one.</p>
        <Link className="btn" to="/forgot-password">Ask for a new link</Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" footer={<>Link not working? <Link to="/forgot-password">Ask for a new one</Link></>}>
      {done ? (
        <div role="status">
          <p className="ok">{done}</p>
          <Link className="btn" to="/login">Log in</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <PasswordInput id="new-password" autoComplete="new-password" value={form.password} onChange={set('password')} aria-describedby="new-password-hint" />
            <p className="hint" id="new-password-hint">At least {MIN_PASSWORD} characters.</p>
          </div>
          <ConfirmPassword id="confirm-password" password={form.password} value={form.confirmPassword} onChange={set('confirmPassword')} />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !matches} className="wide">{busy ? 'Saving…' : 'Save new password'}</button>
        </form>
      )}
    </AuthLayout>
  );
}
