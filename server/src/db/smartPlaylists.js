import { getDb } from './database.js';
import { QUEUE_TRACK_FIELDS, mapQueueTrack } from './queries.js';

// Only playable tracks (with an audio file) belong in smart playlists.
const BASE_FROM = `
  FROM tracks t
  JOIN albums a ON a.id = t.album_id
  JOIN artists ar ON ar.id = a.artist_id
  WHERE t.file_path IS NOT NULL`;

const ALPHA_ORDER = 'ar.name COLLATE NOCASE, a.title COLLATE NOCASE, t.position';

const DEFINITIONS = {
  newest: { where: '', order: 'a.created_at DESC, a.id, t.position', limit: 100 },
  random50: { where: '', order: 'RANDOM()', limit: 50 },
  ever_played: { where: 'AND t.play_count > 0', order: ALPHA_ORDER, limit: 500 },
  never_played: { where: 'AND t.play_count = 0', order: ALPHA_ORDER, limit: 500 },
  last_played: { where: 'AND t.last_played_at IS NOT NULL', order: 't.last_played_at DESC', limit: 100 },
  most_played: { where: 'AND t.play_count > 0', order: 't.play_count DESC, t.last_played_at DESC', limit: 100 },
  favourites: { where: 'AND t.is_favorite = 1', order: ALPHA_ORDER, limit: 500 },
  all_tracks: { where: '', order: ALPHA_ORDER, limit: 1000 },
  dynamic_mix: { where: '', order: 'RANDOM()', limit: 50 },
};

export const SMART_PLAYLIST_KEYS = Object.keys(DEFINITIONS);

export function getSmartPlaylists() {
  const db = getDb();
  return SMART_PLAYLIST_KEYS.map(key => {
    const def = DEFINITIONS[key];
    const { count } = db.prepare(`SELECT COUNT(*) AS count ${BASE_FROM} ${def.where}`).get();
    return { key, track_count: Math.min(count, def.limit) };
  });
}

// Returns queue-shaped tracks, or null for an unknown key.
export function getSmartPlaylistTracks(key, { excludeIds = [] } = {}) {
  const def = DEFINITIONS[key];
  if (!def) return null;

  const ids = excludeIds.filter(Number.isInteger).slice(0, 200);
  const exclude = ids.length ? `AND t.id NOT IN (${ids.map(() => '?').join(',')})` : '';
  const rows = getDb()
    .prepare(`SELECT ${QUEUE_TRACK_FIELDS} ${BASE_FROM} ${def.where} ${exclude} ORDER BY ${def.order} LIMIT ${def.limit}`)
    .all(...ids);

  // Small libraries: if the exclusion empties the result, allow repeats.
  if (rows.length === 0 && ids.length) return getSmartPlaylistTracks(key);
  return rows.map(mapQueueTrack);
}
