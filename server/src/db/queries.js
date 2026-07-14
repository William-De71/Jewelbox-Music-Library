import { getDb } from './database.js';

// ── Artists ──────────────────────────────────────────────────────────────────

export function upsertArtist(name) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO artists (name) VALUES (?)').run(name).lastInsertRowid;
}

export function getAllArtists() {
  return getDb().prepare('SELECT * FROM artists ORDER BY name COLLATE NOCASE').all();
}

// ── Labels ───────────────────────────────────────────────────────────────────

export function upsertLabel(name) {
  if (!name) return null;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM labels WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO labels (name) VALUES (?)').run(name).lastInsertRowid;
}

export function getAllLabels() {
  return getDb().prepare('SELECT * FROM labels ORDER BY name COLLATE NOCASE').all();
}

export function getBorrowers() {
  return getDb()
    .prepare('SELECT DISTINCT lent_to FROM albums WHERE lent_to IS NOT NULL AND lent_to != \'\' ORDER BY lent_to COLLATE NOCASE')
    .all()
    .map(r => r.lent_to);
}

// ── Albums ───────────────────────────────────────────────────────────────────

const ALBUM_SELECT = `
  SELECT
    a.id, a.title, a.year, a.genre, a.total_duration, a.ean,
    a.rating, a.cover_url, a.notes, a.is_lent, a.lent_to, a.lent_at, a.is_wanted,
    a.audio_folder, a.created_at, a.updated_at,
    ar.id   AS artist_id,   ar.name  AS artist_name,
    l.id    AS label_id,    l.name   AS label_name,
    EXISTS(SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.file_path IS NOT NULL) AS has_audio
  FROM albums a
  JOIN artists ar ON ar.id = a.artist_id
  LEFT JOIN labels l ON l.id = a.label_id
`;

function mapAlbum(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    genre: row.genre,
    total_duration: row.total_duration,
    ean: row.ean,
    rating: row.rating,
    cover_url: row.cover_url,
    notes: row.notes,
    is_lent: Boolean(row.is_lent),
    lent_to: row.lent_to,
    lent_at: row.lent_at ?? null,
    is_wanted: Boolean(row.is_wanted),
    audio_folder: row.audio_folder ?? null,
    has_audio: Boolean(row.has_audio),
    created_at: row.created_at,
    updated_at: row.updated_at,
    artist: { id: row.artist_id, name: row.artist_name },
    label: row.label_id ? { id: row.label_id, name: row.label_name } : null,
  };
}

export function getAlbums({ page = 1, limit = 24, genre, rating, sort = 'title', order = 'asc', search, lent, wanted, letter } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (genre) { conditions.push('a.genre = ?'); params.push(genre); }
  if (rating) { conditions.push('a.rating = ?'); params.push(Number(rating)); }
  if (search) {
    conditions.push('(a.title LIKE ? OR ar.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (lent === 'true' || lent === true) { conditions.push('a.is_lent = 1'); }
  if (wanted === 'true' || wanted === true) { conditions.push('a.is_wanted = 1'); }
  if (wanted === 'false' || wanted === false) { conditions.push('a.is_wanted = 0'); }
  if (letter) { conditions.push("UPPER(SUBSTR(ar.name, 1, 1)) = ?"); params.push(letter.toUpperCase()); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const validSorts = { title: 'a.title', artist: 'ar.name', year: 'a.year', rating: 'a.rating', created_at: 'a.created_at' };
  const sortCol = validSorts[sort] || 'a.title';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  const rows = db.prepare(`${ALBUM_SELECT} ${where} ORDER BY ${sortCol} COLLATE NOCASE ${sortDir}, a.year ASC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM albums a
    JOIN artists ar ON ar.id = a.artist_id
    ${where}
  `).get(...params);

  return { 
    data: rows.map(mapAlbum), 
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}

export function getAlbumById(id) {
  const db = getDb();
  const album = mapAlbum(db.prepare(`${ALBUM_SELECT} WHERE a.id = ?`).get(id));
  if (!album) return null;
  album.tracks = db
    .prepare('SELECT id, position, title, duration, file_path, play_count, is_favorite FROM tracks WHERE album_id = ? ORDER BY position')
    .all(id)
    .map(t => ({
      id: t.id,
      position: t.position,
      title: t.title,
      duration: t.duration,
      has_file: t.file_path != null,
      play_count: t.play_count,
      is_favorite: Boolean(t.is_favorite),
    }));
  return album;
}

export function createAlbum(data) {
  const db = getDb();
  const artist_id = upsertArtist(data.artist_name);
  const label_id = data.label_name ? upsertLabel(data.label_name) : null;

  const insert = db.prepare(`
    INSERT INTO albums (title, artist_id, label_id, year, genre, total_duration, ean, rating, cover_url, notes, is_wanted)
    VALUES (@title, @artist_id, @label_id, @year, @genre, @total_duration, @ean, @rating, @cover_url, @notes, @is_wanted)
  `);

  const insertTrack = db.prepare(
    'INSERT INTO tracks (album_id, position, title, duration) VALUES (?, ?, ?, ?)'
  );

  const run = db.transaction(() => {
    const { lastInsertRowid } = insert.run({
      title: data.title,
      artist_id,
      label_id: label_id ?? null,
      year: data.year ?? null,
      genre: data.genre ?? null,
      total_duration: data.total_duration ?? null,
      ean: data.ean ?? null,
      rating: data.rating ?? null,
      cover_url: data.cover_url ?? null,
      notes: data.notes ?? null,
      is_wanted: data.is_wanted ? 1 : 0,
    });
    (data.tracks || []).forEach((t, i) => insertTrack.run(lastInsertRowid, t.position ?? i + 1, t.title, t.duration || null));
    return lastInsertRowid;
  });

  return getAlbumById(run());
}

export function updateAlbum(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM albums WHERE id = ?').get(id);
  if (!existing) return null;

  const artist_id = data.artist_name ? upsertArtist(data.artist_name) : undefined;
  const label_id = data.label_name !== undefined ? upsertLabel(data.label_name) : undefined;

  const fields = [];
  const params = [];

  const fieldMap = {
    title: 'title', year: 'year', genre: 'genre',
    total_duration: 'total_duration', ean: 'ean', rating: 'rating',
    cover_url: 'cover_url', notes: 'notes', is_lent: 'is_lent', lent_to: 'lent_to', lent_at: 'lent_at', is_wanted: 'is_wanted',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in data) {
      fields.push(`${col} = ?`);
      const val = data[key];
      params.push(typeof val === 'boolean' ? (val ? 1 : 0) : val);
    }
  }
  if (artist_id !== undefined) { fields.push('artist_id = ?'); params.push(artist_id); }
  if (label_id !== undefined) { fields.push('label_id = ?'); params.push(label_id); }
  fields.push("updated_at = datetime('now')");
  params.push(id);

  const insertTrack = db.prepare(
    'INSERT INTO tracks (album_id, position, title, duration, file_path) VALUES (?, ?, ?, ?, ?)'
  );
  const updateTrack = db.prepare('UPDATE tracks SET position = ?, title = ?, duration = ? WHERE id = ?');
  const deleteTrack = db.prepare('DELETE FROM tracks WHERE id = ?');
  const hasPlaylistTracks = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='playlist_tracks'")
    .get();
  const deleteTrackPlaylistEntries = hasPlaylistTracks
    ? db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?')
    : null;

  const run = db.transaction(() => {
    db.prepare(`UPDATE albums SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    if (data.tracks) {
      // Diff instead of delete+reinsert: track ids must survive album edits so
      // playlist entries and audio file associations stay valid.
      const oldTracks = db.prepare('SELECT id, position, title FROM tracks WHERE album_id = ?').all(id);
      const consumed = new Set();
      const claim = (position, title) => {
        let match = oldTracks.find(o => !consumed.has(o.id) && o.position === position);
        if (!match) match = oldTracks.find(o => !consumed.has(o.id) && o.title === title);
        if (match) consumed.add(match.id);
        return match ?? null;
      };
      data.tracks.forEach((t, i) => {
        const position = t.position ?? i + 1;
        const match = claim(position, t.title);
        if (match) updateTrack.run(position, t.title, t.duration || null, match.id);
        else insertTrack.run(id, position, t.title, t.duration || null, null);
      });
      for (const old of oldTracks) {
        if (!consumed.has(old.id)) {
          // Defense in depth: FKs may have been off on connections opened in the past.
          if (deleteTrackPlaylistEntries) deleteTrackPlaylistEntries.run(old.id);
          deleteTrack.run(old.id);
        }
      }
    }
  });
  run();
  return getAlbumById(id);
}

export function deleteAlbum(id) {
  const db = getDb();
  const { changes } = db.prepare('DELETE FROM albums WHERE id = ?').run(id);
  return changes > 0;
}

export function getGenres() {
  return getDb().prepare('SELECT DISTINCT genre FROM albums WHERE genre IS NOT NULL ORDER BY genre COLLATE NOCASE').all().map(r => r.genre);
}

export function getArtistLetters({ wanted } = {}) {
  const db = getDb();
  const conditions = [];
  if (wanted === 'true' || wanted === true) conditions.push('a.is_wanted = 1');
  if (wanted === 'false' || wanted === false) conditions.push('a.is_wanted = 0');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT DISTINCT UPPER(SUBSTR(ar.name, 1, 1)) AS letter
    FROM albums a
    JOIN artists ar ON ar.id = a.artist_id
    ${where}
    ORDER BY letter
  `).all().map(r => r.letter);
}

export function getStats() {
  const db = getDb();

  const total_owned   = db.prepare('SELECT COUNT(*) AS c FROM albums WHERE is_wanted = 0').get().c;
  const total_wanted  = db.prepare('SELECT COUNT(*) AS c FROM albums WHERE is_wanted = 1').get().c;
  const total_lent    = db.prepare('SELECT COUNT(*) AS c FROM albums WHERE is_lent = 1 AND is_wanted = 0').get().c;
  const total_artists = db.prepare('SELECT COUNT(DISTINCT artist_id) AS c FROM albums WHERE is_wanted = 0').get().c;
  const avg_rating_row = db.prepare(
    'SELECT ROUND(AVG(CAST(rating AS REAL)), 1) AS avg FROM albums WHERE rating IS NOT NULL AND rating > 0 AND is_wanted = 0'
  ).get();
  const avg_rating = avg_rating_row?.avg ?? null;

  const by_genre = db.prepare(`
    SELECT genre, COUNT(*) AS count FROM albums
    WHERE genre IS NOT NULL AND genre != '' AND is_wanted = 0
    GROUP BY genre ORDER BY count DESC LIMIT 12
  `).all();

  const by_decade = db.prepare(`
    SELECT (year / 10 * 10) AS decade, COUNT(*) AS count FROM albums
    WHERE year IS NOT NULL AND year > 1900 AND is_wanted = 0
    GROUP BY decade ORDER BY decade ASC
  `).all();

  const top_artists = db.prepare(`
    SELECT ar.name, COUNT(*) AS count FROM albums a
    JOIN artists ar ON ar.id = a.artist_id
    WHERE a.is_wanted = 0
    GROUP BY ar.id ORDER BY count DESC LIMIT 10
  `).all();

  const top_labels = db.prepare(`
    SELECT l.name, COUNT(*) AS count FROM albums a
    JOIN labels l ON l.id = a.label_id
    WHERE a.label_id IS NOT NULL AND a.is_wanted = 0
    GROUP BY l.id ORDER BY count DESC LIMIT 10
  `).all();

  const durations = db.prepare(
    'SELECT total_duration FROM albums WHERE total_duration IS NOT NULL AND is_wanted = 0'
  ).all();

  let total_minutes = 0;
  for (const { total_duration } of durations) {
    const parts = String(total_duration).trim().split(':').map(Number);
    if (parts.length === 3) total_minutes += parts[0] * 60 + parts[1] + parts[2] / 60;
    else if (parts.length === 2) total_minutes += parts[0] + parts[1] / 60;
  }

  return {
    total_owned, total_wanted, total_lent, total_artists, avg_rating,
    total_duration_hours: Math.floor(total_minutes / 60),
    total_duration_mins:  Math.round(total_minutes % 60),
    by_genre, by_decade, top_artists, top_labels,
  };
}

// ── Audio player ──────────────────────────────────────────────────────────────

export function getAlbumsForMatching({ manualOnly = false } = {}) {
  const db = getDb();
  const where = manualOnly ? 'WHERE a.audio_folder IS NOT NULL' : '';
  const albums = db.prepare(`
    SELECT a.id, a.title, a.audio_folder, ar.name AS artist_name
    FROM albums a
    JOIN artists ar ON ar.id = a.artist_id
    ${where}
  `).all();
  const tracksStmt = db.prepare('SELECT id, position, title FROM tracks WHERE album_id = ? ORDER BY position');
  for (const album of albums) {
    album.tracks = tracksStmt.all(album.id);
  }
  return albums;
}

export function setTrackFilePaths(entries) {
  const db = getDb();
  const update = db.prepare('UPDATE tracks SET file_path = ? WHERE id = ?');
  db.transaction(() => {
    for (const { trackId, filePath } of entries) update.run(filePath, trackId);
  })();
}

export function clearAllFilePaths({ keepManual = true } = {}) {
  const db = getDb();
  const where = keepManual
    ? 'WHERE album_id IN (SELECT id FROM albums WHERE audio_folder IS NULL)'
    : '';
  db.prepare(`UPDATE tracks SET file_path = NULL ${where}`).run();
}

export function setAlbumAudioFolder(albumId, folder) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE albums SET audio_folder = ?, updated_at = datetime('now') WHERE id = ?").run(folder, albumId);
    if (folder === null) {
      db.prepare('UPDATE tracks SET file_path = NULL WHERE album_id = ?').run(albumId);
    }
  })();
}

export function getTrackForStream(trackId) {
  return getDb().prepare('SELECT id, file_path FROM tracks WHERE id = ?').get(trackId) || null;
}

export function markTrackPlayed(trackId) {
  const { changes } = getDb()
    .prepare("UPDATE tracks SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ?")
    .run(trackId);
  return changes > 0;
}

export function setTrackFavorite(trackId, isFavorite) {
  const { changes } = getDb()
    .prepare('UPDATE tracks SET is_favorite = ? WHERE id = ?')
    .run(isFavorite ? 1 : 0, trackId);
  if (!changes) return null;
  return { id: trackId, is_favorite: Boolean(isFavorite) };
}

export function getTrackWithAlbum(trackId) {
  return getDb().prepare(`
    SELECT t.id, t.title, t.duration, a.title AS album_title, ar.name AS artist_name
    FROM tracks t
    JOIN albums a ON a.id = t.album_id
    JOIN artists ar ON ar.id = a.artist_id
    WHERE t.id = ?
  `).get(trackId) || null;
}

// ── Queue items ──────────────────────────────────────────────────────────────
// Shared shape between playlists and smart playlists: what the client
// PlayerContext expects as a playable queue entry.

export const QUEUE_TRACK_FIELDS = `
  t.id, t.title, t.duration, (t.file_path IS NOT NULL) AS has_file,
  t.play_count, t.is_favorite,
  a.id AS album_id, a.title AS album_title, a.cover_url,
  ar.name AS artist_name`;

export function mapQueueTrack(row, i) {
  return {
    position: i + 1,
    id: row.id,
    title: row.title,
    duration: row.duration,
    has_file: Boolean(row.has_file),
    play_count: row.play_count,
    is_favorite: Boolean(row.is_favorite),
    album_id: row.album_id,
    album_title: row.album_title,
    artist_name: row.artist_name,
    cover_url: row.cover_url,
  };
}

// ── Playlists ─────────────────────────────────────────────────────────────────

// "3:45" -> 225, "1:02:03" -> 3723, anything else -> null
export function durationToSeconds(text) {
  if (!text) return null;
  const parts = String(text).trim().split(':').map(Number);
  if (parts.some(p => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

export function getPlaylists() {
  const db = getDb();
  const playlists = db.prepare(`
    SELECT p.id, p.name, p.created_at, p.updated_at, COUNT(pt.id) AS track_count
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE
  `).all();
  const durations = db.prepare(`
    SELECT pt.playlist_id, t.duration
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
  `).all();
  const totals = new Map();
  for (const { playlist_id, duration } of durations) {
    const seconds = durationToSeconds(duration);
    if (seconds) totals.set(playlist_id, (totals.get(playlist_id) || 0) + seconds);
  }
  return playlists.map(p => ({ ...p, total_duration_seconds: totals.get(p.id) || 0 }));
}

export function getPlaylistById(id) {
  const db = getDb();
  const playlist = db.prepare('SELECT id, name, created_at, updated_at FROM playlists WHERE id = ?').get(id);
  if (!playlist) return null;
  // Tracks are shaped like PlayerContext queue items so the client can play them as-is.
  playlist.tracks = db.prepare(`
    SELECT pt.id AS entry_id, ${QUEUE_TRACK_FIELDS}
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    JOIN albums a ON a.id = t.album_id
    JOIN artists ar ON ar.id = a.artist_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `).all(id).map((row, i) => ({ entry_id: row.entry_id, ...mapQueueTrack(row, i) }));
  return playlist;
}

export function createPlaylist(name) {
  const { lastInsertRowid } = getDb().prepare('INSERT INTO playlists (name) VALUES (?)').run(name);
  return getPlaylistById(lastInsertRowid);
}

export function renamePlaylist(id, name) {
  const { changes } = getDb()
    .prepare("UPDATE playlists SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name, id);
  return changes > 0 ? getPlaylistById(id) : null;
}

export function deletePlaylist(id) {
  const db = getDb();
  let deleted = false;
  db.transaction(() => {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id);
    deleted = db.prepare('DELETE FROM playlists WHERE id = ?').run(id).changes > 0;
  })();
  return deleted;
}

export function addTracksToPlaylist(playlistId, trackIds) {
  const db = getDb();
  const insert = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
  db.transaction(() => {
    let position = db
      .prepare('SELECT COALESCE(MAX(position), 0) AS max FROM playlist_tracks WHERE playlist_id = ?')
      .get(playlistId).max;
    for (const trackId of trackIds) insert.run(playlistId, trackId, ++position);
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
  })();
  return trackIds.length;
}

export function removePlaylistEntry(playlistId, entryId) {
  const { changes } = getDb()
    .prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?')
    .run(entryId, playlistId);
  return changes > 0;
}

// entryIds = complete ordered list of playlist_tracks.id; returns false if the sets differ
export function reorderPlaylist(playlistId, entryIds) {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ?')
    .all(playlistId)
    .map(r => r.id);
  if (existing.length !== entryIds.length) return false;
  const existingSet = new Set(existing);
  if (!entryIds.every(id => existingSet.has(id))) return false;
  if (new Set(entryIds).size !== entryIds.length) return false;

  const update = db.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?');
  db.transaction(() => {
    entryIds.forEach((entryId, i) => update.run(i + 1, entryId, playlistId));
    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
  })();
  return true;
}

export function getTrackIdsForAlbum(albumId) {
  return getDb()
    .prepare('SELECT id FROM tracks WHERE album_id = ? ORDER BY position')
    .all(albumId)
    .map(r => r.id);
}

export function trackExists(trackId) {
  return Boolean(getDb().prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId));
}

// ── Loan History ──────────────────────────────────────────────────────────────

export function getLoanHistory(albumId) {
  return getDb()
    .prepare('SELECT * FROM loan_history WHERE album_id = ? ORDER BY lent_at DESC')
    .all(albumId);
}

export function addLoanHistory(albumId, lentTo, lentAt) {
  return getDb()
    .prepare('INSERT INTO loan_history (album_id, lent_to, lent_at) VALUES (?, ?, ?)')
    .run(albumId, lentTo, lentAt || new Date().toISOString());
}

export function closeLoan(albumId) {
  return getDb()
    .prepare(`UPDATE loan_history SET returned_at = datetime('now')
              WHERE album_id = ? AND returned_at IS NULL`)
    .run(albumId);
}
