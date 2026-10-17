import { getDb } from './database.js';
import { QUEUE_TRACK_FIELDS, mapQueueTrack } from './queries.js';

// Only playable tracks (with an audio file) belong in smart playlists.
const BASE_FROM = `
  FROM tracks t
  JOIN albums a ON a.id = t.album_id
  JOIN artists ar ON ar.id = a.artist_id
  WHERE t.file_path IS NOT NULL`;

const ALPHA_ORDER = 'ar.name COLLATE NOCASE, a.title COLLATE NOCASE, t.position';

const DYNAMIC_MIX_SIZE = 50;

// Bounds for the caller-chosen size of the "top N" rankings (?limit=).
export const RANKING_LIMIT_MIN = 1;
export const RANKING_LIMIT_MAX = 1000;

// The "top N" rankings: capped lists whose size a client may choose.
const RANKING_KEYS = new Set(['newest', 'last_played', 'most_played']);

// Validates a client-chosen ranking size (a raw query-string value). Returns
// { value } (undefined when absent) or { error } for a 400.
export function parseRankingLimit(raw) {
  if (raw === undefined) return { value: undefined };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < RANKING_LIMIT_MIN || value > RANKING_LIMIT_MAX) {
    return { error: `limit must be an integer between ${RANKING_LIMIT_MIN} and ${RANKING_LIMIT_MAX}` };
  }
  return { value };
}

// limit: null = no cap. Only the "top N" rankings (newest, last/most played)
// are capped; the other lists return every matching track, however large
// the library is.
const DEFINITIONS = {
  newest: { where: '', order: 'a.created_at DESC, a.id, t.position', limit: 100 },
  ever_played: { where: 'AND t.play_count > 0', order: ALPHA_ORDER, limit: null },
  never_played: { where: 'AND t.play_count = 0', order: ALPHA_ORDER, limit: null },
  last_played: { where: 'AND t.last_played_at IS NOT NULL', order: 't.last_played_at DESC', limit: 100 },
  most_played: { where: 'AND t.play_count > 0', order: 't.play_count DESC, t.last_played_at DESC', limit: 100 },
  favourites: { where: 'AND t.is_favorite = 1', order: ALPHA_ORDER, limit: null },
  all_tracks: { where: '', order: ALPHA_ORDER, limit: null },
  dynamic_mix: { where: '', order: null, limit: DYNAMIC_MIX_SIZE }, // persistent, see below
};

export const SMART_PLAYLIST_KEYS = Object.keys(DEFINITIONS);

// The dynamic mix is persistent: its tracks live in dynamic_mix_tracks
// (insertion order = list order) so the list survives refreshes. Drops
// unplayable rows, then appends random tracks at the bottom until the list
// holds 50 (or the whole library, whichever is smaller). avoidIds keeps
// just-consumed tracks from being re-picked immediately, unless the library
// is too small for that.
function ensureDynamicMix(db, { avoidIds = [] } = {}) {
  db.prepare(`DELETE FROM dynamic_mix_tracks WHERE track_id NOT IN (SELECT t.id ${BASE_FROM})`).run();
  const fill = (avoid) => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM dynamic_mix_tracks').get();
    const missing = DYNAMIC_MIX_SIZE - count;
    if (missing <= 0) return true;
    const notAvoided = avoid.length ? `AND t.id NOT IN (${avoid.map(() => '?').join(',')})` : '';
    db.prepare(`
      INSERT INTO dynamic_mix_tracks (track_id)
      SELECT t.id ${BASE_FROM} ${notAvoided}
        AND t.id NOT IN (SELECT track_id FROM dynamic_mix_tracks)
      ORDER BY RANDOM() LIMIT ${missing}
    `).run(...avoid);
    return db.prepare('SELECT COUNT(*) AS count FROM dynamic_mix_tracks').get().count >= DYNAMIC_MIX_SIZE;
  };
  if (!fill(avoidIds.filter(Number.isInteger)) && avoidIds.length) fill([]);
}

function getDynamicMixTracks(db) {
  ensureDynamicMix(db);
  return db
    .prepare(`SELECT ${QUEUE_TRACK_FIELDS} FROM dynamic_mix_tracks r JOIN tracks t ON t.id = r.track_id
      JOIN albums a ON a.id = t.album_id
      JOIN artists ar ON ar.id = a.artist_id
      ORDER BY r.id`)
    .all()
    .map(mapQueueTrack);
}

// Full reset: throw the whole list away and draw a brand-new random mix.
export function refreshDynamicMix() {
  const db = getDb();
  db.prepare('DELETE FROM dynamic_mix_tracks').run();
  return getDynamicMixTracks(db);
}

// A dynamic mix track was played through: remove it and top the list back up.
export function consumeDynamicMixTrack(trackId) {
  const db = getDb();
  const removed = db.prepare('DELETE FROM dynamic_mix_tracks WHERE track_id = ?').run(trackId).changes > 0;
  ensureDynamicMix(db, { avoidIds: removed ? [trackId] : [] });
  return { removed, tracks: getDynamicMixTracks(db) };
}

// Effective cap for a list: the caller's rankingLimit applies to the "top N"
// rankings only; every other list keeps its own definition.
function effectiveLimit(key, rankingLimit) {
  const def = DEFINITIONS[key];
  if (rankingLimit != null && RANKING_KEYS.has(key)) return rankingLimit;
  return def.limit;
}

// rankingLimit (optional): size of the "top N" rankings, already validated
// by the route (integer within RANKING_LIMIT_MIN..RANKING_LIMIT_MAX).
export function getSmartPlaylists({ rankingLimit } = {}) {
  const db = getDb();
  return SMART_PLAYLIST_KEYS.map(key => {
    const def = DEFINITIONS[key];
    const limit = effectiveLimit(key, rankingLimit);
    const { count } = db.prepare(`SELECT COUNT(*) AS count ${BASE_FROM} ${def.where}`).get();
    return { key, track_count: limit == null ? count : Math.min(count, limit) };
  });
}

// Returns queue-shaped tracks, or null for an unknown key.
export function getSmartPlaylistTracks(key, { rankingLimit } = {}) {
  const def = DEFINITIONS[key];
  if (!def) return null;
  if (key === 'dynamic_mix') return getDynamicMixTracks(getDb());

  const limit = effectiveLimit(key, rankingLimit);
  const rows = getDb()
    .prepare(`SELECT ${QUEUE_TRACK_FIELDS} ${BASE_FROM} ${def.where} ORDER BY ${def.order}${limit == null ? '' : ` LIMIT ${limit}`}`)
    .all();
  return rows.map(mapQueueTrack);
}
