const STORAGE_KEY = 'jewelbox-device-id';

let cached = null;

// Identifies this browser (or app install) so the server can keep its playback
// queue apart from the phone's. Not a security token: it only namespaces a
// queue, and there are no accounts to impersonate.
export function getDeviceId() {
  if (cached) return cached;
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    cached = id;
  } catch {
    // Private browsing with storage denied: fall back to a per-session id so
    // playback still works, it just will not survive a reload.
    cached = crypto.randomUUID();
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
