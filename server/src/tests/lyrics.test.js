import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getMusicLibraryPath: vi.fn(),
}));

import Fastify from 'fastify';
import { getDb } from '../db/database.js';
import { getSetting, setSetting, getMusicLibraryPath } from '../db/settings.js';
import { playerRoutes } from '../routes/player.js';
import { parseLrc, lrcToPlain, lyricsPayload, readLocalLrc, fetchLrclib } from '../utils/lyrics.js';

const LRC = '[ar:Radiohead]\n[00:12.50]In the next world war\n[00:15.00][01:15.00]In a jackknifed juggernaut\n\n[00:20]I am born again';

describe('parseLrc', () => {
  it('reads timed lines, several tags per line, metadata skipped', () => {
    expect(parseLrc(LRC)).toEqual([
      { time: 12.5, text: 'In the next world war' },
      { time: 15, text: 'In a jackknifed juggernaut' },
      { time: 20, text: 'I am born again' },
      { time: 75, text: 'In a jackknifed juggernaut' },
    ]);
    expect(parseLrc('[00:01.123]x')[0].time).toBe(1.123);
    expect(parseLrc('no tags')).toEqual([]);
    expect(parseLrc(null)).toEqual([]);
  });

  it('gives plain text and the payload of the players', () => {
    expect(lrcToPlain('[00:01]a\n[00:02]b')).toBe('a\nb');
    expect(lyricsPayload()).toEqual({ source: null, instrumental: false, synced: false, lines: null, plain: null });
    expect(lyricsPayload({ plain: 'x', source: 'lrclib' })).toMatchObject({ synced: false, plain: 'x' });
    expect(lyricsPayload({ synced: '[00:01]a', source: 'file' }))
      .toMatchObject({ synced: true, lines: [{ time: 1, text: 'a' }], plain: 'a' });
  });
});

describe('fetchLrclib', () => {
  it('asks by artist, title, album and duration; 404 is "none"', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ syncedLyrics: '[00:01]a', plainLyrics: 'a', instrumental: false }) }));
    const found = await fetchLrclib({ artist: 'Radiohead', title: 'Airbag', album: 'OK Computer', duration: 284.4 }, { fetchImpl });
    expect(found).toEqual({ synced: '[00:01]a', plain: 'a', instrumental: false });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      artist_name: 'Radiohead', track_name: 'Airbag', album_name: 'OK Computer', duration: '284',
    });
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/^JewelBox-Music-Library\//);
    expect(await fetchLrclib({ artist: 'a', title: 'b' }, { fetchImpl: async () => ({ status: 404 }) })).toBeNull();
    await expect(fetchLrclib({ artist: 'a', title: 'b' }, { fetchImpl: async () => ({ ok: false, status: 503 }) }))
      .rejects.toThrow('503');
  });
});

describe('GET /player/tracks/:id/lyrics', () => {
  let app;
  let db;
  let lib;
  let trackId;
  let fetchSpy;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(SCHEMA);
    getDb.mockReturnValue(db);
    getSetting.mockReturnValue(null);
    lib = fs.mkdtempSync(path.join(os.tmpdir(), 'jewelbox-lyrics-'));
    getMusicLibraryPath.mockReturnValue(lib);
    const artist = db.prepare("INSERT INTO artists (name) VALUES ('Radiohead')").run().lastInsertRowid;
    const album = db.prepare("INSERT INTO albums (title, artist_id) VALUES ('OK Computer', ?)").run(artist).lastInsertRowid;
    trackId = db.prepare("INSERT INTO tracks (album_id, position, title, duration, file_path) VALUES (?, 1, 'Airbag', '4:44', 'R/OKC/01.flac')")
      .run(album).lastInsertRowid;
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    app = Fastify();
    app.register(playerRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fetchSpy.mockRestore();
    fs.rmSync(lib, { recursive: true, force: true });
  });

  const get = async (id = trackId) => app.inject({ method: 'GET', url: `/player/tracks/${id}/lyrics` });

  it('prefers a .lrc next to the file, without asking LRCLIB', async () => {
    fs.mkdirSync(path.join(lib, 'R/OKC'), { recursive: true });
    fs.writeFileSync(path.join(lib, 'R/OKC/01.lrc'), LRC);
    const body = (await get()).json();
    expect(body).toMatchObject({ source: 'file', synced: true });
    expect(body.lines).toHaveLength(4);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readLocalLrc(lib, '../outside.flac')).toBeNull();
  });

  it('asks LRCLIB once, then answers from the cache', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ syncedLyrics: '[00:01]In the next world war', plainLyrics: 'x' }) });
    expect((await get()).json()).toMatchObject({ source: 'lrclib', synced: true });
    expect((await get()).json()).toMatchObject({ source: 'lrclib', synced: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('remembers a miss for a month, and does not cache a network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    expect((await get()).json().source).toBeNull();
    fetchSpy.mockResolvedValue({ status: 404 });
    expect((await get()).json().source).toBeNull();
    expect((await get()).json().source).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // A month later, asked again.
    db.prepare("UPDATE track_lyrics SET fetched_at = datetime('now', '-31 days')").run();
    await get();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('stays offline when the setting says so; 404 for an unknown track', async () => {
    getSetting.mockImplementation((key) => (key === 'lyrics_online' ? '0' : null));
    expect((await get()).json()).toMatchObject({ source: null, lines: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await get(9999)).statusCode).toBe(404);
  });

  it('reads and saves the setting', async () => {
    expect((await app.inject({ method: 'GET', url: '/player/lyrics/settings' })).json()).toEqual({ online: true });
    const res = await app.inject({ method: 'PUT', url: '/player/lyrics/settings', payload: { online: false } });
    expect(res.json()).toEqual({ online: false });
    expect(setSetting).toHaveBeenCalledWith('lyrics_online', '0');
    expect((await app.inject({ method: 'PUT', url: '/player/lyrics/settings', payload: { online: 'no' } })).statusCode).toBe(400);
  });
});
