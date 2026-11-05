import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gunzipSync } from 'zlib';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelbox-backups-route-'));
const root = path.join(tmp, 'backups');

// The route reads its folder from the settings: no real data is touched.
vi.mock('../db/settings.js', () => ({
  getSetting: (key) => (key === 'backup_dir' ? root : null),
  setSetting: () => {},
}));
vi.mock('../db/manager.js', () => ({ getManagerDb: () => null }));
vi.mock('../db/database.js', () => ({ closeDb: () => {} }));

const { backupRoutes } = await import('../routes/backups.js');
const { createBackup } = await import('../utils/backup.js');

let app;
let backup;
beforeAll(async () => {
  const dbPath = path.join(tmp, 'william.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE albums (title TEXT)');
  db.close();
  backup = await createBackup({ root, databases: [{ name: 'william', path: dbPath }] });
  app = Fastify({ logger: false });
  await app.register(backupRoutes, { prefix: '/api' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('GET /api/backups/:name/download', () => {
  it('sends the backup as a named .tar.gz', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/backups/${backup.name}/download` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${backup.name}.tar.gz"`);
    const listing = execFileSync('tar', ['t'], { input: gunzipSync(res.rawPayload), encoding: 'utf8' });
    expect(listing.trim().split('\n')).toEqual([`${backup.name}/manifest.json`, `${backup.name}/1.db`]);
  });

  it.each(['jewelbox-20000101-000000', '..%2F..%2Fetc', 'manifest.json'])('answers 404 for %s', async (name) => {
    const res = await app.inject({ method: 'GET', url: `/api/backups/${name}/download` });
    expect(res.statusCode).toBe(404);
  });
});
