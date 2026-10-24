import { useState } from 'react';
import HealthForm from './HealthForm.jsx';

// Required before any staff page (CLAUDE.md item 9). The server enforces it too.
export default function Onboarding({ onDone }) {
  const [saved, setSaved] = useState(null);

  if (saved) {
    return (
      <div className="narrow">
        <h1>Thanks, that's saved</h1>
        <p className="explain" role="status">{saved.explanation}</p>
        <p className="hint">You can change your answer later on the Health profile page. Guidance, not medical advice.</p>
        <button onClick={onDone}>Continue to today's check-in</button>
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>One question before you start</h1>
      <p>ChopWise uses your answer, together with your last two meals, to decide how much guidance you get each day.</p>
      <HealthForm profile={null} submitLabel="Save and continue" onSaved={setSaved} />
    </div>
  );
}
