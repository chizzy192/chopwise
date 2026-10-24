// API for the browser smoke tests (client: npm run test:ui). It never touches the dev database:
// it rebuilds a separate database (<dev name>_ui_test, photos included) from the demo data, and
// talks to a mock Paystack whose checkout page "pays" and sends the browser back to
// CLIENT_ORIGIN/payment/return, as the real one does.
import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devUrl = new URL(process.env.DATABASE_URL);
const testDb = `${devUrl.pathname.slice(1)}_ui_test`;
const testUrl = new URL(devUrl);
testUrl.pathname = `/${testDb}`;

// 1. Create the test database if needed, then fill it with the demo data.
const admin = new pg.Client({ connectionString: Object.assign(new URL(devUrl), { pathname: '/postgres' }).toString() });
await admin.connect();
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDb]);
if (!exists.rowCount) await admin.query(`CREATE DATABASE "${testDb}"`);
await admin.end();

process.env.DATABASE_URL = testUrl.toString();
// The smoke tests log in more than 10 times in 15 minutes; the real limit is tested in npm test and test:system.
process.env.TEST_AUTH_LIMIT = '100';
const setup = spawnSync(process.execPath, ['src/db/setup.js'], { cwd: serverDir, env: process.env, stdio: 'inherit' });
if (setup.status !== 0) process.exit(setup.status ?? 1);

// 2. Mock Paystack: the same API shape, plus a checkout page that completes the payment.
const SECRET = process.env.PAYSTACK_SECRET_KEY;
const transactions = new Map();
const mock = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const pay = req.url.match(/^\/pay\/([^/?]+)$/);
  if (req.method === 'GET' && pay && transactions.has(pay[1])) {
    const tx = transactions.get(pay[1]);
    tx.status = 'success';
    res.writeHead(302, { Location: `${tx.callback}?trxref=${tx.reference}&reference=${tx.reference}` });
    return res.end();
  }
  if (req.headers.authorization !== `Bearer ${SECRET}`) return send(401, { status: false, message: 'Invalid key' });
  if (req.method === 'POST' && req.url === '/transaction/initialize') {
    const b = JSON.parse(raw);
    transactions.set(b.reference, { reference: b.reference, amount: b.amount, currency: b.currency, status: 'abandoned', callback: b.callback_url });
    const { port } = mock.address();
    return send(200, { status: true, data: { authorization_url: `http://127.0.0.1:${port}/pay/${b.reference}`, access_code: 'mock', reference: b.reference } });
  }
  const verify = req.url.match(/^\/transaction\/verify\/(.+)$/);
  const tx = verify && transactions.get(decodeURIComponent(verify[1]));
  if (req.method === 'GET' && tx) {
    const { callback, ...data } = tx;
    return send(200, { status: true, data });
  }
  return send(404, { status: false, message: 'Not found' });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
process.env.PAYSTACK_API_URL = `http://127.0.0.1:${mock.address().port}`;

// 3. Mail: no SMTP here, so reset links are printed; they are also written to a file the
//    browser tests read (client/e2e/support.js, lastResetLink), as if opening the email.
delete process.env.SMTP_HOST;
const MAILBOX = path.join(os.tmpdir(), 'chopwise-ui-test-mailbox.txt');
fs.writeFileSync(MAILBOX, '');
const consoleLog = console.log;
console.log = (...args) => {
  const m = String(args[0] ?? '').match(/for (\S+): (\S+\/reset-password\?token=[0-9a-f]{64})/);
  if (m) fs.appendFileSync(MAILBOX, `${m[1]} ${m[2]}\n`);
  consoleLog(...args);
};

// 4. The API itself.
const { createApp } = await import('../src/app.js');
const port = Number(process.env.PORT || 4100);
createApp().listen(port, () => console.log(`UI test API on http://localhost:${port} (database ${testDb})`));
