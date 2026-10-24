import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { api, CLASSES, LABELS } from '../api.js';
import { IntakeMeter, PageHead, Loading, ErrorState, Empty, Term } from '../components.jsx';
import { tokenColor, useTheme } from '../theme.js';

export default function Intake() {
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    api('/intake/today').then(setData).catch((e) => setError(e.message));
    api('/orders/today').then(setOrders).catch(() => {});
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading label="Loading your intake…" />;
  const total = CLASSES.reduce((s, c) => s + data.intake[c], 0);

  return (
    <>
      <PageHead title="Today's intake" lead={<>Percentages of your <Term tech="RDI: recommended daily intake">daily limit</Term>. Paid orders count; it resets at midnight.</>} />
      <div className="intake-grid">
        <section className="panel" aria-labelledby="meter-h">
          <h2 id="meter-h">By food class</h2>
          <IntakeMeter intake={data.intake} bands={data.bands} />
        </section>
        <IntakeDonut intake={data.intake} total={total} />
        <section className="panel" aria-labelledby="left-h">
          <h2 id="left-h">Left before the 90% cut-off</h2>
          <ul className="receipt">
            {CLASSES.map((c) => (
              <li key={c}><span>{LABELS[c]}</span><span className="tnum">{data.intake[c] > 90 ? 'Past the cut-off' : `${Math.round((90 - data.intake[c]) * 10) / 10}%`}</span></li>
            ))}
          </ul>
        </section>
        <section className="panel" aria-labelledby="today-h">
          <h2 id="today-h">Paid for today</h2>
          {total === 0 || orders.length === 0
            ? <Empty title="Nothing yet today">Your intake shows here after your first paid order. <Link to="/order">Choose a meal</Link></Empty>
            : (
              <ul className="receipt">
                {orders.map((o) => (
                  <li key={`${o.order_id}-${o.name}`}>
                    <span>{o.quantity > 1 ? `${o.quantity} × ` : ''}{o.name}</span>
                    <span className="hint tnum">{new Date(o.ordered_at).toLocaleTimeString('en-NG', { timeStyle: 'short' })}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </>
  );
}

// What today's intake is made of: each food class's share of everything paid for today. A donut
// for part-to-whole at a glance (five parts); the legend beside it carries every number, so colour
// is never the only way to read it. Colours are --chart-1…5 (validated, see tokens.css).
function IntakeDonut({ intake, total }) {
  const theme = useTheme();
  const slices = CLASSES.map((c, i) => ({
    name: LABELS[c],
    value: Math.round(intake[c] * 10) / 10,
    share: total ? Math.round((intake[c] / total) * 100) : 0,
    color: `--chart-${i + 1}`,
  }));
  return (
    <section className="panel" aria-labelledby="donut-h">
      <h2 id="donut-h">What today's intake is made of</h2>
      {total === 0 ? <Empty title="Nothing eaten yet today">The chart fills in after your first paid order.</Empty> : (
        <div className="donut-wrap">
          <div className="donut" key={theme} role="img" aria-label={`Share of today's intake: ${slices.map((s) => `${s.name} ${s.share}%`).join(', ')}`}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" isAnimationActive={false}
                  stroke={tokenColor('--surface-raised')} strokeWidth={2}>
                  {slices.map((s) => <Cell key={s.name} fill={tokenColor(s.color)} />)}
                </Pie>
                <Tooltip
                  formatter={(v, n, p) => [`${v}% of your daily limit (${p.payload.share}% of today)`, n]}
                  contentStyle={{ background: tokenColor('--surface-float'), border: `1px solid ${tokenColor('--rule')}`, borderRadius: 8, color: tokenColor('--ink') }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="donut-legend">
            {slices.map((s) => (
              <li key={s.name}>
                <span className="swatch" style={{ background: `var(${s.color})` }} aria-hidden="true" />
                <span>{s.name}<span className="of-limit tnum">{s.value}% of your daily limit</span></span>
                <b className="tnum">{s.share}%</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
