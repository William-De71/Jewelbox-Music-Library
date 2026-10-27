import fs from 'fs';
import path from 'path';
import { APP_VERSION } from '../routes/version.js';

// Lyrics of a track, synced when possible:
//   1. a .lrc file next to the audio file (same name), the user's own;
//   2. LRCLIB (https://lrclib.net), free, no key, by artist / title / album /
//      duration — when the "lyrics online" setting allows it.
// What LRCLIB answers (lyrics or nothing) is cached in the collection
// database: a track is looked up once, a miss is asked again after a month.

export const LRCLIB_URL = 'https://lrclib.net/api/get';
export const MISS_RETRY_DAYS = 30;
const TIMEOUT_MS = 8000;

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

// Asks LRCLIB. Resolves { synced, plain, instrumental } or null (not found);
// throws on a network or server error (not cached then: asked again later).
export async function fetchLrclib({ artist, title, album, duration }, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  if (album) params.set('album_name', album);
  if (duration) params.set('duration', String(Math.round(duration)));
  const res = await fetchImpl(`${LRCLIB_URL}?${params}`, {
    headers: { 'User-Agent': `JewelBox-Music-Library/${APP_VERSION} (https://github.com/William-De71/Jewelbox-Music-Library)` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  const body = await res.json();
  return {
    synced: body.syncedLyrics || null,
    plain: body.plainLyrics || null,
    instrumental: Boolean(body.instrumental),
  };
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
