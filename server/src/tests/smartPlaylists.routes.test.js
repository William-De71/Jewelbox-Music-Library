import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import Fastify from 'fastify';
import { smartPlaylistRoutes } from '../routes/smartPlaylists.js';
import { getDb } from '../db/database.js';

let app;
let testDb;
let ids = {};

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  const artistId = testDb.prepare('INSERT INTO artists (name) VALUES (?)').run('Radiohead').lastInsertRowid;
  const album1 = testDb.prepare("INSERT INTO albums (title, artist_id, cover_url, created_at) VALUES (?, ?, ?, datetime('now','-2 days'))")
    .run('OK Computer', artistId, '/covers/ok.jpg').lastInsertRowid;
  const album2 = testDb.prepare("INSERT INTO albums (title, artist_id, created_at) VALUES (?, ?, datetime('now'))")
    .run('Kid A', artistId).lastInsertRowid;

  const insert = testDb.prepare(`
    INSERT INTO tracks (album_id, position, title, duration, file_path, play_count, last_played_at, is_favorite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Playable tracks with varied stats
  ids.airbag = insert.run(album1, 1, 'Airbag', '4:44', 'x/1.mp3', 5, "2026-07-10 10:00:00", 1).lastInsertRowid;
  ids.paranoid = insert.run(album1, 2, 'Paranoid Android', '6:23', 'x/2.mp3', 3, "2026-07-12 10:00:00", 0).lastInsertRowid;
  ids.neverPlayed = insert.run(album2, 1, 'Everything in Its Right Place', '4:11', 'y/1.mp3', 0, null, 0).lastInsertRowid;
  // Track without file: must never appear
  ids.noFile = insert.run(album2, 2, 'Kid A', '4:44', null, 9, "2026-07-13 10:00:00", 1).lastInsertRowid;

  app = Fastify({ logger: false });
  await app.register(smartPlaylistRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

describe('GET /smart-playlists', () => {
  it('lists the 8 smart playlists with coherent counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.map(p => p.key)).toEqual([
      'newest', 'ever_played', 'never_played', 'last_played',
      'most_played', 'favourites', 'all_tracks', 'dynamic_mix',
    ]);
    const byKey = Object.fromEntries(data.map(p => [p.key, p.track_count]));
    expect(byKey.all_tracks).toBe(3);       // the file-less track is excluded
    expect(byKey.ever_played).toBe(2);
    expect(byKey.never_played).toBe(1);
    expect(byKey.favourites).toBe(1);
    expect(byKey.dynamic_mix).toBe(3);
  });
});

describe('GET /smart-playlists/:key', () => {
  it('returns queue-shaped tracks and excludes file-less tracks', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists/all_tracks' });
    expect(res.statusCode).toBe(200);
    const { key, tracks } = res.json();
    expect(key).toBe('all_tracks');
    expect(tracks).toHaveLength(3);
    expect(tracks.map(t => t.id)).not.toContain(ids.noFile);
    expect(tracks[0]).toMatchObject({
      has_file: true,
      artist_name: 'Radiohead',
    });
    expect(tracks[0]).toHaveProperty('album_title');
    expect(tracks[0]).toHaveProperty('cover_url');
    expect(tracks[0]).toHaveProperty('is_favorite');
    expect(tracks.map(t => t.position)).toEqual([1, 2, 3]);
  });

  it('never_played only returns unplayed tracks', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists/never_played' });
    expect(res.json().tracks.map(t => t.id)).toEqual([ids.neverPlayed]);
  });

  it('most_played is sorted by play count descending', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists/most_played' });
    expect(res.json().tracks.map(t => t.id)).toEqual([ids.airbag, ids.paranoid]);
  });

  it('last_played is sorted by date descending', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists/last_played' });
    expect(res.json().tracks.map(t => t.id)).toEqual([ids.paranoid, ids.airbag]);
  });

  it('favourites only returns favourite tracks', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists/favourites' });
    expect(res.json().tracks.map(t => t.id)).toEqual([ids.airbag]);
  });

  it('newest orders by album creation date', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists/newest' });
    expect(res.json().tracks[0].id).toBe(ids.neverPlayed); // Kid A is newer
  });

  it('returns 404 for an unknown key', async () => {
    const res = await app.inject({ method: 'GET', url: '/smart-playlists/unknown' });
    expect(res.statusCode).toBe(404);
  });
});

describe('dynamic mix persistence', () => {
  const getIds = async () =>
    (await app.inject({ method: 'GET', url: '/smart-playlists/dynamic_mix' })).json().tracks.map(t => t.id);

  it('keeps the same list across requests', async () => {
    const first = await getIds();
    expect(first).toHaveLength(3); // whole playable library fits under 50
    expect(first).not.toContain(ids.noFile);
    expect(await getIds()).toEqual(first);
  });

  it('removes a played track and refills the list at the bottom', async () => {
    const before = await getIds();
    const played = before[0];
    const res = await app.inject({
      method: 'POST', url: '/smart-playlists/dynamic_mix/played', payload: { track_id: played },
    });
    expect(res.statusCode).toBe(200);
    const { removed, tracks } = res.json();
    expect(removed).toBe(true);
    // Library of 3: the played track cycles back to the bottom of the list
    expect(tracks.map(t => t.id)).toEqual([...before.slice(1), played]);
    expect(await getIds()).toEqual(tracks.map(t => t.id)); // persisted
  });

  it('reports removed=false for a track not in the list', async () => {
    const res = await app.inject({
      method: 'POST', url: '/smart-playlists/dynamic_mix/played', payload: { track_id: 99999 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(false);
    expect(res.json().tracks).toHaveLength(3);
  });

  it('rejects a non-integer track_id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/smart-playlists/dynamic_mix/played', payload: { track_id: 'abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('manually removes a track and refills the list at the bottom', async () => {
    const before = await getIds();
    const disliked = before[1];
    const res = await app.inject({
      method: 'DELETE', url: `/smart-playlists/dynamic_mix/tracks/${disliked}`,
    });
    expect(res.statusCode).toBe(200);
    const { removed, tracks } = res.json();
    expect(removed).toBe(true);
    // Library of 3: the removed track cycles back to the bottom of the list
    expect(tracks.map(t => t.id)).toEqual([...before.filter(id => id !== disliked), disliked]);
    expect(await getIds()).toEqual(tracks.map(t => t.id)); // persisted
  });

  it('manual removal reports removed=false for a track not in the list', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/smart-playlists/dynamic_mix/tracks/99999' });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(false);
    expect(res.json().tracks).toHaveLength(3);
  });

  it('manual removal rejects a non-integer trackId', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/smart-playlists/dynamic_mix/tracks/abc' });
    expect(res.statusCode).toBe(400);
  });

  it('refresh draws a brand-new persistent mix', async () => {
    const res = await app.inject({ method: 'POST', url: '/smart-playlists/dynamic_mix/refresh' });
    expect(res.statusCode).toBe(200);
    const { key, tracks } = res.json();
    expect(key).toBe('dynamic_mix');
    // Tiny library: the new draw still holds every playable track, none other.
    expect(tracks.map(t => t.id).sort()).toEqual(
      [ids.airbag, ids.paranoid, ids.neverPlayed].sort(),
    );
    // The new list is persisted, not redrawn on the next read.
    expect(await getIds()).toEqual(tracks.map(t => t.id));
  });

  it('drops tracks that lost their audio file and refills', async () => {
    const before = await getIds();
    const victim = before[0];
    testDb.prepare('UPDATE tracks SET file_path = NULL WHERE id = ?').run(victim);
    const after = await getIds();
    expect(after).not.toContain(victim);
    expect(after).toHaveLength(2); // only 2 playable tracks remain in the library
    testDb.prepare('UPDATE tracks SET file_path = ? WHERE id = ?').run('x/restore.mp3', victim);
    expect(await getIds()).toHaveLength(3); // restored track is re-picked to fill up
  });
});
