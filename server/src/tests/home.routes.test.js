import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
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
import { playerRoutes } from '../routes/player.js';
import { getDb } from '../db/database.js';

let app;
let testDb;
let albumIds = {};
let playlistId;
let emptyPlaylistId;

function seed() {
  testDb.exec('DELETE FROM play_history; DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks; DELETE FROM albums; DELETE FROM artists;');

  const artistId = testDb.prepare('INSERT INTO artists (name) VALUES (?)').run('Radiohead').lastInsertRowid;
  const insertAlbum = testDb.prepare(
    'INSERT INTO albums (title, artist_id, rating, is_wanted, cover_url) VALUES (?, ?, ?, ?, ?)',
  );
  albumIds = {
    rated5: insertAlbum.run('OK Computer', artistId, 5, 0, '/covers/okc.jpg').lastInsertRowid,
    rated1: insertAlbum.run('Pablo Honey', artistId, 1, 0, null).lastInsertRowid,
    unrated: insertAlbum.run('Kid A', artistId, null, 0, '/covers/kida.jpg').lastInsertRowid,
    wanted: insertAlbum.run('Amnesiac', artistId, 4, 1, null).lastInsertRowid,
    noAudio: insertAlbum.run('Hail to the Thief', artistId, 4, 0, null).lastInsertRowid,
  };

  const insertTrack = testDb.prepare(
    'INSERT INTO tracks (album_id, position, title, duration, file_path, last_played_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const trackIds = {
    okc1: insertTrack.run(albumIds.rated5, 1, 'Airbag', '4:44', 'r/okc/01.mp3', null).lastInsertRowid,
    okc2: insertTrack.run(albumIds.rated5, 2, 'Paranoid Android', '6:23', 'r/okc/02.mp3', null).lastInsertRowid,
    ph1: insertTrack.run(albumIds.rated1, 1, 'Creep', '3:56', 'r/ph/01.mp3', '2020-01-01 00:00:00').lastInsertRowid,
    kida1: insertTrack.run(albumIds.unrated, 1, 'Everything in Its Right Place', '4:11', 'r/kida/01.mp3', null).lastInsertRowid,
    httt1: insertTrack.run(albumIds.noAudio, 1, '2+2=5', '3:19', null, null).lastInsertRowid,
    amn1: insertTrack.run(albumIds.wanted, 1, 'Packt', '4:00', 'r/amn/01.mp3', null).lastInsertRowid,
  };

  playlistId = testDb.prepare('INSERT INTO playlists (name) VALUES (?)').run('Mes titres').lastInsertRowid;
  emptyPlaylistId = testDb.prepare('INSERT INTO playlists (name) VALUES (?)').run('Vide').lastInsertRowid;
  const insertEntry = testDb.prepare(
    'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
  );
  // First track's album has no cover: the derived cover must fall back to the
  // first positioned track whose album has one.
  insertEntry.run(playlistId, trackIds.ph1, 1);
  insertEntry.run(playlistId, trackIds.okc1, 2);

  return trackIds;
}

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  app = Fastify({ logger: false });
  await app.register(playerRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

beforeEach(() => {
  seed();
});

function postHistory(item_type, item_id) {
  return app.inject({ method: 'POST', url: '/player/history', payload: { item_type, item_id } });
}

function getHome() {
  return app.inject({ method: 'GET', url: '/player/home' });
}

describe('POST /player/history', () => {
  it('rejects an invalid item_type', async () => {
    const res = await postHistory('artist', 1);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing or non-positive item_id', async () => {
    for (const bad of [undefined, 0, -3, 1.5, 'x']) {
      const res = await postHistory('album', bad);
      expect(res.statusCode).toBe(400);
    }
  });

  it('returns 404 for an unknown album or playlist', async () => {
    expect((await postHistory('album', 99999)).statusCode).toBe(404);
    expect((await postHistory('playlist', 99999)).statusCode).toBe(404);
  });

  it('records album and playlist plays with 204', async () => {
    expect((await postHistory('album', albumIds.rated5)).statusCode).toBe(204);
    expect((await postHistory('playlist', playlistId)).statusCode).toBe(204);
    const count = testDb.prepare('SELECT COUNT(*) AS n FROM play_history').get().n;
    expect(count).toBe(2);
  });

  it('replaying an item keeps one row and moves it to the front', async () => {
    await postHistory('album', albumIds.rated5);
    testDb.prepare("UPDATE play_history SET played_at = '2020-01-01 00:00:00'").run();
    await postHistory('playlist', playlistId);
    testDb.prepare("UPDATE play_history SET played_at = '2020-01-02 00:00:00' WHERE item_type = 'playlist'").run();
    await postHistory('album', albumIds.rated5);

    const rows = testDb.prepare("SELECT COUNT(*) AS n FROM play_history WHERE item_type = 'album'").get();
    expect(rows.n).toBe(1);

    const home = (await getHome()).json();
    expect(home.recent[0].item_type).toBe('album');
    expect(home.recent[0].album.id).toBe(albumIds.rated5);
  });

  it('caps the history table at 50 rows', async () => {
    const artistId = testDb.prepare('SELECT id FROM artists LIMIT 1').get().id;
    const insertAlbum = testDb.prepare('INSERT INTO albums (title, artist_id) VALUES (?, ?)');
    for (let i = 0; i < 55; i++) {
      const id = insertAlbum.run(`Filler ${i}`, artistId).lastInsertRowid;
      expect((await postHistory('album', id)).statusCode).toBe(204);
    }
    const count = testDb.prepare('SELECT COUNT(*) AS n FROM play_history').get().n;
    expect(count).toBe(50);
  });
});

describe('GET /player/home', () => {
  it('returns empty recent but populated suggestions with no history', async () => {
    const res = await getHome();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recent).toEqual([]);
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it('returns mixed albums and playlists, newest first, capped at 8', async () => {
    // Space entries a minute apart so ordering is deterministic.
    const stamp = testDb.prepare('UPDATE play_history SET played_at = ? WHERE item_type = ? AND item_id = ?');
    const entries = [
      ['album', albumIds.rated1],
      ['album', albumIds.unrated],
      ['playlist', emptyPlaylistId],
      ['album', albumIds.noAudio],
      ['album', albumIds.wanted],
      ['album', albumIds.rated5],
      ['playlist', playlistId],
    ];
    // Add filler albums to overflow past 8.
    const artistId = testDb.prepare('SELECT id FROM artists LIMIT 1').get().id;
    const insertAlbum = testDb.prepare('INSERT INTO albums (title, artist_id) VALUES (?, ?)');
    for (let i = 0; i < 3; i++) {
      entries.unshift(['album', insertAlbum.run(`Filler ${i}`, artistId).lastInsertRowid]);
    }
    for (let i = 0; i < entries.length; i++) {
      const [type, id] = entries[i];
      await postHistory(type, id);
      stamp.run(`2026-01-01 00:${String(i).padStart(2, '0')}:00`, type, id);
    }

    const body = (await getHome()).json();
    expect(body.recent).toHaveLength(8);
    // Newest first: the last stamped entry leads.
    expect(body.recent[0].item_type).toBe('playlist');
    expect(body.recent[0].playlist.id).toBe(playlistId);
    expect(body.recent[1].album.id).toBe(albumIds.rated5);
  });

  it('carries full album shape and derived playlist cover', async () => {
    await postHistory('album', albumIds.rated5);
    await postHistory('playlist', playlistId);
    await postHistory('playlist', emptyPlaylistId);

    const body = (await getHome()).json();
    const albumEntry = body.recent.find(e => e.item_type === 'album');
    expect(albumEntry.album).toMatchObject({
      id: albumIds.rated5,
      title: 'OK Computer',
      has_audio: true,
      artist: { name: 'Radiohead' },
    });

    const filled = body.recent.find(e => e.item_type === 'playlist' && e.playlist.id === playlistId);
    // First entry (Pablo Honey) has no cover: falls back to OK Computer's.
    expect(filled.playlist.cover_url).toBe('/covers/okc.jpg');
    expect(filled.playlist.track_count).toBe(2);
    expect(filled.playlist.total_duration_seconds).toBe(3 * 60 + 56 + 4 * 60 + 44);

    const empty = body.recent.find(e => e.item_type === 'playlist' && e.playlist.id === emptyPlaylistId);
    expect(empty.playlist.cover_url).toBeNull();
    expect(empty.playlist.track_count).toBe(0);
  });

  it('drops deleted albums and playlists from recent', async () => {
    await postHistory('album', albumIds.rated1);
    await postHistory('playlist', emptyPlaylistId);
    testDb.prepare('DELETE FROM albums WHERE id = ?').run(albumIds.rated1);
    testDb.prepare('DELETE FROM playlists WHERE id = ?').run(emptyPlaylistId);

    const body = (await getHome()).json();
    expect(body.recent).toEqual([]);
    const count = testDb.prepare('SELECT COUNT(*) AS n FROM play_history').get().n;
    expect(count).toBe(0);
  });

  it('suggestions exclude wanted, audio-less and recently shown albums', async () => {
    await postHistory('album', albumIds.rated5);

    for (let i = 0; i < 10; i++) {
      const ids = (await getHome()).json().suggestions.map(a => a.id);
      expect(ids.length).toBeLessThanOrEqual(12);
      expect(ids).not.toContain(albumIds.wanted);
      expect(ids).not.toContain(albumIds.noAudio);
      expect(ids).not.toContain(albumIds.rated5);
      // Only playable, owned candidates remain.
      for (const id of ids) {
        expect([albumIds.rated1, albumIds.unrated]).toContain(id);
      }
    }
  });
});
