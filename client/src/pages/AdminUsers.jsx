import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { PageHead, PasswordInput, Loading } from '../components.jsx';

const ROLES = ['staff', 'caterer', 'admin'];
const ROLE_LABEL = { staff: 'Staff', caterer: 'Caterer', admin: 'Admin' };
const ROLE_EFFECT = {
  staff: 'They will order meals and lose any caterer or admin access.',
  caterer: 'They will manage their own meal library and lose any admin access.',
  admin: 'They will have full control, including roles, settings and the audit log.',
};
const EMPTY = { name: '', email: '', password: '' };
const MIN_PASSWORD = 10;

const timeLeft = (until) => Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60_000));

export default function AdminUsers({ me }) {
  const [users, setUsers] = useState(null); // null while loading
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(null); // { user, role } awaiting confirmation
  const confirmTitle = useRef(null);
  const returnTo = useRef(null); // the role dropdown that opened the pop-up
  // Move focus to the question when the pop-up opens, so keyboard and screen reader users hear it
  // first; Escape cancels it.
  useEffect(() => {
    if (!pending) return undefined;
    confirmTitle.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') cancelRole(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending]);
  const cancelRole = () => { setPending(null); returnTo.current?.focus(); };
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [resetting, setResetting] = useState(null); // the caterer whose password is being reset
  const [tempPassword, setTempPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const resetTitle = useRef(null);
  useEffect(() => { if (resetting) resetTitle.current?.focus(); }, [resetting]);

  const load = (search = q) => api(`/admin/users${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`)
    .then(setUsers).catch((e) => { setUsers((prev) => prev ?? []); setError(e.message); });
  useEffect(() => { load(''); }, []);

  const done = (text) => { setMsg(text); setError(''); load(); };

  async function confirmRole() {
    const { user, role } = pending;
    try {
      await api(`/admin/users/${user.id}/role`, { method: 'PATCH', body: { role } });
      setPending(null);
      done(`${user.name} is now ${role === 'admin' ? 'an' : 'a'} ${role}.`);
    } catch (e) { setPending(null); setMsg(''); setError(e.message); }
  }

  async function unlock(user) {
    try { await api(`/admin/users/${user.id}/unlock`, { method: 'POST' }); done(`${user.name}'s account is unlocked.`); }
    catch (e) { setMsg(''); setError(e.message); }
  }

  async function resetPassword(e) {
    e.preventDefault();
    if (tempPassword.length < MIN_PASSWORD) return setResetError(`Use a temporary password of at least ${MIN_PASSWORD} characters`);
    try {
      await api(`/admin/users/${resetting.id}/reset-password`, { method: 'POST', body: { password: tempPassword } });
      const { name } = resetting;
      setResetting(null); setTempPassword(''); setResetError('');
      done(`${name}'s password is reset. Give them the temporary password; they must change it when they next log in.`);
    } catch (err) { setResetError(err.message); }
  }

  async function addCaterer(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email) return setFormError('Enter a name and email');
    if (form.password.length < MIN_PASSWORD) return setFormError(`Use a temporary password of at least ${MIN_PASSWORD} characters`);
    try {
      await api('/admin/caterers', { method: 'POST', body: form });
      setForm(EMPTY); setFormError('');
      done(`Caterer account created for ${form.email}. Give them the temporary password; they must change it when they first log in.`);
    } catch (err) { setFormError(err.message); }
  }

  return (
    <>
      <PageHead title="Users" lead="Change who is staff, caterer or admin, and unlock accounts after too many failed logins." />

      <form role="search" className="search" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <label htmlFor="user-q">Search by name or email</label>
        <div className="search-row">
          <input id="user-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit">Search</button>
          {q && <button type="button" className="quiet" onClick={() => { setQ(''); load(''); }}>Clear</button>}
        </div>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}

      {pending && (
        <div className="modal-layer">
          <div className="scrim" onClick={cancelRole} aria-hidden="true" />
          <div className="modal panel confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-h" aria-describedby="confirm-d">
            <button type="button" className="quiet icon-button modal-close" onClick={cancelRole} aria-label="Close, keep the current role">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <h2 id="confirm-h" tabIndex={-1} ref={confirmTitle}>Make {pending.user.name} {pending.role === 'admin' ? 'an' : 'a'} {pending.role}?</h2>
            <p id="confirm-d">
              Their role changes from {pending.user.role} to {pending.role}. {ROLE_EFFECT[pending.role]} The change is recorded in the audit log.
            </p>
            <div className="actions">
              <button onClick={confirmRole}>Change role</button>
              <button className="quiet" onClick={cancelRole}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {resetting && (
        <form className="confirm panel" onSubmit={resetPassword} aria-labelledby="reset-h" noValidate>
          <h2 id="reset-h" tabIndex={-1} ref={resetTitle}>Reset {resetting.name}'s password</h2>
          <p className="hint">Their old password stops working at once. They must choose their own password when they next log in. The reset is recorded in the audit log (the password is not).</p>
          <div className="field">
            <label htmlFor="temp-password">New temporary password</label>
            <PasswordInput id="temp-password" autoComplete="new-password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} aria-describedby="temp-password-hint" />
            <p className="hint" id="temp-password-hint">At least {MIN_PASSWORD} characters.</p>
          </div>
          {resetError && <p className="error" role="alert">{resetError}</p>}
          <div className="actions">
            <button type="submit">Reset password</button>
            <button type="button" className="quiet" onClick={() => { setResetting(null); setTempPassword(''); setResetError(''); }}>Cancel</button>
          </div>
        </form>
      )}

      {users === null && <Loading label="Loading users…" />}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Account</th></tr></thead>
          <tbody>
            {users?.length === 0 && <tr><td colSpan={4} className="hint">No users match that search.</td></tr>}
            {users?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{u.id === me.id && <span className="hint"> (you)</span>}</td>
                <td>{u.email}</td>
                <td>
                  {u.id === me.id ? ROLE_LABEL[u.role] : (
                    <select
                      aria-label={`Role for ${u.name}`}
                      value={u.role}
                      onChange={(e) => { setMsg(''); setError(''); returnTo.current = e.target; setPending({ user: u, role: e.target.value }); }}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                </td>
                <td>
                  {u.locked ? (
                    <span className="lock-status">
                      Locked, {timeLeft(u.locked_until)} min left{' '}
                      <button className="quiet" onClick={() => unlock(u)}>Unlock</button>
                    </span>
                  ) : u.mustChangePassword ? 'Temporary password' : u.failed_attempts > 0 ? `${u.failed_attempts} failed login${u.failed_attempts > 1 ? 's' : ''}` : 'Active'}
                  {u.role === 'caterer' && (
                    <button className="quiet cell-action" onClick={() => { setMsg(''); setError(''); setResetError(''); setTempPassword(''); setResetting(u); }}
                      aria-label={`Reset password for ${u.name}`}>Reset password</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">You can't change your own role. Ask another admin to do it.</p>

      <form onSubmit={addCaterer} className="panel form-narrow spaced" noValidate>
        <h2>Create a caterer account</h2>
        <p className="hint">For a caterer who hasn't signed up. Staff who already have an account can be made caterers in the table above.</p>
        {[['name', 'Business or caterer name', 'text', 'organization'], ['email', 'Email', 'email', 'off']].map(([k, l, t, ac]) => (
          <div className="field" key={k}>
            <label htmlFor={`c-${k}`}>{l}</label>
            <input id={`c-${k}`} type={t} autoComplete={ac} value={form[k]} onChange={(e) => { const { value } = e.target; setForm((prev) => ({ ...prev, [k]: value })); }} />
          </div>
        ))}
        <div className="field">
          <label htmlFor="c-password">Temporary password</label>
          <PasswordInput id="c-password" autoComplete="new-password" value={form.password} onChange={(e) => { const { value } = e.target; setForm((prev) => ({ ...prev, password: value })); }} />
        </div>
        <p className="hint">At least {MIN_PASSWORD} characters. The caterer must change it when they first log in.</p>
        {formError && <p className="error" role="alert">{formError}</p>}
        <button type="submit">Create caterer account</button>
      </form>
    </>
  );
}
