import { getDb } from './database.js';
import { durationToSeconds } from './queries.js';

// Listening statistics ("Mes écoutes"), from two sources:
// - tracks.play_count: the all-time total, plays from before the log included;
// - track_plays: one row per counted play, dated, for anything over time
//   (today, this month, per month). It starts empty on an upgrade.
//
// Periods are calendar ones in the server's time zone; played_at is SQLite
// UTC text, so boundaries are computed here and compared as UTC text.

export const LISTENING_PERIODS = ['month', 'year', 'all'];
const TOP_SIZE = 10;
const NEVER_PLAYED_SAMPLE = 12;
const MONTHS_SHOWN = 12;

// Date -> 'YYYY-MM-DD HH:MM:SS' UTC, the shape of datetime('now').
export const sqlUtc = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const fromSqlUtc = (text) => new Date(`${text.replace(' ', 'T')}Z`);
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export function periodStart(period, now) {
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'year') return new Date(now.getFullYear(), 0, 1);
  return null;
}

// Plays per track for the period, as an SQL source of (track_id, plays).
function playsSource(since) {
  return since
    ? { sql: 'SELECT track_id, COUNT(*) AS plays FROM track_plays WHERE played_at >= ? GROUP BY track_id', params: [sqlUtc(since)] }
    : { sql: 'SELECT id AS track_id, play_count AS plays FROM tracks WHERE play_count > 0', params: [] };
}

function tops(db, since) {
  const source = playsSource(since);
  const from = `
    FROM (${source.sql}) s
    JOIN tracks t ON t.id = s.track_id
    JOIN albums a ON a.id = t.album_id
    JOIN artists ar ON ar.id = a.artist_id`;
  const albums = db.prepare(`
    SELECT a.id AS album_id, a.title, ar.name AS artist_name, a.cover_url, a.year, SUM(s.plays) AS plays
    ${from}
    GROUP BY a.id ORDER BY plays DESC, a.title COLLATE NOCASE LIMIT ?
  `).all(...source.params, TOP_SIZE);
  const artists = db.prepare(`
    SELECT ar.id AS artist_id, ar.name, SUM(s.plays) AS plays
    ${from}
    GROUP BY ar.id ORDER BY plays DESC, ar.name COLLATE NOCASE LIMIT ?
  `).all(...source.params, TOP_SIZE);
  const tracks = db.prepare(`
    SELECT t.id, t.title, a.id AS album_id, a.title AS album_title, ar.name AS artist_name, a.cover_url, s.plays
    ${from}
    ORDER BY s.plays DESC, t.title COLLATE NOCASE LIMIT ?
  `).all(...source.params, TOP_SIZE);
  return { albums, artists, tracks };
}

// Plays, listening time and how much of the collection they cover.
function summary(db, since) {
  const source = playsSource(since);
  const rows = db.prepare(`
    SELECT s.plays, t.duration, t.album_id FROM (${source.sql}) s JOIN tracks t ON t.id = s.track_id
  `).all(...source.params);
  let plays = 0;
  let seconds = 0;
  const albums = new Set();
  for (const row of rows) {
    plays += row.plays;
    seconds += row.plays * (durationToSeconds(row.duration) || 0);
    albums.add(row.album_id);
  }
  return { plays, listening_minutes: Math.round(seconds / 60), tracks: rows.length, albums: albums.size };
}

// Owned albums with audio files of which no track was ever played.
function neverPlayed(db) {
  const where = `
    WHERE a.is_wanted = 0
      AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.file_path IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.play_count > 0)`;
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM albums a ${where}`).get();
  const albums = db.prepare(`
    SELECT a.id AS album_id, a.title, ar.name AS artist_name, a.cover_url, a.year
    FROM albums a JOIN artists ar ON ar.id = a.artist_id
    ${where}
    ORDER BY RANDOM() LIMIT ?
  `).all(NEVER_PLAYED_SAMPLE);
  return { count, albums };
}

// The last MONTHS_SHOWN calendar months, oldest first, zeros included.
function byMonth(db, now) {
  const first = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1), 1);
  const counts = new Map();
  for (let i = 0; i < MONTHS_SHOWN; i++) {
    counts.set(monthKey(new Date(first.getFullYear(), first.getMonth() + i, 1)), 0);
  }
  const rows = db.prepare('SELECT played_at FROM track_plays WHERE played_at >= ?').all(sqlUtc(first));
  for (const { played_at } of rows) {
    const key = monthKey(fromSqlUtc(played_at));
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return [...counts].map(([month, plays]) => ({ month, plays }));
}

export function getListeningStats({ period = 'month', now = new Date() } = {}) {
  const db = getDb();
  const since = periodStart(period, now);
  const countSince = (date) => db
    .prepare('SELECT COUNT(*) AS count FROM track_plays WHERE played_at >= ?')
    .get(sqlUtc(date)).count;
  const first = db.prepare('SELECT MIN(played_at) AS first FROM track_plays').get().first;
  return {
    period,
    tracking_since: first ? fromSqlUtc(first).toISOString() : null,
    counters: {
      plays_today: countSince(new Date(now.getFullYear(), now.getMonth(), now.getDate())),
      plays_month: countSince(periodStart('month', now)),
      plays_year: countSince(periodStart('year', now)),
      plays_all: db.prepare('SELECT COALESCE(SUM(play_count), 0) AS total FROM tracks').get().total,
    },
    summary: summary(db, since),
    by_month: byMonth(db, now),
    top: tops(db, since),
    never_played: neverPlayed(db),
  };
}
