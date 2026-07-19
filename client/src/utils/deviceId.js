const STORAGE_KEY = 'jewelbox-device-id';

let cached = null;

// crypto.randomUUID only exists in secure contexts (HTTPS or localhost). In
// production the app is typically served over plain http://<lan-ip>:3001, so
// counting on it broke every API call once (the header is added to each
// request). Fall back to getRandomValues — available in insecure contexts —
// and last-resort Math.random: a weaker id only mislabels a queue, while
// throwing here takes the whole app down.
function randomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch { /* fall through */ }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Identifies this browser (or app install) so the server can keep its playback
// queue apart from the phone's. Not a security token: it only namespaces a
// queue, and there are no accounts to impersonate.
//
// MUST never throw: it runs inside every API request. Worst case (storage and
// crypto both unavailable) it returns a fresh per-session id.
export function getDeviceId() {
  if (cached) return cached;
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    cached = id;
  } catch {
    // Private browsing with storage denied: fall back to a per-session id so
    // playback still works, it just will not survive a reload.
    cached = randomId();
  }
  return cached;
}

// A human-readable hint for the "resume from another device" list.
export function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Navigateur';
}
