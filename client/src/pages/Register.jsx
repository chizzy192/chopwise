import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ConfirmPassword, PasswordInput, passwordsMatch } from '../components.jsx';
import AuthLayout from './AuthLayout.jsx';

const MIN_PASSWORD = 10;

export default function Register({ onLogin }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { const { value } = e.target; setForm((prev) => ({ ...prev, [k]: value })); };

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email) return setError('Enter your name and email');
    if (form.password.length < MIN_PASSWORD) return setError(`Use a password of at least ${MIN_PASSWORD} characters`);
    if (!passwordsMatch(form.password, form.confirmPassword)) return setError("Passwords don't match");
    setBusy(true); setError('');
    try { onLogin(await api('/auth/register', { method: 'POST', body: form })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout title="Create a staff account" footer={<>Already registered? <Link to="/login">Log in</Link></>}>
      <p className="hint">Caterer and admin access is given by an admin.</p>
      <form onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="name">Full name</label><input id="name" value={form.name} onChange={set('name')} autoComplete="name" /></div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={set('email')} autoComplete="email" /></div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <PasswordInput id="pw" value={form.password} onChange={set('password')} autoComplete="new-password" aria-describedby="pw-hint" />
          <p className="hint" id="pw-hint">At least {MIN_PASSWORD} characters.</p>
        </div>
        <ConfirmPassword id="pw-confirm" password={form.password} value={form.confirmPassword} onChange={set('confirmPassword')} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || (form.confirmPassword.length > 0 && form.confirmPassword !== form.password)} className="wide">{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthLayout>
  );
}
