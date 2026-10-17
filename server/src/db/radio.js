import { getDb } from './database.js';
import { QUEUE_TRACK_FIELDS, mapQueueTrack } from './queries.js';

// "Radio" from a seed album or artist: a one-off random queue of playable
// tracks around that seed. Roughly a third comes from the seed artist, the
// rest from other artists sharing the seed's genre; whatever is still missing
// (no genre, small library) is filled from the whole library.

export const RADIO_DEFAULT_SIZE = 50;
export const RADIO_MAX_SIZE = 200;
const ARTIST_SHARE = 0.3;

const TRACK_FROM = `
  FROM tracks t
  JOIN albums a ON a.id = t.album_id
  JOIN artists ar ON ar.id = a.artist_id
  WHERE t.file_path IS NOT NULL`;

function pick(db, where, params, limit, excludeIds) {
  if (limit <= 0) return [];
  const exclude = excludeIds.length
    ? `AND t.id NOT IN (${excludeIds.map(() => '?').join(',')})`
    : '';
  return db.prepare(`
    SELECT ${QUEUE_TRACK_FIELDS}, ar.id AS artist_id
    ${TRACK_FROM} ${where} ${exclude}
    ORDER BY RANDOM() LIMIT ${limit}
  `).all(...params, ...excludeIds);
}

function shuffle(rows) {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Greedy pass so the same artist rarely plays twice in a row: when the next
// row repeats the previous artist, swap in the first later row that doesn't.
function spreadArtists(rows) {
  const out = [...rows];
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].artist_id !== out[i - 1].artist_id) continue;
    const j = out.findIndex((r, k) => k > i && r.artist_id !== out[i - 1].artist_id);
    if (j !== -1) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function resolveSeed(db, { albumId, artistId }) {
  if (albumId != null) {
    const album = db.prepare(`
      SELECT a.id, a.title, a.genre, ar.id AS artist_id, ar.name AS artist_name
      FROM albums a JOIN artists ar ON ar.id = a.artist_id WHERE a.id = ?
    `).get(albumId);
    if (!album) return null;
    return {
      type: 'album', id: album.id, name: album.title,
      artistId: album.artist_id, artistName: album.artist_name, genre: album.genre,
    };
  }
  const artist = db.prepare('SELECT id, name FROM artists WHERE id = ?').get(artistId);
  if (!artist) return null;
  // The artist's most frequent genre stands for the whole artist.
  const genre = db.prepare(`
    SELECT genre FROM albums WHERE artist_id = ? AND genre IS NOT NULL AND genre != ''
    GROUP BY genre COLLATE NOCASE ORDER BY COUNT(*) DESC LIMIT 1
  `).get(artist.id)?.genre ?? null;
  return {
    type: 'artist', id: artist.id, name: artist.name,
    artistId: artist.id, artistName: artist.name, genre,
  };
}

// Returns { seed, tracks } or null when the seed album/artist is unknown.
export function getRadio({ albumId, artistId, size = RADIO_DEFAULT_SIZE } = {}) {
  const db = getDb();
  const seed = resolveSeed(db, { albumId, artistId });
  if (!seed) return null;

  const chosen = [];
  const ids = () => chosen.map(r => r.id);

  // An album radio opens on a track of that album.
  let opener = null;
  if (seed.type === 'album') {
    [opener] = pick(db, 'AND a.id = ?', [seed.id], 1, []);
    if (opener) chosen.push(opener);
  }

  const artistCount = Math.max(0, Math.ceil(size * ARTIST_SHARE) - chosen.length);
  chosen.push(...pick(db, 'AND ar.id = ?', [seed.artistId], artistCount, ids()));
  if (seed.genre) {
    chosen.push(...pick(db, 'AND a.genre = ? COLLATE NOCASE AND ar.id != ?',
      [seed.genre, seed.artistId], size - chosen.length, ids()));
  }
  chosen.push(...pick(db, '', [], size - chosen.length, ids()));

  const rest = spreadArtists(shuffle(opener ? chosen.slice(1) : chosen));
  const ordered = opener ? spreadArtists([opener, ...rest]) : rest;
  return {
    seed: {
      type: seed.type, id: seed.id, name: seed.name,
      artist_name: seed.artistName, genre: seed.genre,
    },
    tracks: ordered.map(mapQueueTrack),
  };
}
