import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import Fastify from 'fastify';
import { playerRoutes } from '../routes/player.js';
import { getDb } from '../db/database.js';

let app;
let testDb;
let albumId;
let trackIds;

const DEVICE = 'device-web';
const OTHER = 'device-phone';

// Every queue route is device-scoped, so the header goes on every call.
const call = (method, url, payload, device = DEVICE) =>
  app.inject({ method, url, payload, headers: device ? { 'x-device-id': device } : {} });

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  const artistId = testDb.prepare('INSERT INTO artists (name) VALUES (?)').run('Radiohead').lastInsertRowid;
  albumId = testDb.prepare('INSERT INTO albums (title, artist_id, cover_url) VALUES (?, ?, ?)')
    .run('OK Computer', artistId, '/covers/ok.jpg').lastInsertRowid;
  const insertTrack = testDb.prepare(
    'INSERT INTO tracks (album_id, position, title, duration, file_path) VALUES (?, ?, ?, ?, ?)',
  );
  trackIds = [
    insertTrack.run(albumId, 1, 'Airbag', '4:44', 'x/1.mp3').lastInsertRowid,
    insertTrack.run(albumId, 2, 'Paranoid Android', '6:23', 'x/2.mp3').lastInsertRowid,
    insertTrack.run(albumId, 3, 'Subterranean', '4:27', 'x/3.mp3').lastInsertRowid,
  ];

  app = Fastify({ logger: false });
  await app.register(playerRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

beforeEach(() => {
  testDb.exec('DELETE FROM player_queue; DELETE FROM player_queue_state;');
});

describe('GET /player/queue', () => {
  it('requires the X-Device-Id header', async () => {
    const res = await call('GET', '/player/queue', undefined, null);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/X-Device-Id/);
  });

  it('returns an empty queue for an unknown device', async () => {
    const res = await call('GET', '/player/queue');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ device_id: DEVICE, current_index: -1, tracks: [] });
  });
});

describe('PUT /player/queue', () => {
  it('stores the queue and reads it back in order', async () => {
    const put = await call('PUT', '/player/queue', {
      track_ids: [trackIds[2], trackIds[0]],
      current_index: 1,
      position_sec: 12.5,
      device_label: 'Firefox',
    });
    expect(put.statusCode).toBe(200);

    const body = (await call('GET', '/player/queue')).json();
    expect(body.tracks.map(t => t.id)).toEqual([trackIds[2], trackIds[0]]);
    expect(body).toMatchObject({ current_index: 1, position_sec: 12.5, device_label: 'Firefox' });
  });

  it('exposes the queue-item shape the player expects', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0]] });
    const [track] = (await call('GET', '/player/queue')).json().tracks;

    expect(track).toMatchObject({
      id: trackIds[0],
      title: 'Airbag',
      album_id: albumId,
      album_title: 'OK Computer',
      artist_name: 'Radiohead',
      cover_url: '/covers/ok.jpg',
      has_file: true,
      position: 1,
    });
    expect(track.entry_id).toEqual(expect.any(Number));
  });

  it('replaces the previous queue rather than appending', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0], trackIds[1]] });
    await call('PUT', '/player/queue', { track_ids: [trackIds[2]] });

    const body = (await call('GET', '/player/queue')).json();
    expect(body.tracks.map(t => t.id)).toEqual([trackIds[2]]);
  });

  it('silently drops unknown track ids', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0], 99999] });
    const body = (await call('GET', '/player/queue')).json();
    expect(body.tracks.map(t => t.id)).toEqual([trackIds[0]]);
  });

  it('rejects a missing or malformed track_ids', async () => {
    expect((await call('PUT', '/player/queue', {})).statusCode).toBe(400);
    expect((await call('PUT', '/player/queue', { track_ids: [0] })).statusCode).toBe(400);
    expect((await call('PUT', '/player/queue', { track_ids: ['x'] })).statusCode).toBe(400);
  });
});

describe('POST /player/queue/tracks', () => {
  beforeEach(async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0], trackIds[1]] });
  });

  it('appends a single track at the end', async () => {
    const res = await call('POST', '/player/queue/tracks', { track_id: trackIds[2] });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map(t => t.id)).toEqual([trackIds[0], trackIds[1], trackIds[2]]);
  });

  it('appends a whole album', async () => {
    const res = await call('POST', '/player/queue/tracks', { album_id: albumId });
    expect(res.json().tracks.map(t => t.id)).toEqual([
      trackIds[0], trackIds[1], trackIds[0], trackIds[1], trackIds[2],
    ]);
  });

  // "Play next": lands right behind the current track, not at the bottom.
  it('inserts after the given index and renumbers positions', async () => {
    const res = await call('POST', '/player/queue/tracks', { track_id: trackIds[2], after_index: 0 });
    const tracks = res.json().tracks;

    expect(tracks.map(t => t.id)).toEqual([trackIds[0], trackIds[2], trackIds[1]]);
    expect(tracks.map(t => t.position)).toEqual([1, 2, 3]);
  });

  it('keeps album order when inserting an album after an index', async () => {
    const res = await call('POST', '/player/queue/tracks', { album_id: albumId, after_index: 0 });
    expect(res.json().tracks.map(t => t.id)).toEqual([
      trackIds[0], trackIds[0], trackIds[1], trackIds[2], trackIds[1],
    ]);
  });

  it('rejects a negative after_index and unknown targets', async () => {
    expect((await call('POST', '/player/queue/tracks', { track_id: trackIds[0], after_index: -1 })).statusCode).toBe(400);
    expect((await call('POST', '/player/queue/tracks', {})).statusCode).toBe(400);
    expect((await call('POST', '/player/queue/tracks', { track_id: 99999 })).statusCode).toBe(404);
    expect((await call('POST', '/player/queue/tracks', { album_id: 99999 })).statusCode).toBe(404);
  });
});

describe('DELETE /player/queue/tracks/:entryId', () => {
  it('removes one entry and resequences the rest', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0], trackIds[1], trackIds[2]] });
    const { tracks } = (await call('GET', '/player/queue')).json();

    const res = await call('DELETE', `/player/queue/tracks/${tracks[1].entry_id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map(t => t.id)).toEqual([trackIds[0], trackIds[2]]);
    expect(res.json().tracks.map(t => t.position)).toEqual([1, 2]);
  });

  // The same track can sit in the queue twice; entry_id disambiguates.
  it('removes only the targeted occurrence of a duplicated track', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0], trackIds[0]] });
    const { tracks } = (await call('GET', '/player/queue')).json();

    const res = await call('DELETE', `/player/queue/tracks/${tracks[0].entry_id}`);
    expect(res.json().tracks.map(t => t.entry_id)).toEqual([tracks[1].entry_id]);
  });

  it('404s on an unknown entry', async () => {
    expect((await call('DELETE', '/player/queue/tracks/99999')).statusCode).toBe(404);
  });

  it('refuses to delete an entry belonging to another device', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0]] }, OTHER);
    const { tracks } = (await call('GET', '/player/queue', undefined, OTHER)).json();

    const res = await call('DELETE', `/player/queue/tracks/${tracks[0].entry_id}`, undefined, DEVICE);
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /player/queue/state', () => {
  it('updates progress without touching the tracks', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0], trackIds[1]], current_index: 0 });

    const res = await call('PATCH', '/player/queue/state', { current_index: 1, position_sec: 42 });
    expect(res.statusCode).toBe(204);

    const body = (await call('GET', '/player/queue')).json();
    expect(body).toMatchObject({ current_index: 1, position_sec: 42 });
    expect(body.tracks).toHaveLength(2);
  });

  it('rejects malformed values', async () => {
    expect((await call('PATCH', '/player/queue/state', { current_index: 1.5 })).statusCode).toBe(400);
    expect((await call('PATCH', '/player/queue/state', { position_sec: 'x' })).statusCode).toBe(400);
  });
});

describe('DELETE /player/queue', () => {
  it('empties the queue and resets the position', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0]], current_index: 0, position_sec: 30 });

    expect((await call('DELETE', '/player/queue')).statusCode).toBe(204);
    expect((await call('GET', '/player/queue')).json()).toMatchObject({
      tracks: [], current_index: -1, position_sec: 0,
    });
  });
});

describe('device isolation', () => {
  it('keeps one queue per device', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0]] }, DEVICE);
    await call('PUT', '/player/queue', { track_ids: [trackIds[1], trackIds[2]] }, OTHER);

    expect((await call('GET', '/player/queue', undefined, DEVICE)).json().tracks.map(t => t.id))
      .toEqual([trackIds[0]]);
    expect((await call('GET', '/player/queue', undefined, OTHER)).json().tracks.map(t => t.id))
      .toEqual([trackIds[1], trackIds[2]]);
  });

  it('lists other devices but not the caller', async () => {
    await call('PUT', '/player/queue', { track_ids: [trackIds[0]] }, DEVICE);
    await call('PUT', '/player/queue', { track_ids: [trackIds[1]], device_label: 'Xiaomi' }, OTHER);

    const { data } = (await call('GET', '/player/queue/devices', undefined, DEVICE)).json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ device_id: OTHER, device_label: 'Xiaomi', track_count: 1 });
  });
});
