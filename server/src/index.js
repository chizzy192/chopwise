import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { jwtSecret, clientOrigin, paystackSecret, deliveryCodeKey, isProduction } from './config.js';
import { expireReservations } from './services/orders.js';

// Fail at start-up, not on the first login or payment, when secrets are missing.
jwtSecret();
clientOrigin();
paystackSecret();
deliveryCodeKey();
if (isProduction() && !process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in the host's environment settings to the Neon connection string");

// Serve the built React app in production.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const app = createApp({ staticDir: dist });

// Return plates from unpaid checkouts older than 15 minutes (CLAUDE.md item 14). A sleeping free
// service stops this timer, so every stock read and checkout also runs the expiry first (routes.js).
setInterval(() => expireReservations().catch((err) => console.error('Reservation expiry failed:', err)), 60_000).unref();

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`ChopWise API running on http://localhost:${port}`));
