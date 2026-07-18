import Database from 'better-sqlite3';
import { SCHEMA } from './schema.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const MANAGER_DB_PATH = path.join(DATA_DIR, 'jewelbox_manager.db');

let db;
let currentDbPath = null;

function getManagerDb() {
  const managerDb = new Database(MANAGER_DB_PATH);
  return managerDb;
}

function runMigrations(database) {
  const cols = database.prepare("PRAGMA table_info(albums)").all().map(c => c.name);
  if (!cols.includes('is_wanted')) {
    database.exec("ALTER TABLE albums ADD COLUMN is_wanted INTEGER NOT NULL DEFAULT 0 CHECK(is_wanted IN (0,1))");
    console.log('[Migration] Added is_wanted column to albums');
  }
  if (!cols.includes('lent_at')) {
    database.exec("ALTER TABLE albums ADD COLUMN lent_at TEXT");
    console.log('[Migration] Added lent_at column to albums');
  }
  if (!cols.includes('audio_folder')) {
    database.exec("ALTER TABLE albums ADD COLUMN audio_folder TEXT");
    console.log('[Migration] Added audio_folder column to albums');
  }
  const trackCols = database.prepare("PRAGMA table_info(tracks)").all().map(c => c.name);
  if (!trackCols.includes('file_path')) {
    database.exec("ALTER TABLE tracks ADD COLUMN file_path TEXT");
    console.log('[Migration] Added file_path column to tracks');
  }
  if (!trackCols.includes('play_count')) {
    database.exec("ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0");
    console.log('[Migration] Added play_count column to tracks');
  }
  if (!trackCols.includes('last_played_at')) {
    database.exec("ALTER TABLE tracks ADD COLUMN last_played_at TEXT");
    console.log('[Migration] Added last_played_at column to tracks');
  }
  if (!trackCols.includes('is_favorite')) {
    database.exec("ALTER TABLE tracks ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1))");
    console.log('[Migration] Added is_favorite column to tracks');
  }
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tables.includes('playlists')) {
    database.exec(`
      CREATE TABLE playlists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE playlist_tracks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        added_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
      CREATE INDEX idx_playlist_tracks_track    ON playlist_tracks(track_id);
    `);
    console.log('[Migration] Created playlists tables');
  }
  if (!tables.includes('dynamic_mix_tracks')) {
    database.exec(`
      DROP TABLE IF EXISTS random50_tracks;
      CREATE TABLE dynamic_mix_tracks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE
      );
    `);
    console.log('[Migration] Created dynamic_mix_tracks table');
  }
  if (!tables.includes('play_history')) {
    database.exec(`
      CREATE TABLE play_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL CHECK(item_type IN ('album','playlist')),
        item_id   INTEGER NOT NULL,
        played_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(item_type, item_id)
      );
      CREATE INDEX idx_play_history_played_at ON play_history(played_at DESC);
    `);
    console.log('[Migration] Created play_history table');
  }
  if (!tables.includes('loan_history')) {
    database.exec(`
      CREATE TABLE loan_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id    INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        lent_to     TEXT NOT NULL,
        lent_at     TEXT NOT NULL DEFAULT (datetime('now')),
        returned_at TEXT
      );
      CREATE INDEX idx_loan_history_album ON loan_history(album_id);
    `);
    console.log('[Migration] Created loan_history table');
  }
}

export function getDb() {
  // Get active database from manager
  const managerDb = getManagerDb();
  const activeDb = managerDb.prepare('SELECT * FROM databases WHERE is_active = 1 LIMIT 1').get();
  managerDb.close();
  
  if (!activeDb) {
    throw new Error('No active database found');
  }
  
  // If database changed or not initialized, reinitialize
  if (!db || currentDbPath !== activeDb.path) {
    if (db) {
      db.close();
    }
    
    if (!fs.existsSync(activeDb.path)) {
      throw new Error('Active database file not found');
    }
    
    db = new Database(activeDb.path);
    db.pragma('foreign_keys = ON');
    currentDbPath = activeDb.path;
    runMigrations(db);
  }
  
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    currentDbPath = null;
  }
}
