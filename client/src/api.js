// The session lives in an httpOnly cookie set by the server; nothing is kept in localStorage.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    // A FormData body (photo upload) sets its own multipart headers.
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.code = data.code; // ONBOARDING_REQUIRED, CHECKIN_REQUIRED, CHECKIN_LOCKED or PASSWORD_CHANGE_REQUIRED
    err.data = data; // a 409 from cart evaluation still carries the whole evaluation
    throw err;
  }
  return data;
}

export const CLASSES = ['carb', 'protein', 'fat', 'vitamin', 'mineral'];
export const LABELS = {
  carb: 'Carbohydrates', protein: 'Proteins', fat: 'Fats and oils', vitamin: 'Vitamins', mineral: 'Minerals',
};

export const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

// Same list as the server (logic/checkin.js).
export const CONDITIONS = ['Diabetes', 'Hypertension', 'Heart disease', 'High cholesterol', 'Kidney disease'];
