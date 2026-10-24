// 4-digit delivery codes. The caterer's entry is checked against an HMAC hash; an AES-256-GCM
// encrypted copy lets only the staff member who ordered see the code (CLAUDE.md item 15).
// A database leak alone reveals no code: both need DELIVERY_CODE_KEY, which lives only in .env.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { deliveryCodeKey } from '../config.js';

export const newDeliveryCode = () => String(randomInt(0, 10_000)).padStart(4, '0');

// The order id is mixed in, so the same code on two orders hashes differently.
export function hashCode(code, orderId, key = deliveryCodeKey()) {
  return createHmac('sha256', key).update(`${orderId}:${code}`).digest('hex');
}

export function codeMatches(code, orderId, storedHash, key = deliveryCodeKey()) {
  if (!/^\d{4}$/.test(code) || !storedHash) return false;
  return timingSafeEqual(Buffer.from(hashCode(code, orderId, key), 'hex'), Buffer.from(storedHash, 'hex'));
}

export function encryptCode(code, key = deliveryCodeKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptCode(stored, key = deliveryCodeKey()) {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
