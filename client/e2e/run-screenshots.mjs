// npm run screenshots: runs e2e/screenshots.spec.js (saved to docs/screenshots/).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
fs.mkdirSync(new URL('../../docs/screenshots/', import.meta.url), { recursive: true });
const r = spawnSync('npx', ['playwright', 'test'], { stdio: 'inherit', shell: true, env: { ...process.env, SCREENSHOTS: '1' } });
process.exit(r.status ?? 1);
