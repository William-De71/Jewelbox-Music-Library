export const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS artists (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS labels (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS albums (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    artist_id      INTEGER NOT NULL REFERENCES artists(id) ON DELETE RESTRICT,
    label_id       INTEGER REFERENCES labels(id) ON DELETE SET NULL,
    year           INTEGER,
    genre          TEXT,
    total_duration TEXT,
    ean            TEXT UNIQUE,
    rating         INTEGER CHECK(rating BETWEEN 1 AND 5),
    cover_url      TEXT,
    notes          TEXT,
    is_lent        INTEGER NOT NULL DEFAULT 0 CHECK(is_lent IN (0,1)),
    lent_to        TEXT,
    lent_at        TEXT,
    is_wanted      INTEGER NOT NULL DEFAULT 0 CHECK(is_wanted IN (0,1)),
    audio_folder   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    title      TEXT NOT NULL,
    duration   TEXT,
    file_path  TEXT,
    play_count     INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT,
    is_favorite    INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1))
  );

  CREATE INDEX IF NOT EXISTS idx_albums_artist  ON albums(artist_id);
  CREATE INDEX IF NOT EXISTS idx_albums_label   ON albums(label_id);
  CREATE INDEX IF NOT EXISTS idx_albums_genre   ON albums(genre);
  CREATE INDEX IF NOT EXISTS idx_albums_rating  ON albums(rating);
  CREATE INDEX IF NOT EXISTS idx_tracks_album   ON tracks(album_id);

  CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track    ON playlist_tracks(track_id);

  CREATE TABLE IF NOT EXISTS dynamic_mix_tracks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS loan_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id    INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    lent_to     TEXT NOT NULL,
    lent_at     TEXT NOT NULL DEFAULT (datetime('now')),
    returned_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_loan_history_album ON loan_history(album_id);

  CREATE TABLE IF NOT EXISTS play_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL CHECK(item_type IN ('album','playlist','smart')),
    item_id   INTEGER NOT NULL DEFAULT 0,
    item_key  TEXT NOT NULL DEFAULT '',
    played_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(item_type, item_id, item_key)
  );

  CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);

  CREATE TABLE IF NOT EXISTS suggested_albums (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL UNIQUE REFERENCES albums(id) ON DELETE CASCADE,
    day      TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id  TEXT NOT NULL,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_player_queue_device ON player_queue(device_id, position);

  CREATE TABLE IF NOT EXISTS player_queue_state (
    device_id     TEXT PRIMARY KEY,
    device_label  TEXT,
    current_index INTEGER NOT NULL DEFAULT -1,
    position_sec  REAL NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;
