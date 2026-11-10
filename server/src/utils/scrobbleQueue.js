import { LastfmError } from './lastfm.js';

// Scrobbles Last.fm could not take right now (the server has no Internet,
// Last.fm is down or rate limiting): kept and sent again later, oldest first.
// An entry holds what Last.fm needs ({ artist, track, album, duration,
// timestamp }), not a track id: it survives a change of collection.

// Last.fm refuses a scrobble older than 14 days: one day of margin.
export const SCROBBLE_MAX_AGE_SEC = 13 * 24 * 3600;
// A long outage is bounded: the oldest scrobbles go first.
export const PENDING_SCROBBLES_MAX = 500;

// Last.fm error codes worth another try: 11 service offline, 16 temporarily
// unavailable, 29 rate limit exceeded.
const RETRY_CODES = new Set([11, 16, 29]);

// A failure that says nothing about the scrobble itself: the network, or
// Last.fm asking to come back later. Anything else is a final refusal.
export function isTransientFailure(err) {
  return !(err instanceof LastfmError) || RETRY_CODES.has(Number(err.code));
}

const isEntry = (e) =>
  e != null && typeof e === 'object'
  && typeof e.artist === 'string' && typeof e.track === 'string'
  && Number.isFinite(e.timestamp);

// The stored list (a JSON string, or nothing), without what cannot be read.
export function parsePending(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter(isEntry) : [];
  } catch {
    return [];
  }
}

// Drops the scrobbles too old for Last.fm, and the oldest beyond the limit.
export function prunePending(list, nowSec) {
  return list
    .filter(e => nowSec - e.timestamp <= SCROBBLE_MAX_AGE_SEC)
    .slice(-PENDING_SCROBBLES_MAX);
}

export const sameScrobble = (a, b) =>
  a.timestamp === b.timestamp && a.artist === b.artist && a.track === b.track;

// The same play reported twice (a player retrying) is kept once.
export function addPending(list, entry, nowSec) {
  const without = list.filter(e => !sameScrobble(e, entry));
  return prunePending([...without, entry], nowSec);
}

export function removePending(list, entry) {
  return list.filter(e => !sameScrobble(e, entry));
}
