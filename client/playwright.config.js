// Browser smoke tests: npm run test:ui
// Starts its own API (port 4100, separate test database, mock Paystack) and its own Vite (port 5180),
// so the dev servers and dev data are never touched. Uses the installed Microsoft Edge.
import { defineConfig } from '@playwright/test';

const API = 'http://localhost:4100';
const WEB = 'http://localhost:5180';

export default defineConfig({
  testDir: './e2e',
  // npm run screenshots sets SCREENSHOTS=1 to run the screenshot spec instead of the smoke tests.
  testMatch: process.env.SCREENSHOTS ? 'screenshots.spec.js' : 'smoke.spec.js',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: './e2e/.results',
  use: {
    baseURL: WEB,
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/ui-server.js',
      cwd: '../server',
      url: `${API}/api/auth/me`,
      env: { PORT: '4100', CLIENT_ORIGIN: WEB },
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: 'npx vite --port 5180 --strictPort',
      url: WEB,
      env: { API_PROXY_TARGET: API },
      timeout: 60_000,
    },
  ],
});
