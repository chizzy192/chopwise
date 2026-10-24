import { useState } from 'react';
import { api } from '../api.js';
import { ConfirmPassword, PasswordInput } from '../components.jsx';
import AuthLayout from './AuthLayout.jsx';

const MIN_PASSWORD = 10;

// Shown instead of every other page while the account has a temporary password from an admin
// (the server refuses everything else with PASSWORD_CHANGE_REQUIRED until it is changed).
export default function ChangePassword({ forced, onDone, onLogout }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { const { value } = e.target; setForm((prev) => ({ ...prev, [k]: value })); };

  async function submit(e) {
    e.preventDefault();
    if (!form.currentPassword) return setError(forced ? 'Enter the temporary password you were given' : 'Enter your current password');
    if (form.newPassword.length < MIN_PASSWORD) return setError(`Use a new password of at least ${MIN_PASSWORD} characters`);
    if (form.newPassword !== form.confirm) return setError("The new passwords don't match");
    setBusy(true); setError('');
    try {
      await onDone(await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } }));
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <AuthLayout
      title={forced ? 'Choose your own password' : 'Change your password'}
      footer={<>Not you? <button type="button" className="text" onClick={onLogout}>Log out</button></>}
    >
      {forced && <p className="hint">An admin gave you a temporary password. Choose your own before you continue.</p>}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="current-password">{forced ? 'Temporary password' : 'Current password'}</label>
          <PasswordInput id="current-password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <PasswordInput id="new-password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} aria-describedby="new-password-hint" />
          <p className="hint" id="new-password-hint">At least {MIN_PASSWORD} characters, different from the {forced ? 'temporary' : 'current'} one.</p>
        </div>
        <ConfirmPassword id="confirm-password" label="Confirm new password" password={form.newPassword} value={form.confirm} onChange={set('confirm')} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || (form.confirm.length > 0 && form.confirm !== form.newPassword)} className="wide">{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </AuthLayout>
  );
}
