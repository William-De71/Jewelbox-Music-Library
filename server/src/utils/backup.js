import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// Backups of the collections: every collection database (SQLite backup API,
// consistent while the server runs) and its covers.
//
//   <root>/jewelbox-20261027-030000/manifest.json   what it holds
//   <root>/jewelbox-20261027-030000/<name>.db        one per collection
//   <root>/covers/<file>                             covers, shared by all backups
//
// Covers never change once written (their name is the md5 of the image), so
// they are stored once for every backup that lists them. The scheduler keeps
// the `keep` latest scheduled backups; manual ones and the safety copy taken
// before a restore stay until deleted by hand.

export const BACKUP_FREQUENCIES = ['off', 'daily', 'weekly'];
export const BACKUP_DEFAULTS = { frequency: 'off', time: '03:00', weekday: 0, keep: 7 };
export const BACKUP_KEEP_MAX = 60;
const NAME = /^jewelbox-\d{8}-\d{6}(-\d{1,3})?$/;
const COVER = /^[0-9a-f]{32}\.(jpe?g|png|webp)$/i;
const MANIFEST = 'manifest.json';
const COVERS = 'covers';

export const isBackupName = (name) => NAME.test(String(name ?? ''));

// Clean settings from what the user sent (or what was stored).
export function normalizeBackupSettings(raw = {}) {
  const frequency = BACKUP_FREQUENCIES.includes(raw.frequency) ? raw.frequency : BACKUP_DEFAULTS.frequency;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time ?? '') ? raw.time : BACKUP_DEFAULTS.time;
  const weekday = Number.isInteger(Number(raw.weekday)) && Number(raw.weekday) >= 0 && Number(raw.weekday) <= 6
    ? Number(raw.weekday)
    : BACKUP_DEFAULTS.weekday;
  const keep = Math.min(BACKUP_KEEP_MAX, Math.max(1, Math.round(Number(raw.keep) || BACKUP_DEFAULTS.keep)));
  return { frequency, time, weekday, keep };
}

// When the next scheduled backup is due (server time zone), null when off.
// A missed slot (server stopped at 3:00) is caught up at once: due is in the past.
export function nextBackupAt(settings, lastAt, now = new Date()) {
  const { frequency, time, weekday } = normalizeBackupSettings(settings);
  if (frequency === 'off') return null;
  const [hours, minutes] = time.split(':').map(Number);
  const slot = (from) => {
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hours, minutes);
    if (frequency === 'weekly') at.setDate(at.getDate() - ((at.getDay() - weekday + 7) % 7));
    return at;
  };
  // The latest slot at or before now: due unless a backup was made since.
  let latest = slot(now);
  if (latest > now) latest = frequency === 'weekly'
    ? new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() - 7, hours, minutes)
    : new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() - 1, hours, minutes);
  if (!lastAt || new Date(lastAt) < latest) return latest;
  const step = frequency === 'weekly' ? 7 : 1;
  return new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() + step, hours, minutes);
}

const pad = (n) => String(n).padStart(2, '0');
export function backupName(date, taken = new Set()) {
  const base = `jewelbox-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  return name;
}

// The scheduled backups beyond the `keep` latest.
export function backupsToPrune(backups, keep) {
  return backups
    .filter(b => b.reason === 'scheduled')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(keep)
    .map(b => b.name);
}

const sizeOf = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };

function coversOf(dbPath) {
  const folder = path.join(path.dirname(dbPath), COVERS);
  try {
    return fs.readdirSync(folder).filter(name => COVER.test(name));
  } catch {
    return [];
  }
}

// Makes a backup of `databases` ([{ name, path, description, is_active }]).
export async function createBackup({ root, databases, reason = 'manual', now = new Date() }) {
  fs.mkdirSync(path.join(root, COVERS), { recursive: true });
  const name = backupName(now, new Set(fs.readdirSync(root)));
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const entries = [];
  try {
    for (const [i, record] of databases.entries()) {
      if (!fs.existsSync(record.path)) continue;
      const file = `${i + 1}.db`;
      const source = new Database(record.path, { readonly: true, fileMustExist: true });
      try {
        await source.backup(path.join(dir, file));
      } finally {
        source.close();
      }
      const covers = coversOf(record.path);
      const coverDir = path.join(path.dirname(record.path), COVERS);
      for (const cover of covers) {
        const target = path.join(root, COVERS, cover);
        if (!fs.existsSync(target)) fs.copyFileSync(path.join(coverDir, cover), target);
      }
      entries.push({
        name: record.name,
        description: record.description ?? '',
        is_active: Boolean(record.is_active),
        file,
        covers,
      });
    }
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  const manifest = { version: 1, created_at: now.toISOString(), reason, databases: entries };
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
  return describe(root, name, manifest);
}

function describe(root, name, manifest) {
  const dir = path.join(root, name);
  return {
    name,
    created_at: manifest.created_at,
    reason: manifest.reason,
    databases: manifest.databases.map(d => ({ name: d.name, covers: d.covers.length })),
    size: manifest.databases.reduce((sum, d) => sum + sizeOf(path.join(dir, d.file)), 0),
  };
}

function readManifest(root, name) {
  if (!isBackupName(name)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, name, MANIFEST), 'utf8'));
    return Array.isArray(manifest?.databases) ? manifest : null;
  } catch {
    return null;
  }
}

// Newest first. Folders without a readable manifest (a backup cut short) are left out.
export function listBackups(root) {
  let names;
  try {
    names = fs.readdirSync(root).filter(isBackupName);
  } catch {
    return [];
  }
  return names
    .map(name => {
      const manifest = readManifest(root, name);
      return manifest ? describe(root, name, manifest) : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function deleteBackup(root, name) {
  if (!readManifest(root, name)) return false;
  fs.rmSync(path.join(root, name), { recursive: true, force: true });
  return true;
}

// Puts the collections of a backup back. `target(entry)` gives the database
// file to write for a collection ({ path, created }): an existing collection
// of the same name is overwritten, another one is created by the caller.
// `beforeWrite()` runs first (close the open connection). Settings (library
// path, Last.fm…) are not part of a backup.
export function restoreBackup(root, name, { target, beforeWrite = () => {} }) {
  const manifest = readManifest(root, name);
  if (!manifest) return null;
  beforeWrite();
  const restored = [];
  for (const entry of manifest.databases) {
    const source = path.join(root, name, entry.file);
    if (!fs.existsSync(source)) continue;
    const { path: dbPath } = target(entry);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
    fs.copyFileSync(source, dbPath);
    const coverDir = path.join(path.dirname(dbPath), COVERS);
    fs.mkdirSync(coverDir, { recursive: true });
    for (const cover of entry.covers.filter(c => COVER.test(c))) {
      const from = path.join(root, COVERS, cover);
      const to = path.join(coverDir, cover);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
    }
    restored.push(entry.name);
  }
  return restored;
}
