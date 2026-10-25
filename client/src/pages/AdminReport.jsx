import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { api, CLASSES, LABELS } from '../api.js';
import { formatKobo, PageHead, Loading, ErrorState, Empty } from '../components.jsx';
import { tokenColor, useTheme } from '../theme.js';

export default function AdminReport() {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const theme = useTheme();
  const load = () => { setError(''); api('/admin/report').then(setR).catch((e) => setError(e.message)); };
  useEffect(load, []);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!r) return <Loading label="Loading today's report…" />;

  // Recharts needs literal colours; they come from the tokens, so both themes stay correct.
  const c = {
    bar: tokenColor('--action'), grid: tokenColor('--rule'), ink: tokenColor('--ink-muted'),
    high: tokenColor('--fit-caution'), critical: tokenColor('--fit-restricted'),
  };
  const bars = CLASSES.map((k) => ({ name: LABELS[k].split(' ')[0], value: r.averageIntake[k] }));

  return (
    <>
      <PageHead title="Today's report" lead="Paid orders, revenue and intake for today (Africa/Lagos)." />
      <div className="stats">
        <div className="stat"><b>{formatKobo(r.revenueTodayKobo)}</b>Revenue today</div>
        <div className="stat"><b>{r.ordersToday}</b>Paid orders today</div>
        <div className="stat"><b>{r.cancelledToday}</b>Cancelled today</div>
        <div className="stat"><b>{r.activeUsers}</b>Staff with intake today</div>
        <div className="stat"><b>{r.notifications.High || 0}</b>High warnings</div>
        <div className="stat"><b>{r.notifications.Critical || 0}</b>Critical warnings</div>
        <div className="stat"><b>{r.notifications.Over || 0}</b>Past the daily limit</div>
      </div>
      <FeedbackSummary f={r.feedback} />
      <div className="report-grid">
        <section className="panel" aria-labelledby="avg-h">
          <h2 id="avg-h">Average intake per staff member</h2>
          <p className="hint">% of daily RDI. Lines mark the 70% warning and 90% limit.</p>
          {r.activeUsers === 0 ? <Empty title="No intake recorded today" /> : (
            <div className="chart" key={theme}>
              <ResponsiveContainer>
                <BarChart data={bars} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="name" tickLine={false} stroke={c.ink} />
                  <YAxis tickLine={false} axisLine={false} stroke={c.ink} />
                  <Tooltip formatter={(v) => `${v}% of RDI`} />
                  <ReferenceLine y={70} stroke={c.high} strokeDasharray="4 3" />
                  <ReferenceLine y={90} stroke={c.critical} strokeDasharray="4 3" />
                  <Bar isAnimationActive={false} dataKey="value" fill={c.bar} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="top-h">
          <h2 id="top-h">Most ordered meals</h2>
          {r.topMeals.length === 0 ? <Empty title="No paid orders yet" /> : (
            <table><tbody>{r.topMeals.map((m) => <tr key={m.name}><td>{m.name}</td><td className="num">{m.n}</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
    </>
  );
}

// Staff feedback (CLAUDE.md item 17). Comments are shown to admins here and nowhere else.
const SPLIT = [['yes', 'Yes'], ['no', 'No'], ['sometimes', 'Sometimes']];
function FeedbackSummary({ f }) {
  return (
    <section className="panel feedback-summary" aria-labelledby="fb-h">
      <h2 id="fb-h">Staff feedback</h2>
      {f.responses === 0 ? <Empty title="No feedback yet">Staff are asked after their second delivered order.</Empty> : (
        <>
          <div className="stats">
            <div className="stat"><b>{f.responses}</b>Responses</div>
            <div className="stat"><b>{f.averageOrdering} / 5</b>Ease of ordering</div>
            <div className="stat"><b>{f.averageGuidance} / 5</b>Helpfulness of guidance</div>
          </div>
          <h3>Did the guidance change what they ordered?</h3>
          <ul className="receipt">
            {SPLIT.map(([k, label]) => (
              <li key={k}><span>{label}</span><span className="tnum">{f.changedOrder[k]} ({Math.round((f.changedOrder[k] / f.responses) * 100)}%)</span></li>
            ))}
          </ul>
          <h3>Latest comments</h3>
          <p className="hint">Visible to admins only.</p>
          {f.latestComments.length === 0 ? <p className="hint">No comments yet.</p> : (
            <ul className="comments">
              {f.latestComments.map((c) => (
                <li key={`${c.createdAt}-${c.comment}`}>
                  <p>{c.comment}</p>
                  <p className="hint">{new Date(c.createdAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
