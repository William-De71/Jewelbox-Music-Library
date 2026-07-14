import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANAGER_DB_PATH = path.join(__dirname, '../../data/jewelbox_manager.db');

export function getSetting(key) {
  if (!fs.existsSync(MANAGER_DB_PATH)) return null;
  const db = new Database(MANAGER_DB_PATH, { readonly: true });
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function setSetting(key, value) {
  const db = new Database(MANAGER_DB_PATH);
  try {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  } finally {
    db.close();
  }
}

export function deleteSetting(key) {
  const db = new Database(MANAGER_DB_PATH);
  try {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } finally {
    db.close();
  }
}

// Returns the configured music library root, or null when unset or not a directory.
export function getMusicLibraryPath() {
  const value = getSetting('music_library_path');
  if (!value) return null;
  const resolved = path.resolve(value);
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}
