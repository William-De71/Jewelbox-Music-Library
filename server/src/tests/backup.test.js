import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  backupName,
  backupsToPrune,
  createBackup,
  deleteBackup,
  isBackupName,
  listBackups,
  nextBackupAt,
  normalizeBackupSettings,
  restoreBackup,
} from '../utils/backup.js';

const COVER = `${'a'.repeat(32)}.jpg`;
let tmp;
let root;

function makeCollection(name, albums) {
  const folder = path.join(tmp, 'data', name);
  fs.mkdirSync(path.join(folder, 'covers'), { recursive: true });
  const dbPath = path.join(folder, `${name}.db`);
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE albums (title TEXT)');
  for (const title of albums) db.prepare('INSERT INTO albums VALUES (?)').run(title);
  db.close();
  fs.writeFileSync(path.join(folder, 'covers', COVER), 'jpeg-bytes');
  return { name, path: dbPath, description: `${name} desc`, is_active: 1 };
}

const titles = (dbPath) => {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT title FROM albums').all().map(r => r.title); } finally { db.close(); }
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelbox-backup-'));
  root = path.join(tmp, 'backups');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('settings and schedule', () => {
  it('normalizes what the user sends', () => {
    expect(normalizeBackupSettings({})).toEqual({ frequency: 'off', time: '03:00', weekday: 0, keep: 7 });
    expect(normalizeBackupSettings({ frequency: 'daily', time: '23:59', weekday: 6, keep: 500 }))
      .toEqual({ frequency: 'daily', time: '23:59', weekday: 6, keep: 60 });
    expect(normalizeBackupSettings({ frequency: 'hourly', time: '25:00', weekday: 9, keep: 0 }))
      .toEqual({ frequency: 'off', time: '03:00', weekday: 0, keep: 7 });
  });

  it('is never due when off', () => {
    expect(nextBackupAt({ frequency: 'off' }, null, new Date(2026, 9, 27, 12))).toBeNull();
  });

  it('daily: due at once when the last slot was missed, else the next day', () => {
    const now = new Date(2026, 9, 27, 12, 0); // Tuesday
    const settings = { frequency: 'daily', time: '03:00' };
    expect(nextBackupAt(settings, null, now)).toEqual(new Date(2026, 9, 27, 3, 0));
    expect(nextBackupAt(settings, new Date(2026, 9, 26, 3, 0).toISOString(), now))
      .toEqual(new Date(2026, 9, 27, 3, 0));
    expect(nextBackupAt(settings, new Date(2026, 9, 27, 3, 1).toISOString(), now))
      .toEqual(new Date(2026, 9, 28, 3, 0));
    // Before today's slot: yesterday's is the latest.
    expect(nextBackupAt(settings, new Date(2026, 9, 26, 3, 0).toISOString(), new Date(2026, 9, 27, 2, 0)))
      .toEqual(new Date(2026, 9, 27, 3, 0));
  });

  it('weekly: on the chosen day', () => {
    const settings = { frequency: 'weekly', time: '04:30', weekday: 0 }; // Sunday
    const now = new Date(2026, 9, 27, 12, 0); // Tuesday 27
    expect(nextBackupAt(settings, null, now)).toEqual(new Date(2026, 9, 25, 4, 30));
    expect(nextBackupAt(settings, new Date(2026, 9, 25, 4, 31).toISOString(), now))
      .toEqual(new Date(2026, 10, 1, 4, 30));
    // Sunday before 4:30: the previous Sunday is the latest slot.
    expect(nextBackupAt(settings, new Date(2026, 9, 18, 5, 0).toISOString(), new Date(2026, 9, 25, 4, 0)))
      .toEqual(new Date(2026, 9, 25, 4, 30));
  });

  it('names backups by date, never twice', () => {
    const date = new Date(2026, 9, 27, 3, 4, 5);
    expect(backupName(date)).toBe('jewelbox-20261027-030405');
    expect(backupName(date, new Set(['jewelbox-20261027-030405']))).toBe('jewelbox-20261027-030405-2');
    expect(isBackupName('jewelbox-20261027-030405-2')).toBe(true);
    expect(isBackupName('../etc')).toBe(false);
  });

  it('prunes only the scheduled backups beyond the latest ones', () => {
    const list = [
      { name: 'a', reason: 'scheduled', created_at: '2026-10-01' },
      { name: 'b', reason: 'manual', created_at: '2026-10-02' },
      { name: 'c', reason: 'scheduled', created_at: '2026-10-03' },
      { name: 'd', reason: 'scheduled', created_at: '2026-10-04' },
      { name: 'e', reason: 'before_restore', created_at: '2026-09-01' },
    ];
    expect(backupsToPrune(list, 2)).toEqual(['a']);
  });
});

describe('backup and restore', () => {
  it('backs up every collection with its covers, stored once', async () => {
    const one = makeCollection('william', ['OK Computer']);
    const two = makeCollection('jazz', ['Kind of Blue']);
    const first = await createBackup({ root, databases: [one, two], reason: 'scheduled', now: new Date(2026, 9, 27, 3) });
    await createBackup({ root, databases: [one], now: new Date(2026, 9, 28, 3) });
    expect(first.databases).toEqual([{ name: 'william', covers: 1 }, { name: 'jazz', covers: 1 }]);
    expect(first.size).toBeGreaterThan(0);
    expect(fs.readdirSync(path.join(root, 'covers'))).toEqual([COVER]);
    const list = listBackups(root);
    expect(list.map(b => [b.name, b.reason])).toEqual([
      ['jewelbox-20261028-030000', 'manual'],
      ['jewelbox-20261027-030000', 'scheduled'],
    ]);
    // An unfinished backup (no manifest) is not listed.
    fs.mkdirSync(path.join(root, 'jewelbox-20261029-030000'));
    expect(listBackups(root)).toHaveLength(2);
  });

  it('restores over the collection of the same name, and creates the missing ones', async () => {
    const one = makeCollection('william', ['OK Computer']);
    const two = makeCollection('jazz', ['Kind of Blue']);
    const backup = await createBackup({ root, databases: [one, two] });

    // Afterwards: an album added, a cover lost, the jazz collection deleted.
    const db = new Database(one.path);
    db.prepare("INSERT INTO albums VALUES ('Kid A')").run();
    db.close();
    fs.rmSync(path.join(path.dirname(one.path), 'covers', COVER));
    fs.rmSync(path.dirname(two.path), { recursive: true });

    let closed = false;
    const newJazz = path.join(tmp, 'data', 'jazz-restored', 'jazz.db');
    const restored = restoreBackup(root, backup.name, {
      beforeWrite: () => { closed = true; },
      target: (entry) => ({ path: entry.name === 'william' ? one.path : newJazz }),
    });
    expect(closed).toBe(true);
    expect(restored).toEqual(['william', 'jazz']);
    expect(titles(one.path)).toEqual(['OK Computer']);
    expect(titles(newJazz)).toEqual(['Kind of Blue']);
    expect(fs.existsSync(path.join(path.dirname(one.path), 'covers', COVER))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(newJazz), 'covers', COVER))).toBe(true);
  });

  it('refuses unknown names and deletes a backup', async () => {
    const backup = await createBackup({ root, databases: [makeCollection('william', [])] });
    expect(restoreBackup(root, '../x', { target: () => ({ path: '/nope' }) })).toBeNull();
    expect(deleteBackup(root, 'jewelbox-20000101-000000')).toBe(false);
    expect(deleteBackup(root, backup.name)).toBe(true);
    expect(listBackups(root)).toEqual([]);
    expect(listBackups(path.join(tmp, 'missing'))).toEqual([]);
  });
});
