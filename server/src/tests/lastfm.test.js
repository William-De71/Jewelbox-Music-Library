import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  deleteSetting: vi.fn(),
  getMusicLibraryPath: vi.fn(),
}));

import Fastify from 'fastify';
import { apiSignature, authUrl, getSession, scrobble } from '../utils/lastfm.js';
import { lastfmRoutes } from '../routes/lastfm.js';
import { getDb } from '../db/database.js';
import { getSetting, setSetting, deleteSetting } from '../db/settings.js';

// ── apiSignature ──────────────────────────────────────────────────────────────

describe('apiSignature', () => {
  it('matches the known md5 vector', () => {
    const sig = apiSignature({ api_key: 'abc123', method: 'auth.getSession', token: 'tok42' }, 'mysecret');
    expect(sig).toBe('6c598277f811213f3d57cef43c52255d');
  });

  it('sorts parameters alphabetically and excludes format/callback', () => {
    const base = apiSignature({ b: '2', a: '1' }, 's');
    const withExcluded = apiSignature({ b: '2', format: 'json', a: '1', callback: 'x' }, 's');
    expect(withExcluded).toBe(base);
  });

  it('ignores null/undefined values', () => {
    expect(apiSignature({ a: '1', b: null }, 's')).toBe(apiSignature({ a: '1' }, 's'));
  });
});

describe('authUrl', () => {
  it('builds the authorize URL with encoded callback', () => {
    const url = authUrl('KEY', 'http://localhost:3001/api/lastfm/callback');
    expect(url).toBe('https://www.last.fm/api/auth/?api_key=KEY&cb=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Flastfm%2Fcallback');
  });
});

// ── API calls with mocked fetch ───────────────────────────────────────────────

describe('lastfm API calls', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('getSession sends a signed GET and returns the session', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ session: { name: 'william', key: 'sess1' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const session = await getSession('KEY', 'SECRET', 'TOKEN');
    expect(session).toEqual({ name: 'william', key: 'sess1' });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('method=auth.getSession');
    expect(url).toContain('api_sig=');
    expect(url).toContain('format=json');
  });

  it('scrobble sends a signed urlencoded POST with sk and timestamp', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ scrobbles: {} }) }));
    vi.stubGlobal('fetch', fetchMock);
    await scrobble(
      { apiKey: 'KEY', secret: 'SECRET', sessionKey: 'SK' },
      { artist: 'Radiohead', track: 'Airbag', album: 'OK Computer', duration: 284, timestamp: 1700000000 }
    );
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(opts.method).toBe('POST');
    const body = new URLSearchParams(opts.body);
    expect(body.get('method')).toBe('track.scrobble');
    expect(body.get('sk')).toBe('SK');
    expect(body.get('timestamp')).toBe('1700000000');
    expect(body.get('artist')).toBe('Radiohead');
    expect(body.get('api_sig')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('throws LastfmError on API error payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ error: 9, message: 'Invalid session key' }) })));
    await expect(getSession('K', 'S', 'T')).rejects.toThrow('Invalid session key');
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

describe('lastfm routes', () => {
  let app;
  let testDb;
  let trackId;
  const settingsStore = {};

  beforeAll(async () => {
    testDb = new Database(':memory:');
    testDb.exec(SCHEMA);
    getDb.mockReturnValue(testDb);

    const artistId = testDb.prepare('INSERT INTO artists (name) VALUES (?)').run('Radiohead').lastInsertRowid;
    const albumId = testDb.prepare('INSERT INTO albums (title, artist_id) VALUES (?, ?)').run('OK Computer', artistId).lastInsertRowid;
    trackId = testDb.prepare('INSERT INTO tracks (album_id, position, title, duration) VALUES (?, ?, ?, ?)')
      .run(albumId, 1, 'Airbag', '4:44').lastInsertRowid;

    getSetting.mockImplementation((key) => settingsStore[key] ?? null);
    setSetting.mockImplementation((key, value) => { settingsStore[key] = value; });
    deleteSetting.mockImplementation((key) => { delete settingsStore[key]; });

    app = Fastify({ logger: false });
    await app.register(lastfmRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    testDb.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    for (const key of Object.keys(settingsStore)) delete settingsStore[key];
    vi.unstubAllGlobals();
  });

  it('connect returns 400 without API keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/lastfm/connect?origin=http://localhost:5173' });
    expect(res.statusCode).toBe(400);
  });

  it('connect returns the authorize URL with the origin callback', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    const res = await app.inject({ method: 'GET', url: '/lastfm/connect?origin=http://localhost:5173' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain('api_key=KEY');
    expect(res.json().url).toContain(encodeURIComponent('http://localhost:5173/api/lastfm/callback'));
  });

  it('connect rejects an invalid origin', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    const res = await app.inject({ method: 'GET', url: '/lastfm/connect?origin=javascript:alert(1)' });
    expect(res.statusCode).toBe(400);
  });

  it('callback stores the session and redirects to /settings', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ session: { name: 'william', key: 'sess1' } }) })));
    const res = await app.inject({ method: 'GET', url: '/lastfm/callback?token=TOK' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings');
    expect(settingsStore.lastfm_session_key).toBe('sess1');
    expect(settingsStore.lastfm_username).toBe('william');
  });

  it('callback redirects with error flag when the session fails', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ error: 4, message: 'Invalid token' }) })));
    const res = await app.inject({ method: 'GET', url: '/lastfm/callback?token=BAD' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings?lastfm=error');
  });

  it('disconnect deletes the session settings', async () => {
    settingsStore.lastfm_session_key = 'sess1';
    settingsStore.lastfm_username = 'william';
    const res = await app.inject({ method: 'DELETE', url: '/lastfm/session' });
    expect(res.statusCode).toBe(204);
    expect(settingsStore.lastfm_session_key).toBeUndefined();
    expect(settingsStore.lastfm_username).toBeUndefined();
  });

  it('nowplaying is a silent 204 when not connected (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'POST', url: '/lastfm/nowplaying', payload: { track_id: trackId } });
    expect(res.statusCode).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nowplaying calls Last.fm with enriched metadata when connected', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    const fetchMock = vi.fn(async () => ({ json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'POST', url: '/lastfm/nowplaying', payload: { track_id: trackId } });
    expect(res.statusCode).toBe(204);
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get('artist')).toBe('Radiohead');
    expect(body.get('track')).toBe('Airbag');
    expect(body.get('album')).toBe('OK Computer');
    expect(body.get('duration')).toBe('284');
  });

  it('nowplaying returns 404 for an unknown track when connected', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    const res = await app.inject({ method: 'POST', url: '/lastfm/nowplaying', payload: { track_id: 9999 } });
    expect(res.statusCode).toBe(404);
  });

  it('scrobble validates started_at and passes it as timestamp', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    const fetchMock = vi.fn(async () => ({ json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    let res = await app.inject({ method: 'POST', url: '/lastfm/scrobble', payload: { track_id: trackId } });
    expect(res.statusCode).toBe(400);

    res = await app.inject({ method: 'POST', url: '/lastfm/scrobble', payload: { track_id: trackId, started_at: 1700000000 } });
    expect(res.statusCode).toBe(204);
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get('method')).toBe('track.scrobble');
    expect(body.get('timestamp')).toBe('1700000000');
  });

  it('scrobble stays 204 when the Last.fm call fails', async () => {
    settingsStore.lastfm_api_key = 'KEY';
    settingsStore.lastfm_api_secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await app.inject({ method: 'POST', url: '/lastfm/scrobble', payload: { track_id: trackId, started_at: 1700000000 } });
    expect(res.statusCode).toBe(204);
  });
});
