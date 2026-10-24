// The feedback pop-up (CLAUDE.md item 17). The server decides when it shows: after the 2nd delivered
// order, once per delivered order, at most 3 times, never after it is sent. Showing it is recorded
// at once, so "Not now" (or closing) postpones it to the next delivered order.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const MAX_COMMENT = 500;
const SCALES = [
  ['orderingScore', 'How easy was ordering?', 'Very hard', 'Very easy'],
  ['guidanceScore', 'How helpful was the meal guidance?', 'Not helpful', 'Very helpful'],
];
const CHANGED = [['yes', 'Yes'], ['no', 'No'], ['sometimes', 'Sometimes']];

export default function FeedbackPrompt() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ orderingScore: null, guidanceScore: null, changedOrder: null, comment: '' });
  const [error, setError] = useState('');
  const [thanks, setThanks] = useState('');
  const [busy, setBusy] = useState(false);
  const title = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api('/feedback/prompt').then((r) => {
      if (cancelled || !r.show) return;
      setOpen(true);
      api('/feedback/prompt/shown', { method: 'POST' }).catch(() => {});
    }).catch(() => { /* no pop-up if the check fails */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    title.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const set = (k, v) => { setForm((prev) => ({ ...prev, [k]: v })); setError(''); };

  async function submit(e) {
    e.preventDefault();
    if (!form.orderingScore || !form.guidanceScore) return setError('Choose a score from 1 to 5 for both questions');
    if (!form.changedOrder) return setError('Say whether the guidance changed what you ordered');
    setBusy(true);
    try { setThanks((await api('/feedback', { method: 'POST', body: form })).message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-layer">
      <div className="scrim" aria-hidden="true" />
      <div className="modal panel" role="dialog" aria-modal="true" aria-labelledby="feedback-h">
        <h2 id="feedback-h" tabIndex={-1} ref={title}>How is ChopWise working for you?</h2>
        {thanks ? (
          <>
            <p className="ok" role="status">{thanks}</p>
            <div className="actions"><button onClick={() => setOpen(false)}>Close</button></div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="hint">Four quick questions. Only the ChopWise admin team reads your answers.</p>
            {SCALES.map(([k, question, low, high]) => (
              <fieldset key={k} className="choice-row scale-row">
                <legend>{question} <span className="hint">(1 = {low.toLowerCase()}, 5 = {high.toLowerCase()})</span></legend>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n}><input type="radio" name={k} checked={form[k] === n} onChange={() => set(k, n)} /> {n}</label>
                ))}
              </fieldset>
            ))}
            <fieldset className="choice-row">
              <legend>Did the guidance change what you ordered?</legend>
              {CHANGED.map(([v, label]) => (
                <label key={v}><input type="radio" name="changedOrder" checked={form.changedOrder === v} onChange={() => set('changedOrder', v)} /> {label}</label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="fb-comment">What should we improve? <span className="hint">(optional)</span></label>
              <textarea id="fb-comment" rows={3} maxLength={MAX_COMMENT} value={form.comment} onChange={(e) => set('comment', e.target.value)} aria-describedby="fb-count" />
              <p className="hint tnum" id="fb-count">{form.comment.length}/{MAX_COMMENT}</p>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="actions">
              <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send feedback'}</button>
              <button type="button" className="quiet" onClick={() => setOpen(false)}>Not now</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
