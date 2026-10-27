import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSetting, setSetting } from '../db/settings.js';
import { getManagerDb } from '../db/manager.js';
import { closeDb } from '../db/database.js';
import {
  BACKUP_KEEP_MAX,
  backupsToPrune,
  createBackup,
  deleteBackup,
  listBackups,
  nextBackupAt,
  normalizeBackupSettings,
  restoreBackup,
} from '../utils/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
export const DEFAULT_BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CHECK_MS = 60_000;

export function getBackupSettings() {
  let raw = {};
  try { raw = JSON.parse(getSetting('backup_settings') || '{}'); } catch { /* defaults */ }
  return { ...normalizeBackupSettings(raw), dir: getSetting('backup_dir') || DEFAULT_BACKUP_DIR };
}

const allDatabases = () => getManagerDb().prepare('SELECT * FROM databases ORDER BY id').all();

let running = false;

// One backup at a time; scheduled ones prune the old scheduled ones after.
export async function runBackup(reason) {
  if (running) {
    const err = new Error('A backup is already running');
    err.code = 'BACKUP_RUNNING';
    throw err;
  }
  running = true;
  try {
    const { dir, keep } = getBackupSettings();
    const backup = await createBackup({ root: dir, databases: allDatabases(), reason });
    if (reason === 'scheduled') {
      setSetting('backup_last_at', backup.created_at);
      for (const name of backupsToPrune(listBackups(dir), keep)) deleteBackup(dir, name);
    }
    return backup;
  } finally {
    running = false;
  }
}

// Checks every minute whether a scheduled backup is due.
export function startBackupScheduler({ now = () => new Date(), log = console } = {}) {
  const check = async () => {
    try {
      const settings = getBackupSettings();
      const due = nextBackupAt(settings, getSetting('backup_last_at'), now());
      if (!due || due > now() || running) return;
      const backup = await runBackup('scheduled');
      log.info?.(`[Backup] ${backup.name} (${backup.databases.length} collection(s))`);
    } catch (err) {
      log.error?.(`[Backup] failed: ${err.message}`);
      // Not again every minute: the next slot.
      setSetting('backup_last_at', now().toISOString());
    }
  };
  const timer = setInterval(check, CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function backupRoutes(fastify) {
  fastify.get('/backups', async () => {
    const settings = getBackupSettings();
    const lastAt = getSetting('backup_last_at');
    return {
      settings,
      default_dir: DEFAULT_BACKUP_DIR,
      last_at: lastAt,
      next_at: nextBackupAt(settings, lastAt)?.toISOString() ?? null,
      running,
      backups: listBackups(settings.dir),
    };
  });

  fastify.put('/backups/settings', async (req, reply) => {
    const body = req.body ?? {};
    const settings = normalizeBackupSettings(body);
    if (body.keep != null && (!Number.isInteger(body.keep) || body.keep < 1 || body.keep > BACKUP_KEEP_MAX)) {
      return reply.code(400).send({ error: `keep must be an integer between 1 and ${BACKUP_KEEP_MAX}` });
    }
    if (body.dir != null && body.dir !== '') {
      const dir = String(body.dir);
      if (!path.isAbsolute(dir)) return reply.code(400).send({ error: 'dir must be an absolute path' });
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        return reply.code(400).send({ error: 'dir cannot be written' });
      }
      setSetting('backup_dir', path.resolve(dir));
    } else if (body.dir === '') {
      setSetting('backup_dir', '');
    }
    const { frequency, time, weekday, keep } = settings;
    setSetting('backup_settings', JSON.stringify({ frequency, time, weekday, keep }));
    return getBackupSettings();
  });

  fastify.post('/backups', async (req, reply) => {
    try {
      return reply.code(201).send(await runBackup('manual'));
    } catch (err) {
      if (err.code === 'BACKUP_RUNNING') return reply.code(409).send({ error: err.message });
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.delete('/backups/:name', async (req, reply) => {
    const { dir } = getBackupSettings();
    if (!deleteBackup(dir, req.params.name)) return reply.code(404).send({ error: 'Backup not found' });
    return reply.code(204).send();
  });

  // Restores every collection of a backup, after a safety backup of the
  // current state (kept until deleted by hand).
  fastify.post('/backups/:name/restore', async (req, reply) => {
    const { dir } = getBackupSettings();
    if (!listBackups(dir).some(b => b.name === req.params.name)) {
      return reply.code(404).send({ error: 'Backup not found' });
    }
    try {
      const safety = await runBackup('before_restore');
      const manager = getManagerDb();
      const restored = restoreBackup(dir, req.params.name, {
        beforeWrite: closeDb,
        target: (entry) => {
          const existing = manager.prepare('SELECT * FROM databases WHERE name = ?').get(entry.name);
          if (existing) return { path: existing.path };
          const folder = path.join(DATA_DIR, entry.name.replace(/[/\\]/g, '_'));
          const dbPath = path.join(folder, `${path.basename(folder)}.db`);
          manager.prepare('INSERT INTO databases (name, path, description) VALUES (?, ?, ?)')
            .run(entry.name, dbPath, entry.description ?? '');
          return { path: dbPath };
        },
      });
      return { restored, safety_backup: safety.name };
    } catch (err) {
      if (err.code === 'BACKUP_RUNNING') return reply.code(409).send({ error: err.message });
      return reply.code(500).send({ error: err.message });
    }
  });
}
