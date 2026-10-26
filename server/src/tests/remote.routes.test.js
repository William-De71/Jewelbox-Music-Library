import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import Fastify from 'fastify';
import { playerRoutes } from '../routes/player.js';
import { remoteRoutes, remote } from '../routes/remote.js';
import { getDb } from '../db/database.js';
import { createRemoteRegistry, validateCommand, parseLiveState, REPORT_TTL_MS } from '../utils/remote.js';

let app;
let base;
let testDb;
let albumId;
let trackIds;

// Opens an event stream for real (inject cannot read a response that never
// ends) and collects its events.
function openEvents(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    const waiters = [];
    const req = http.get(`${base}${path}`, { headers }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (!event) continue;
          events.push({ event, data: JSON.parse(data) });
          waiters.splice(0).forEach(w => w());
        }
      });
      const next = async (name) => {
        for (;;) {
          const found = events.findIndex(e => e.event === name);
          if (found >= 0) return events.splice(found, 1)[0].data;
          await new Promise(r => waiters.push(r));
        }
      };
      resolve({ res, next, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}

const until = async (predicate) => {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('condition never met');
};

const command = (device, payload) =>
  app.inject({ method: 'POST', url: `/player/remote/devices/${device}/commands`, payload });

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  const artistId = testDb.prepare('INSERT INTO artists (name) VALUES (?)').run('Radiohead').lastInsertRowid;
  albumId = Number(testDb.prepare('INSERT INTO albums (title, artist_id, cover_url) VALUES (?, ?, ?)')
    .run('OK Computer', artistId, '/covers/ok.jpg').lastInsertRowid);
  const insertTrack = testDb.prepare(
    'INSERT INTO tracks (album_id, position, title, duration, file_path) VALUES (?, ?, ?, ?, ?)',
  );
  trackIds = [
    Number(insertTrack.run(albumId, 1, 'Airbag', '4:44', 'x/1.mp3').lastInsertRowid),
    Number(insertTrack.run(albumId, 2, 'Paranoid Android', '6:23', 'x/2.mp3').lastInsertRowid),
  ];

  app = Fastify({ logger: false });
  await app.register(playerRoutes);
  await app.register(remoteRoutes);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

beforeEach(() => {
  testDb.exec('DELETE FROM player_queue; DELETE FROM player_queue_state;');
});

describe('validateCommand', () => {
  const all = ['seek', 'volume', 'mute', 'shuffle', 'repeat', 'queue', 'play_media', 'append'];

  it('accepts the basic commands from any player', () => {
    for (const name of ['play', 'pause', 'toggle', 'next', 'previous']) {
      expect(validateCommand({ command: name }, [])).toEqual({ command: { command: name } });
    }
  });

  it('refuses an unknown command', () => {
    expect(validateCommand({ command: 'eject' }, all)).toMatchObject({ status: 400 });
  });

  it('refuses a command the player did not announce', () => {
    expect(validateCommand({ command: 'volume', volume: 10 }, [])).toMatchObject({ status: 422 });
    expect(validateCommand({ command: 'play_media', media: { type: 'album', id: 1 }, mode: 'next' }, ['play_media']))
      .toMatchObject({ status: 422 });
  });

  it('checks and keeps only the arguments of the command', () => {
    expect(validateCommand({ command: 'volume', volume: 33.6, extra: 1 }, all))
      .toEqual({ command: { command: 'volume', volume: 34 } });
    expect(validateCommand({ command: 'volume', volume: 101 }, all)).toMatchObject({ status: 400 });
    expect(validateCommand({ command: 'seek', position_sec: -1 }, all)).toMatchObject({ status: 400 });
    expect(validateCommand({ command: 'mute', muted: 'yes' }, all)).toMatchObject({ status: 400 });
    expect(validateCommand({ command: 'repeat', repeat: 'one' }, all))
      .toEqual({ command: { command: 'repeat', repeat: 'one' } });
    expect(validateCommand({ command: 'play_index', index: 1.5 }, all)).toMatchObject({ status: 400 });
  });

  it('validates the media of play_media, replace by default', () => {
    expect(validateCommand({ command: 'play_media', media: { type: 'album', id: 3 } }, all))
      .toEqual({ command: { command: 'play_media', media: { type: 'album', id: 3 }, mode: 'replace' } });
    expect(validateCommand({ command: 'play_media', media: { type: 'smart', id: 'favourites' }, mode: 'append' }, all))
      .toMatchObject({ command: { media: { type: 'smart', id: 'favourites' }, mode: 'append' } });
    expect(validateCommand({ command: 'play_media', media: { type: 'album', id: '3' } }, all)).toMatchObject({ status: 400 });
    expect(validateCommand({ command: 'play_media', media: { type: 'genre', id: 3 } }, all)).toMatchObject({ status: 400 });
  });
});

describe('parseLiveState', () => {
  it('ignores a plain position ping', () => {
    expect(parseLiveState({ current_index: 1, position_sec: 3 })).toBeNull();
  });

  it('keeps the valid live fields only', () => {
    expect(parseLiveState({
      playback_state: 'playing', position_sec: 12, duration_sec: 200, current_index: 0, track_id: 4,
      volume: 140, muted: false, shuffle: true, repeat: 'sometimes', label: 'x',
    })).toEqual({
      playback_state: 'playing', position_sec: 12, duration_sec: 200, current_index: 0, track_id: 4,
      volume: 100, muted: false, shuffle: true,
    });
  });
});

describe('createRemoteRegistry', () => {
  it('lists a reporting player until its report is too old', () => {
    let clock = 1_000_000;
    const registry = createRemoteRegistry({ now: () => clock });
    registry.report('phone', { playback_state: 'paused' }, { label: 'Phone' });
    expect(registry.list()).toMatchObject([{ device_id: 'phone', device_label: 'Phone', controllable: false }]);
    clock += REPORT_TTL_MS;
    expect(registry.list()).toEqual([]);
  });

  it('sends a command to the most recent stream only', () => {
    const registry = createRemoteRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.connect('web', { send: first, capabilities: '' });
    const detach = registry.connect('web', { send: second, capabilities: 'volume' });
    expect(registry.send('web', { command: 'volume', volume: 20 })).toHaveProperty('id');
    expect(second).toHaveBeenCalledWith('command', expect.objectContaining({ command: 'volume', volume: 20 }));
    expect(first).not.toHaveBeenCalled();
    detach();
    // the older tab is the stream left: it announced no volume
    expect(registry.send('web', { command: 'volume', volume: 20 })).toMatchObject({ status: 422 });
  });

  it('tells the watchers about every change', () => {
    const registry = createRemoteRegistry();
    const events = [];
    registry.watch(e => events.push(e));
    const detach = registry.connect('desk', { send: () => {}, capabilities: 'seek', label: 'Desk' });
    registry.report('desk', { playback_state: 'playing' });
    detach();
    expect(events.map(e => e.event)).toEqual(['device', 'device', 'device']);
    expect(events[0].data).toMatchObject({ controllable: true, capabilities: ['seek'] });
    expect(events[2].data).toMatchObject({ controllable: false, state: { playback_state: 'playing' } });
  });

  it('says a player is gone when its last stream closes without a report', () => {
    const registry = createRemoteRegistry();
    const events = [];
    registry.watch(e => events.push(e));
    registry.connect('desk', { send: () => {} })();
    expect(events.at(-1)).toEqual({ event: 'gone', data: { device_id: 'desk' } });
  });
});

describe('remote control routes', () => {
  it('needs a device id to open the player stream', async () => {
    const res = await app.inject({ method: 'GET', url: '/player/remote/events' });
    expect(res.statusCode).toBe(400);
  });

  it('answers 404 for a player without a stream', async () => {
    const res = await command('nobody', { command: 'pause' });
    expect(res.statusCode).toBe(404);
  });

  it('delivers a command on the stream of the player', async () => {
    const player = await openEvents('/player/remote/events?device_id=web-1&label=Firefox&capabilities=volume,seek,bogus');
    expect(player.res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(await player.next('hello')).toEqual({ device_id: 'web-1' });

    const list = await app.inject({ method: 'GET', url: '/player/remote/devices' });
    expect(list.json().data).toEqual([
      expect.objectContaining({ device_id: 'web-1', device_label: 'Firefox', controllable: true, capabilities: ['volume', 'seek'] }),
    ]);

    const res = await command('web-1', { command: 'seek', position_sec: 42 });
    expect(res.statusCode).toBe(202);
    expect(await player.next('command')).toEqual({ id: res.json().id, command: 'seek', position_sec: 42 });

    expect((await command('web-1', { command: 'shuffle', shuffle: true })).statusCode).toBe(422);
    player.close();
    await until(() => remote.get('web-1') === null);
  });

  it('checks that the media to play exists', async () => {
    const player = await openEvents('/player/remote/events', { 'x-device-id': 'desk-1' });
    await player.next('hello');
    const url = '/player/remote/events?device_id=desk-2&capabilities=play_media,append';
    const desk = await openEvents(url);
    await desk.next('hello');

    expect((await command('desk-1', { command: 'play_media', media: { type: 'album', id: albumId } })).statusCode).toBe(422);
    expect((await command('desk-2', { command: 'play_media', media: { type: 'album', id: 9999 } })).statusCode).toBe(404);
    expect((await command('desk-2', { command: 'play_media', media: { type: 'smart', id: 'nope' } })).statusCode).toBe(404);
    const ok = await command('desk-2', { command: 'play_media', media: { type: 'album', id: albumId }, mode: 'next' });
    expect(ok.statusCode).toBe(202);
    expect(await desk.next('command')).toMatchObject({ command: 'play_media', media: { type: 'album', id: albumId }, mode: 'next' });
    player.close();
    desk.close();
    await until(() => remote.list().length === 0);
  });

  it('keeps the live state of a report and resolves its track', async () => {
    await app.inject({
      method: 'PUT', url: '/player/queue', headers: { 'x-device-id': 'phone-1' },
      payload: { track_ids: trackIds, current_index: 1, device_label: 'Pixel' },
    });
    const watcher = await openEvents('/player/remote/watch');
    expect(await watcher.next('devices')).toEqual({ data: [] });

    const res = await app.inject({
      method: 'PATCH', url: '/player/queue/state', headers: { 'x-device-id': 'phone-1' },
      payload: { current_index: 1, position_sec: 30, playback_state: 'playing', track_id: trackIds[1], shuffle: false, repeat: 'all' },
    });
    expect(res.statusCode).toBe(204);

    const event = await watcher.next('device');
    expect(event).toMatchObject({
      device_id: 'phone-1',
      device_label: 'Pixel',
      controllable: false,
      state: {
        playback_state: 'playing', position_sec: 30, current_index: 1, shuffle: false, repeat: 'all',
        track: { id: trackIds[1], title: 'Paranoid Android', artist_name: 'Radiohead', album_title: 'OK Computer', cover_url: '/covers/ok.jpg' },
      },
    });
    expect(event.state.reported_at).toMatch(/Z$/);
    // the queue position is still saved as before
    const queue = await app.inject({ method: 'GET', url: '/player/queue', headers: { 'x-device-id': 'phone-1' } });
    expect(queue.json()).toMatchObject({ current_index: 1, position_sec: 30 });
    watcher.close();
  });

  it('gives one track in the queue shape', async () => {
    const res = await app.inject({ method: 'GET', url: `/player/tracks/${trackIds[0]}` });
    expect(res.json()).toEqual({
      id: trackIds[0], title: 'Airbag', duration: '4:44', has_file: true, play_count: 0, is_favorite: false,
      album_id: albumId, album_title: 'OK Computer', artist_name: 'Radiohead', cover_url: '/covers/ok.jpg',
    });
    expect((await app.inject({ method: 'GET', url: '/player/tracks/9999' })).statusCode).toBe(404);
  });

  it('ignores a plain position ping for the live state', async () => {
    await app.inject({
      method: 'PATCH', url: '/player/queue/state', headers: { 'x-device-id': 'old-player' },
      payload: { current_index: 0, position_sec: 5 },
    });
    expect(remote.get('old-player')).toBeNull();
  });
});
