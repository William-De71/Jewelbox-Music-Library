import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
const ids = {};

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  const artist = testDb.prepare('INSERT INTO artists (name) VALUES (?)');
  const album = testDb.prepare('INSERT INTO albums (title, artist_id, genre) VALUES (?, ?, ?)');
  const track = testDb.prepare('INSERT INTO tracks (album_id, position, title, file_path) VALUES (?, ?, ?, ?)');
  const addTracks = (albumId, count, prefix, playable = true) => {
    for (let i = 1; i <= count; i += 1) {
      track.run(albumId, i, `${prefix} ${i}`, playable ? `${prefix}/${i}.flac` : null);
    }
  };

  ids.radiohead = artist.run('Radiohead').lastInsertRowid;
  ids.okComputer = album.run('OK Computer', ids.radiohead, 'Rock').lastInsertRowid;
  addTracks(ids.okComputer, 12, 'okc');
  ids.kidA = album.run('Kid A', ids.radiohead, 'Electronic').lastInsertRowid;
  addTracks(ids.kidA, 10, 'kida');

  ids.muse = artist.run('Muse').lastInsertRowid;
  addTracks(album.run('Origin of Symmetry', ids.muse, 'rock').lastInsertRowid, 11, 'muse');
  ids.blur = artist.run('Blur').lastInsertRowid;
  addTracks(album.run('Parklife', ids.blur, 'Rock').lastInsertRowid, 16, 'blur');
  // Unplayable rock album: never part of a radio.
  addTracks(album.run('Ghost', ids.blur, 'Rock').lastInsertRowid, 5, 'ghost', false);

  ids.bach = artist.run('Bach').lastInsertRowid;
  addTracks(album.run('Goldberg', ids.bach, 'Classical').lastInsertRowid, 30, 'bach');
  ids.nogenre = artist.run('Untagged').lastInsertRowid;
  ids.nogenreAlbum = album.run('Demos', ids.nogenre, null).lastInsertRowid;
  addTracks(ids.nogenreAlbum, 3, 'demo');

  app = Fastify({ logger: false });
  await app.register(playerRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

const radio = (query) => app.inject({ method: 'GET', url: `/player/radio?${query}` });
const albumOf = (track) => track.album_title;

describe('GET /player/radio', () => {
  it('builds an album radio: seed track first, seed artist, then same-genre artists', async () => {
    const res = await radio(`album_id=${ids.okComputer}&size=30`);
    expect(res.statusCode).toBe(200);
    const { seed, tracks } = res.json();
    expect(seed).toMatchObject({ type: 'album', name: 'OK Computer', artist_name: 'Radiohead', genre: 'Rock' });
    expect(tracks).toHaveLength(30);
    expect(albumOf(tracks[0])).toBe('OK Computer');
    expect(new Set(tracks.map(t => t.id)).size).toBe(30);
    expect(tracks.every(t => t.has_file)).toBe(true);

    const artists = tracks.map(t => t.artist_name);
    expect(artists.filter(a => a === 'Radiohead')).toHaveLength(9); // ceil(30 * 0.3)
    // The 21 others come from rock albums of other artists (case-insensitive genre).
    expect(tracks.filter(t => t.artist_name !== 'Radiohead').every(t => ['Muse', 'Blur'].includes(t.artist_name))).toBe(true);
    expect(tracks.some(t => albumOf(t) === 'Ghost')).toBe(false);
  });

  it('builds an artist radio from the artist and their main genre', async () => {
    const res = await radio(`artist_id=${ids.muse}&size=20`);
    const { seed, tracks } = res.json();
    expect(seed).toMatchObject({ type: 'artist', name: 'Muse', genre: 'rock' });
    expect(tracks).toHaveLength(20);
    expect(tracks.filter(t => t.artist_name === 'Muse')).toHaveLength(6);
    expect(tracks.some(t => t.artist_name === 'Bach')).toBe(false);
  });

  it('fills from the whole library when the genre runs short', async () => {
    const res = await radio(`album_id=${ids.nogenreAlbum}&size=10`);
    const { seed, tracks } = res.json();
    expect(seed.genre).toBeNull();
    expect(tracks).toHaveLength(10);
    expect(tracks.filter(t => t.artist_name === 'Untagged')).toHaveLength(3);
  });

  it('rarely repeats an artist back to back', async () => {
    const { tracks } = (await radio(`artist_id=${ids.blur}&size=30`)).json();
    const repeats = tracks.filter((t, i) => i > 0 && t.artist_name === tracks[i - 1].artist_name).length;
    expect(repeats).toBeLessThan(5);
  });

  it('defaults to 50 tracks', async () => {
    expect((await radio(`artist_id=${ids.bach}`)).json().tracks).toHaveLength(50);
  });

  it('404s on an unknown seed', async () => {
    expect((await radio('album_id=9999')).statusCode).toBe(404);
    expect((await radio('artist_id=9999')).statusCode).toBe(404);
  });

  it.each([
    '', `album_id=${1}&artist_id=1`, 'album_id=abc', 'album_id=0', 'artist_id=1&size=0', 'artist_id=1&size=201',
  ])('rejects %s', async (query) => {
    expect((await radio(query)).statusCode).toBe(400);
  });
});
