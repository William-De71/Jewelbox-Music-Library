import { createHash } from 'node:crypto';

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';

export class LastfmError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// md5 of the alphabetically sorted name+value pairs (excluding format/callback) + secret
export function apiSignature(params, secret) {
  const base = Object.keys(params)
    .filter(k => k !== 'format' && k !== 'callback' && params[k] != null)
    .sort()
    .map(k => `${k}${params[k]}`)
    .join('');
  return createHash('md5').update(base + secret, 'utf8').digest('hex');
}

export function authUrl(apiKey, callbackUrl) {
  return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(callbackUrl)}`;
}

async function lastfmCall(params, { apiKey, secret, post = false }) {
  const signed = { ...params, api_key: apiKey };
  signed.api_sig = apiSignature(signed, secret);
  signed.format = 'json';

  const body = new URLSearchParams(
    Object.fromEntries(Object.entries(signed).filter(([, v]) => v != null))
  );

  const res = post
    ? await fetch(API_ROOT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    : await fetch(`${API_ROOT}?${body.toString()}`);

  const json = await res.json();
  if (json.error) throw new LastfmError(json.error, json.message || 'Last.fm error');
  return json;
}

export async function getSession(apiKey, secret, token) {
  const json = await lastfmCall({ method: 'auth.getSession', token }, { apiKey, secret });
  return json.session; // { name, key }
}

export async function updateNowPlaying(creds, { artist, track, album, duration }) {
  const params = { method: 'track.updateNowPlaying', artist, track, sk: creds.sessionKey };
  if (album) params.album = album;
  if (duration) params.duration = String(duration);
  return lastfmCall(params, { apiKey: creds.apiKey, secret: creds.secret, post: true });
}

export async function scrobble(creds, { artist, track, album, duration, timestamp }) {
  const params = { method: 'track.scrobble', artist, track, timestamp: String(timestamp), sk: creds.sessionKey };
  if (album) params.album = album;
  if (duration) params.duration = String(duration);
  return lastfmCall(params, { apiKey: creds.apiKey, secret: creds.secret, post: true });
}
