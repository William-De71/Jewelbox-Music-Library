import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(),
  getMusicLibraryPath: vi.fn(),
}));

import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { playerRoutes } from '../routes/player.js';
import { getDb } from '../db/database.js';
import { getMusicLibraryPath } from '../db/settings.js';

let app;
let testDb;
let libDir;
let albumId;
let trackIds;

async function waitForScanEnd() {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: '/player/scan/status' });
    const status = res.json();
    if (!status.running && status.finishedAt) return status;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Scan did not finish in time');
}

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  // Fake music library: tag parsing fails on dummy bytes, so matching uses path fallback.
  libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelbox-lib-'));
  const albumDir = path.join(libDir, 'Radiohead', 'OK Computer');
  fs.mkdirSync(albumDir, { recursive: true });
  fs.writeFileSync(path.join(albumDir, '01 - Airbag.mp3'), Buffer.alloc(512, 1));
  fs.writeFileSync(path.join(albumDir, '02 - Paranoid Android.mp3'), Buffer.alloc(512, 2));
  fs.mkdirSync(path.join(libDir, 'Empty Folder'));
  fs.writeFileSync(path.join(libDir, 'notes.txt'), 'not audio');
  getMusicLibraryPath.mockReturnValue(libDir);

  const artistId = testDb.prepare('INSERT INTO artists (name) VALUES (?)').run('Radiohead').lastInsertRowid;
  albumId = testDb.prepare('INSERT INTO albums (title, artist_id) VALUES (?, ?)').run('OK Computer', artistId).lastInsertRowid;
  const insertTrack = testDb.prepare('INSERT INTO tracks (album_id, position, title) VALUES (?, ?, ?)');
  trackIds = [
    insertTrack.run(albumId, 1, 'Airbag').lastInsertRowid,
    insertTrack.run(albumId, 2, 'Paranoid Android').lastInsertRowid,
    insertTrack.run(albumId, 3, 'Subterranean Homesick Alien').lastInsertRowid,
  ];

  app = Fastify({ logger: false });
  await app.register(staticFiles, { root: libDir, serve: false, decorateReply: true });
  await app.register(playerRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
  fs.rmSync(libDir, { recursive: true, force: true });
});

describe('POST /player/scan', () => {
  it('returns 400 when the library path is not configured', async () => {
    getMusicLibraryPath.mockReturnValueOnce(null);
    const res = await app.inject({ method: 'POST', url: '/player/scan' });
    expect(res.statusCode).toBe(400);
  });

  it('starts a scan and matches files via path fallback', async () => {
    const res = await app.inject({ method: 'POST', url: '/player/scan' });
    expect(res.statusCode).toBe(202);

    const status = await waitForScanEnd();
    expect(status.result.matched_tracks).toBe(2);
    expect(status.result.matched_albums).toBe(1);
    expect(status.progress.files_total).toBe(2);

    const rows = testDb.prepare('SELECT id, file_path FROM tracks WHERE album_id = ?').all(albumId);
    expect(rows.find(r => r.id === trackIds[0]).file_path).toBe('Radiohead/OK Computer/01 - Airbag.mp3');
    expect(rows.find(r => r.id === trackIds[1]).file_path).toBe('Radiohead/OK Computer/02 - Paranoid Android.mp3');
    expect(rows.find(r => r.id === trackIds[2]).file_path).toBeNull();
  });
});

describe('GET /player/scan/status', () => {
  it('returns a status object', async () => {
    const res = await app.inject({ method: 'GET', url: '/player/scan/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.running).toBe('boolean');
    expect(body.progress).toHaveProperty('files_scanned');
    expect(body.progress).toHaveProperty('files_total');
  });
});

describe('GET /player/tracks/:id/stream', () => {
  it('streams the file with Range support (206)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/player/tracks/${trackIds[0]}/stream`,
      headers: { range: 'bytes=100-200' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toContain('bytes 100-200/512');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('serves the whole file without Range (200)', async () => {
    const res = await app.inject({ method: 'GET', url: `/player/tracks/${trackIds[0]}/stream` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe('512');
  });

  it('returns 404 for a track without audio file', async () => {
    const res = await app.inject({ method: 'GET', url: `/player/tracks/${trackIds[2]}/stream` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for an unknown track', async () => {
    const res = await app.inject({ method: 'GET', url: '/player/tracks/99999/stream' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when file_path escapes the library root', async () => {
    testDb.prepare('UPDATE tracks SET file_path = ? WHERE id = ?').run('../../etc/passwd', trackIds[2]);
    const res = await app.inject({ method: 'GET', url: `/player/tracks/${trackIds[2]}/stream` });
    expect(res.statusCode).toBe(403);
    testDb.prepare('UPDATE tracks SET file_path = NULL WHERE id = ?').run(trackIds[2]);
  });

  it('returns 400 when the library path is not configured', async () => {
    getMusicLibraryPath.mockReturnValueOnce(null);
    const res = await app.inject({ method: 'GET', url: `/player/tracks/${trackIds[0]}/stream` });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /player/browse', () => {
  it('lists root folders with audio file counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/player/browse' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dir).toBe('');
    expect(body.parent).toBeNull();
    const names = body.folders.map(f => f.name);
    expect(names).toContain('Radiohead');
    expect(names).toContain('Empty Folder');
  });

  it('lists a subfolder with its parent', async () => {
    const res = await app.inject({ method: 'GET', url: `/player/browse?dir=${encodeURIComponent('Radiohead')}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dir).toBe('Radiohead');
    expect(body.parent).toBe('');
    expect(body.folders).toEqual([{ name: 'OK Computer', path: 'Radiohead/OK Computer', audio_files: 2 }]);
  });

  it('rejects path traversal', async () => {
    const res = await app.inject({ method: 'GET', url: `/player/browse?dir=${encodeURIComponent('../..')}` });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a missing directory', async () => {
    const res = await app.inject({ method: 'GET', url: '/player/browse?dir=Nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT/DELETE /player/albums/:id/folder', () => {
  it('associates a folder manually and matches its tracks', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/player/albums/${albumId}/folder`,
      payload: { folder: 'Radiohead/OK Computer' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(2);
    expect(body.total).toBe(3);
    expect(body.album.audio_folder).toBe('Radiohead/OK Computer');
    expect(body.album.tracks.filter(t => t.has_file)).toHaveLength(2);
  });

  it('rejects a folder outside the library', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/player/albums/${albumId}/folder`,
      payload: { folder: '../elsewhere' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown album', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/player/albums/99999/folder',
      payload: { folder: 'Radiohead/OK Computer' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('dissociates the folder and clears file paths', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/player/albums/${albumId}/folder` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.album.audio_folder).toBeNull();
    expect(body.album.tracks.every(t => !t.has_file)).toBe(true);
  });
});
