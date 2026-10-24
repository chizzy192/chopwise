// Paystack API calls (test mode). The secret key is only ever sent to Paystack, never to the browser.
// PAYSTACK_API_URL can point at a mock server; tests never call the real API.
import { paystackSecret, paystackApiUrl } from '../config.js';

async function call(path, init = {}) {
  const res = await fetch(paystackApiUrl() + path, {
    ...init,
    headers: { Authorization: `Bearer ${paystackSecret()}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.status) {
    const err = new Error(`Paystack ${path.split('/')[2] ?? 'request'} failed: ${body?.message ?? res.status}`);
    err.paystack = true;
    throw err;
  }
  return body.data;
}

// Starts a payment for the exact total. Returns { authorization_url, access_code, reference }.
export function initializeTransaction({ email, amountKobo, reference, callbackUrl, orderId }) {
  return call('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email, amount: amountKobo, currency: 'NGN', reference, callback_url: callbackUrl,
      metadata: { order_id: orderId },
    }),
  });
}

// The transaction as Paystack recorded it: { status, reference, amount, currency, ... }.
export const verifyTransaction = (reference) => call(`/transaction/verify/${encodeURIComponent(reference)}`);
