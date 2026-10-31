import fs from 'fs';
import path from 'path';
import { APP_VERSION } from '../routes/version.js';

// Lyrics of a track, synced when possible:
//   1. a .lrc file next to the audio file (same name), the user's own;
//   2. LRCLIB (https://lrclib.net), free, no key, by artist / title / album /
//      duration — when the "lyrics online" setting allows it. The exact match
//      first, then a search (synced lyrics of a close duration preferred).
// What LRCLIB answers (lyrics or nothing) is cached in the collection
// database: a track is looked up once, a miss is asked again after a week,
// plain lyrics are looked up again after a month (synced ones may come).

export const LRCLIB_URL = 'https://lrclib.net/api/get';
export const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';
export const MISS_RETRY_DAYS = 7;
export const PLAIN_RETRY_DAYS = 30;
const TIMEOUT_MS = 8000;
// LRCLIB often answers "busy" (503) or "too many requests" (429): asked
// again after these delays before giving up.
const BUSY_RETRY_MS = [1000, 3000];
// Search results kept when their duration is this close to the track's.
const DURATION_TOLERANCE_S = 3;

// "[01:02.50]Line" (several tags per line allowed) -> [{ time: 62.5, text }],
// sorted by time; metadata tags ([ar:…], [offset:…]) are skipped.
export function parseLrc(text) {
  const lines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (tags.length === 0) continue;
    const lyric = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const [, m, s, frac = '0'] of tags) {
      const time = Number(m) * 60 + Number(s) + Number(`0.${frac}`);
      lines.push({ time: Math.round(time * 1000) / 1000, text: lyric });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

// Plain text from synced lyrics (when only those exist).
export const lrcToPlain = (text) => parseLrc(text).map(l => l.text).join('\n');

// The .lrc next to an audio file of the library, or null.
export function readLocalLrc(libRoot, filePath) {
  if (!libRoot || !filePath) return null;
  const audio = path.resolve(libRoot, filePath);
  if (!audio.startsWith(libRoot + path.sep)) return null;
  const lrc = audio.replace(/\.[^./\\]+$/, '.lrc');
  try {
    const text = fs.readFileSync(lrc, 'utf8');
    return parseLrc(text).length ? text : null;
  } catch {
    return null;
  }
}

// "Airbag (Remastered 2009)", "Airbag [Live]", "Airbag - 2009 Remaster" -> "Airbag".
export function cleanTitle(title) {
  const cleaned = String(title ?? '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*\b(remaster(ed)?|live|version|edit|mix|mono|stereo|demo|bonus)\b.*$/i, '')
    .trim();
  return cleaned || String(title ?? '').trim();
}

// "Theatre Of Tragedy" ~ "theatre of tragedy", "Last Curtain Call (CD 1)" ~ "lastcurtaincall1".
const fold = (s) => String(s ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const toLyrics = (body) => ({
  synced: body.syncedLyrics || null,
  plain: body.plainLyrics || null,
  instrumental: Boolean(body.instrumental),
});

// The best of LRCLIB search results for a track, or null: same artist, a
// duration within a few seconds (when both are known), then synced lyrics
// first, the same album next, the closest duration last.
export function pickBest(results, { artist, album, duration } = {}) {
  const candidates = (Array.isArray(results) ? results : [])
    .filter(r => r.syncedLyrics || r.plainLyrics || r.instrumental)
    .filter(r => !artist || fold(r.artistName) === fold(artist))
    .filter(r => !duration || !r.duration || Math.abs(r.duration - duration) <= DURATION_TOLERANCE_S);
  const rank = (r) => [
    r.syncedLyrics ? 0 : 1,
    album && fold(r.albumName).includes(fold(album)) ? 0 : 1,
    duration && r.duration ? Math.abs(r.duration - duration) : 0,
  ];
  candidates.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
  return candidates.length ? toLyrics(candidates[0]) : null;
}

// One LRCLIB request, asked again while the server says it is busy.
async function askLrclib(url, { fetchImpl, retryDelaysMs }) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': `JewelBox-Music-Library/${APP_VERSION} (https://github.com/William-De71/Jewelbox-Music-Library)` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const busy = res.status === 503 || res.status === 429;
    if (!busy || attempt >= retryDelaysMs.length) return res;
    await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt]));
  }
}

async function getExact({ artist, title, album, duration }, opts) {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  if (album) params.set('album_name', album);
  if (duration) params.set('duration', String(Math.round(duration)));
  const res = await askLrclib(`${LRCLIB_URL}?${params}`, opts);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  return toLyrics(await res.json());
}

// Searches by artist and title, then by the cleaned title when it differs.
async function searchBest(track, opts) {
  const titles = [...new Set([track.title, cleanTitle(track.title)])];
  const results = [];
  for (const title of titles) {
    const params = new URLSearchParams({ artist_name: track.artist, track_name: title });
    const res = await askLrclib(`${LRCLIB_SEARCH_URL}?${params}`, opts);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
    results.push(...await res.json());
    const best = pickBest(results, track);
    if (best?.synced) return best;
  }
  return pickBest(results, track);
}

// Asks LRCLIB. Resolves { synced, plain, instrumental } or null (not found);
// throws on a network or server error (not cached then: asked again later).
// The exact match is enough when synced (or instrumental); otherwise a search
// may find synced lyrics under another album name, case or duration.
export async function fetchLrclib(track, { fetchImpl = fetch, retryDelaysMs = BUSY_RETRY_MS } = {}) {
  const opts = { fetchImpl, retryDelaysMs };
  const exact = await getExact(track, opts);
  if (exact?.synced || exact?.instrumental) return exact;
  let found = null;
  try {
    found = await searchBest(track, opts);
  } catch (err) {
    if (!exact) throw err;
  }
  return found?.synced ? found : exact || found;
}

// The answer for the players: synced lines when known, plain text otherwise.
export function lyricsPayload({ synced = null, plain = null, instrumental = false, source = null } = {}) {
  const lines = synced ? parseLrc(synced) : [];
  return {
    source,
    instrumental: Boolean(instrumental),
    synced: lines.length > 0,
    lines: lines.length > 0 ? lines : null,
    plain: plain || (lines.length ? lrcToPlain(synced) : null),
  };
}
