import { useState } from 'react';
import { Link } from 'react-router-dom';
// The demo runs the server's own rule code, so it shows exactly what ChopWise would decide.
import { majorityGate } from '../../../server/src/logic/gate.js';
import { fitFor, emptyIntake } from '../../../server/src/logic/engine.js';
import { classifyMeal } from '../../../server/src/logic/meal.js';
import { FitBadge, GateLights, ThemeToggle, formatKobo } from '../components.jsx';

// The standalone landing page for logged-out visitors (CLAUDE.md item 12). Plain words first; the
// technical terms (H, P1, P2, G, RDI, bands) are left to the written report.

// Example meals (% of the daily limit per serving). The first two are from the sample menu.
const EXAMPLES = [
  { id: 1, name: 'Balanced lunch bowl', note: 'rice, beans, fish, greens', carb: 30, protein: 28, fat: 14, vitamin: 22, mineral: 15 },
  { id: 2, name: 'Jollof rice and chicken', note: 'mostly carbohydrates', carb: 48, protein: 22, fat: 18, vitamin: 7, mineral: 5 },
  { id: 3, name: 'Pepper soup with fish', note: 'almost no carbohydrates', carb: 0, protein: 38, fat: 14, vitamin: 16, mineral: 18 },
].map((m) => ({ ...m, ...classifyMeal(m) }));
const DEMO_INTAKE = { ...emptyIntake(), carb: 95 };

const STEPS = [
  ['Tell us your last two meals', 'Once a day, before your first order. ChopWise fills them in from your orders; change them if you ate elsewhere.'],
  ['We set your guidance level', 'Your health check and those two meals decide whether today\'s guidance is gentle (suggestions and warnings) or firm (some dishes locked until midnight).'],
  ['Order with guidance', 'Every dish says how it suits your day: Balanced, Good for you right now, Careful or Not today, with a short reason.'],
  ['Pay online and receive with your delivery code', 'Pay with Paystack. Give your 4-digit code to the person who brings your food.'],
];

// The three questions of the demo, in plain words. The technical name is in brackets for examiners.
// "Heavy" means the meal took a food type over 70% of the daily limit.
const QUESTIONS = [
  ['H', 'Do you have a diet-related health condition, such as diabetes or high blood pressure?'],
  ['P1', 'Was your last meal heavy?'],
  ['P2', 'Was the meal before that heavy?'],
];

const LEVELS = [
  ['Plenty of room', 'Up to 40%', 'Meals rich in this food type are good for you right now.', 'The same.'],
  ['Getting there', '41–70%', 'Meals with the food types you\'ve had little of are good for you right now.', 'The same.'],
  ['Close to the limit', '71–90%', 'A warning, with how much is left before 90%. Only meals that stay within it are good for you right now.', 'The same.'],
  ['Over the limit', 'Over 90%', 'Dishes mostly made of this food type say "Careful", with a strong warning. You can still order anything.', 'Meals mostly made of this food type say "Not today" and are locked until midnight, with other dishes suggested. Balanced meals stay available.'],
];

const ROLES = [
  ['Staff', 'Answer one health question, check in each day, order with guidance, pay online, and follow your orders and what you\'ve eaten today.'],
  ['Caterers', 'Keep a dish list with photos, prices and nutrition values, set how many plates are left each day, and mark orders delivered with the staff member\'s code.'],
  ['Admin', 'Approve dishes and their nutrition values, manage who is a caterer or admin, set VAT and the delivery fee, and read the daily report and the record of admin actions.'],
];

// Example receipt: sample prices, VAT 7.5% on the subtotal, ₦500 delivery. Each meal comes with one
// bottle of water at ₦0; yoghurt is an extra (it counts toward intake) and the extra water an add-on.
const RECEIPT = [
  ['Grilled fish and vegetables', 'meal', 1, 350000], ['Jollof rice and chicken', 'meal', 1, 250000],
  ['Yoghurt (1 cup)', 'extra', 1, 100000], ['Extra bottled water', 'add-on', 1, 30000],
];
const SUBTOTAL = RECEIPT.reduce((s, [, , q, p]) => s + q * p, 0);
const VAT = Math.floor((SUBTOTAL * 750 + 5000) / 10000);
const FEE = 50000;

export default function Landing() {
  const [inputs, setInputs] = useState({ H: 1, P1: 1, P2: 0 });
  const g = majorityGate(inputs.H, inputs.P1, inputs.P2).g;
  const yes = inputs.H + inputs.P1 + inputs.P2;
  const flip = (k) => setInputs({ ...inputs, [k]: inputs[k] ? 0 : 1 });

  return (
    <div className="landing">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar landing-bar">
        <span className="brand">Chop<b>Wise</b></span>
        <div className="topbar-end">
          <ThemeToggle />
          <Link className="btn quiet" to="/login">Log in</Link>
          <Link className="btn" to="/register">Create account</Link>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-h">
          <div className="hero-copy">
            <p className="kicker">For staff of the University of Nigeria, Nsukka</p>
            <h1 id="hero-h" className="hero-title">Lunch delivered to your office, with gentle guidance to keep your day balanced.</h1>
            <p className="lead">
              Order from the campus caterers and pay online. Each day ChopWise asks about your last two meals, then shows
              which dishes are good for you right now, so you stay within your daily limit.
            </p>
            <div className="actions">
              <Link className="btn" to="/register">Create account</Link>
              <Link className="btn quiet" to="/login">Log in</Link>
            </div>
          </div>
          <aside className="hero-card" aria-label="An example day">
            <p className="kicker">Example: today's check-in</p>
            <p className="display hero-card-title">Firm guidance today</p>
            <GateLights inputs={{ H: 1, P1: 1, P2: 0 }} gate={1} />
            <p className="hint">The health check and the last two meals both said yes. Two yeses are enough for firm guidance.</p>
          </aside>
        </section>

        <section className="section" aria-labelledby="day-h">
          <div className="section-title"><h2 id="day-h">How a day works</h2></div>
          <ol className="day-steps">
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <span className="step-no" aria-hidden="true">{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section gate-demo" aria-labelledby="demo-h">
          <div className="section-title">
            <h2 id="demo-h">Try it</h2>
            <p className="hint">Answer three quick questions and see how ChopWise would guide your lunch.</p>
          </div>
          <p className="demo-setting">In this example you've already had a lot of carbohydrates today: 95% of your daily limit.</p>
          <div className="demo-grid">
            <div className="panel demo-controls">
              <fieldset>
                <legend>Three quick questions</legend>
                {QUESTIONS.map(([k, question]) => (
                  <label key={k} className="switch demo-switch">
                    <input type="checkbox" role="switch" checked={inputs[k] === 1} onChange={() => flip(k)} aria-describedby={`ans-${k}`} />
                    <span>{question} <b id={`ans-${k}`} className="demo-answer">{inputs[k] ? 'Yes' : 'No'}</b></span>
                  </label>
                ))}
              </fieldset>
              <p className={`gate-verdict ${g ? 'full' : 'soft'}`} aria-live="polite">
                <span className="verdict-level">{g ? 'Firm guidance' : 'Gentle guidance'}.</span>
                {g
                  ? ` ${yes} of 3 answers are yes, so ChopWise guides you firmly: meals that would push a food type past 90% are locked for today.`
                  : ` ${yes === 0 ? 'No' : 'Only 1'} of 3 answers ${yes === 1 ? 'is' : 'are'} yes, so ChopWise only suggests and warns. Nothing is locked.`}
              </p>
            </div>
            <ul className="demo-meals" aria-label="How ChopWise would show these lunches">
              {EXAMPLES.map((m) => {
                const f = fitFor({ gate: g, intake: DEMO_INTAKE, meal: m });
                return (
                  <li key={m.id} className={`demo-meal ${f.locked ? 'is-locked' : ''}`}>
                    <p className="dish-name">{m.name}</p>
                    <p className="hint">{m.note}: carbohydrates {m.carb}%, protein {m.protein}% of your daily limit</p>
                    <FitBadge fit={f.fit} why={f.why} dishName={m.name} />
                    <p className="demo-outcome">{f.locked ? 'Locked today; other dishes are suggested.' : 'You can order it.'}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="section" aria-labelledby="bands-h">
          <div className="section-title">
            <h2 id="bands-h">What ChopWise does as your day fills up</h2>
            <p className="hint">For each food type, measured against your daily limit.</p>
          </div>
          <div className="table-wrap panel">
            <table className="bands-table">
              <thead><tr><th scope="col">Today so far</th><th scope="col">Amount</th><th scope="col">Gentle guidance</th><th scope="col">Firm guidance</th></tr></thead>
              <tbody>
                {LEVELS.map(([level, range, gentle, firm]) => (
                  <tr key={level}>
                    <th scope="row">{level}</th>
                    <td className="tnum nowrap">{range}</td><td>{gentle}</td><td>{firm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section" aria-labelledby="roles-h">
          <div className="section-title"><h2 id="roles-h">Who does what</h2></div>
          <ul className="roles">
            {ROLES.map(([role, text]) => <li key={role} className="panel"><h3>{role}</h3><p>{text}</p></li>)}
          </ul>
        </section>

        <section className="section receipt-section" aria-labelledby="receipt-h">
          <div className="section-title"><h2 id="receipt-h">What you pay</h2><p className="hint">An example receipt with sample prices.</p></div>
          <div className="panel example-receipt">
            <ul className="receipt">
              {RECEIPT.flatMap(([name, type, q, p]) => [
                <li key={name}><span>{q} × {name}{type !== 'meal' && <span className="hint"> ({type})</span>}</span><span className="tnum">{formatKobo(q * p)}</span></li>,
                ...(type === 'meal' ? [<li key={`${name}-water`} className="included"><span>{q} × Bottled water (included)</span><span className="tnum">₦0</span></li>] : []),
              ])}
            </ul>
            <dl className="breakdown">
              <div><dt>Subtotal</dt><dd>{formatKobo(SUBTOTAL)}</dd></div>
              <div><dt>VAT (7.5%, on the subtotal)</dt><dd>{formatKobo(VAT)}</dd></div>
              <div><dt>Delivery fee</dt><dd>{formatKobo(FEE)}</dd></div>
              <div className="total"><dt>Total</dt><dd>{formatKobo(SUBTOTAL + VAT + FEE)}</dd></div>
            </dl>
            <p className="code-line">Delivery code <b className="delivery-code small">4827</b> <span className="hint">(example; yours is shown after payment)</span></p>
          </div>
        </section>

        <section className="section closing" aria-labelledby="start-h">
          <h2 id="start-h" className="hero-title">Ready for today's check-in?</h2>
          <div className="actions">
            <Link className="btn" to="/register">Create account</Link>
            <Link className="btn quiet" to="/login">Log in</Link>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>A final-year project, Department of Computer Science, University of Nigeria, Nsukka.</p>
      </footer>
    </div>
  );
}
