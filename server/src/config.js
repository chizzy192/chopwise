// Runtime settings: server/.env locally, the host's environment settings when deployed (Render).
// Read lazily so tests can set them first.
const WHERE = "(in server/.env, or in the host's environment settings)";
const EXAMPLE_SECRET = 'change-this-to-a-long-random-string';

export const isProduction = () => process.env.NODE_ENV === 'production';

export function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32 || s === EXAMPLE_SECRET) {
    throw new Error(`Set JWT_SECRET ${WHERE} to a random string of at least 32 characters`);
  }
  return s;
}

// Paystack. Live keys are refused: this project runs in test mode only (CLAUDE.md item 7).
export function paystackSecret() {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k || !k.startsWith('sk_test_')) throw new Error(`Set PAYSTACK_SECRET_KEY ${WHERE} to a Paystack test secret key (sk_test_...)`);
  return k;
}

export const paystackApiUrl = () => (process.env.PAYSTACK_API_URL || 'https://api.paystack.co').replace(/\/$/, '');

// 32-byte key (64 hex characters) for the encrypted copy of each delivery code.
export function deliveryCodeKey() {
  const k = process.env.DELIVERY_CODE_KEY;
  if (!k || !/^[0-9a-f]{64}$/i.test(k)) throw new Error(`Set DELIVERY_CODE_KEY ${WHERE} to 64 hex characters`);
  return Buffer.from(k, 'hex');
}

// The one site allowed to call the API with cookies (CORS and the Origin check).
// On Render, CLIENT_ORIGIN can be left out: Render gives every web service its public address in
// RENDER_EXTERNAL_URL (e.g. https://chopwise.onrender.com).
export function clientOrigin() {
  const o = process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  if (o) return o.replace(/\/$/, '');
  if (isProduction()) throw new Error(`Set CLIENT_ORIGIN ${WHERE} to the site's address, e.g. https://chopwise.onrender.com`);
  return 'http://localhost:5173';
}
