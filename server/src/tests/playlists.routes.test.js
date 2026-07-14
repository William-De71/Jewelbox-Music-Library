import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import { vi } from 'vitest';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import Fastify from 'fastify';
import { playlistRoutes } from '../routes/playlists.js';
import { getDb } from '../db/database.js';

let app;
let testDb;
let albumId;
let trackIds;

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  const artistId = testDb.prepare('INSERT INTO artists (name) VALUES (?)').run('Radiohead').lastInsertRowid;
  albumId = testDb.prepare('INSERT INTO albums (title, artist_id, cover_url) VALUES (?, ?, ?)')
    .run('OK Computer', artistId, '/covers/ok.jpg').lastInsertRowid;
  const insertTrack = testDb.prepare('INSERT INTO tracks (album_id, position, title, duration, file_path) VALUES (?, ?, ?, ?, ?)');
  trackIds = [
    insertTrack.run(albumId, 1, 'Airbag', '4:44', 'x/1.mp3').lastInsertRowid,
    insertTrack.run(albumId, 2, 'Paranoid Android', '6:23', 'x/2.mp3').lastInsertRowid,
    insertTrack.run(albumId, 3, 'Subterranean', '4:27', null).lastInsertRowid,
  ];

  app = Fastify({ logger: false });
  await app.register(playlistRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

describe('POST /playlists', () => {
  it('creates a playlist', async () => {
    const res = await app.inject({ method: 'POST', url: '/playlists', payload: { name: 'Ma playlist' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Ma playlist');
    expect(body.tracks).toEqual([]);
  });

  it('rejects an empty name', async () => {
    const res = await app.inject({ method: 'POST', url: '/playlists', payload: { name: '  ' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /playlists', () => {
  it('lists playlists with track counts and durations', async () => {
    const res = await app.inject({ method: 'GET', url: '/playlists' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    const pl = body.data.find(p => p.name === 'Ma playlist');
    expect(pl.track_count).toBe(0);
    expect(pl.total_duration_seconds).toBe(0);
  });
});

describe('POST /playlists/:id/tracks', () => {
  it('adds a single track', async () => {
    const res = await app.inject({
      method: 'POST', url: '/playlists/1/tracks', payload: { track_id: trackIds[0] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(1);
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0]).toMatchObject({
      id: trackIds[0],
      title: 'Airbag',
      has_file: true,
      album_id: albumId,
      album_title: 'OK Computer',
      artist_name: 'Radiohead',
      cover_url: '/covers/ok.jpg',
      position: 1,
    });
    expect(body.tracks[0].entry_id).toBeDefined();
  });

  it('adds a whole album at the end', async () => {
    const res = await app.inject({
      method: 'POST', url: '/playlists/1/tracks', payload: { album_id: albumId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(3);
    expect(body.tracks).toHaveLength(4);
    expect(body.tracks.map(t => t.position)).toEqual([1, 2, 3, 4]);
  });

  it('allows duplicate tracks (distinct entry ids)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/playlists/1/tracks', payload: { track_id: trackIds[0] },
    });
    const body = res.json();
    expect(body.tracks).toHaveLength(5);
    const entryIds = body.tracks.map(t => t.entry_id);
    expect(new Set(entryIds).size).toBe(entryIds.length);
  });

  it('returns 404 for unknown playlist / track / album', async () => {
    let res = await app.inject({ method: 'POST', url: '/playlists/999/tracks', payload: { track_id: trackIds[0] } });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: 'POST', url: '/playlists/1/tracks', payload: { track_id: 9999 } });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: 'POST', url: '/playlists/1/tracks', payload: { album_id: 9999 } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when no id is provided', async () => {
    const res = await app.inject({ method: 'POST', url: '/playlists/1/tracks', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /playlists/:id', () => {
  it('returns the playlist detail', async () => {
    const res = await app.inject({ method: 'GET', url: '/playlists/1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toHaveLength(5);
  });

  it('returns 404 for an unknown playlist', async () => {
    const res = await app.inject({ method: 'GET', url: '/playlists/999' });
    expect(res.statusCode).toBe(404);
  });

  it('reports duration totals in the list', async () => {
    const res = await app.inject({ method: 'GET', url: '/playlists' });
    const pl = res.json().data.find(p => p.id === 1);
    expect(pl.track_count).toBe(5);
    // 3×Airbag (284) + Paranoid (383) + Subterranean (267)
    expect(pl.total_duration_seconds).toBe(284 * 3 + 383 + 267);
  });
});

describe('PUT /playlists/:id/tracks (reorder)', () => {
  it('reorders entries', async () => {
    const detail = (await app.inject({ method: 'GET', url: '/playlists/1' })).json();
    const entryIds = detail.tracks.map(t => t.entry_id).reverse();
    const res = await app.inject({ method: 'PUT', url: '/playlists/1/tracks', payload: { entry_ids: entryIds } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map(t => t.entry_id)).toEqual(entryIds);
  });

  it('rejects a mismatched set', async () => {
    const res = await app.inject({ method: 'PUT', url: '/playlists/1/tracks', payload: { entry_ids: [1, 2] } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-array body', async () => {
    const res = await app.inject({ method: 'PUT', url: '/playlists/1/tracks', payload: { entry_ids: 'nope' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /playlists/:id/tracks/:entryId', () => {
  it('removes an entry', async () => {
    const detail = (await app.inject({ method: 'GET', url: '/playlists/1' })).json();
    const entryId = detail.tracks[0].entry_id;
    const res = await app.inject({ method: 'DELETE', url: `/playlists/1/tracks/${entryId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toHaveLength(4);
  });

  it('returns 404 for an unknown entry', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/playlists/1/tracks/9999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /playlists/:id', () => {
  it('renames the playlist', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/playlists/1', payload: { name: 'Renommée' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renommée');
  });

  it('returns 404 for an unknown playlist', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/playlists/999', payload: { name: 'X' } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an empty name', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/playlists/1', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /playlists/:id', () => {
  it('deletes the playlist and its entries', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/playlists/1' });
    expect(res.statusCode).toBe(204);
    const remaining = testDb.prepare('SELECT COUNT(*) AS c FROM playlist_tracks WHERE playlist_id = 1').get().c;
    expect(remaining).toBe(0);
  });

  it('returns 404 when already deleted', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/playlists/1' });
    expect(res.statusCode).toBe(404);
  });
});

describe('cascade from tracks', () => {
  it('deleting a track removes its playlist entries (FK ON)', async () => {
    const created = (await app.inject({ method: 'POST', url: '/playlists', payload: { name: 'Cascade' } })).json();
    await app.inject({ method: 'POST', url: `/playlists/${created.id}/tracks`, payload: { track_id: trackIds[2] } });
    testDb.prepare('DELETE FROM tracks WHERE id = ?').run(trackIds[2]);
    const detail = (await app.inject({ method: 'GET', url: `/playlists/${created.id}` })).json();
    expect(detail.tracks).toHaveLength(0);
  });
});
