import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { PasswordInput } from '../components.jsx';
import AuthLayout from './AuthLayout.jsx';

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { const { value } = e.target; setForm((prev) => ({ ...prev, [k]: value })); };

  async function submit(e) {
    e.preventDefault();
    if (!form.email || !form.password) return setError('Enter your email and password');
    setBusy(true); setError('');
    try { onLogin(await api('/auth/login', { method: 'POST', body: form })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout title="Log in" footer={<>New staff member? <Link to="/register">Create an account</Link></>}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={form.email} onChange={set('email')} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <PasswordInput id="password" autoComplete="current-password" value={form.password} onChange={set('password')} />
          <p className="forgot-link"><Link to="/forgot-password">Forgot password?</Link></p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="wide">{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </AuthLayout>
  );
}
