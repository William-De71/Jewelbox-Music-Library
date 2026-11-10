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

// The app key/secret ship with the build; tests drive them through appCreds.
const appCreds = { apiKey: '', secret: '' };
vi.mock('../utils/lastfmCredentials.js', () => ({
  getAppCredentials: () => ({ apiKey: appCreds.apiKey, secret: appCreds.secret }),
  isLastfmAvailable: () => Boolean(appCreds.apiKey && appCreds.secret),
}));

import Fastify from 'fastify';
import { apiSignature, authUrl, getSession, scrobble, LastfmError } from '../utils/lastfm.js';
import { lastfmRoutes, flushPendingScrobbles, PENDING_SCROBBLES_KEY } from '../routes/lastfm.js';
import {
  PENDING_SCROBBLES_MAX, SCROBBLE_MAX_AGE_SEC,
  addPending, isTransientFailure, parsePending, prunePending, removePending,
} from '../utils/scrobbleQueue.js';
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
    appCreds.apiKey = '';
    appCreds.secret = '';
    vi.unstubAllGlobals();
  });

  it('connect returns 503 when the build ships no API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/lastfm/connect?origin=http://localhost:5173' });
    expect(res.statusCode).toBe(503);
  });

  it('connect returns the authorize URL with the origin callback', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    const res = await app.inject({ method: 'GET', url: '/lastfm/connect?origin=http://localhost:5173' });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain('api_key=KEY');
    expect(res.json().url).toContain(encodeURIComponent('http://localhost:5173/api/lastfm/callback'));
  });

  it('connect rejects an invalid origin', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    const res = await app.inject({ method: 'GET', url: '/lastfm/connect?origin=javascript:alert(1)' });
    expect(res.statusCode).toBe(400);
  });

  it('callback stores the session and redirects to /settings', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ session: { name: 'william', key: 'sess1' } }) })));
    const res = await app.inject({ method: 'GET', url: '/lastfm/callback?token=TOK' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings');
    expect(settingsStore.lastfm_session_key).toBe('sess1');
    expect(settingsStore.lastfm_username).toBe('william');
  });

  it('callback records the api key the session was authorised with', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ session: { name: 'william', key: 'sess1' } }) })));
    await app.inject({ method: 'GET', url: '/lastfm/callback?token=TOK' });
    expect(settingsStore.lastfm_session_api_key).toBe('KEY');
  });

  it('drops a session authorised with a different api key', async () => {
    appCreds.apiKey = 'NEWKEY';
    appCreds.secret = 'SECRET';
    settingsStore.lastfm_session_key = 'sess1';
    settingsStore.lastfm_username = 'william';
    settingsStore.lastfm_session_api_key = 'OLDKEY';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'POST', url: '/lastfm/nowplaying', payload: { track_id: trackId } });
    expect(res.statusCode).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(settingsStore.lastfm_session_key).toBeUndefined();
    expect(settingsStore.lastfm_username).toBeUndefined();
  });

  it('keeps a session authorised with the current api key', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    settingsStore.lastfm_session_key = 'sess1';
    settingsStore.lastfm_session_api_key = 'KEY';
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) })));
    await app.inject({ method: 'POST', url: '/lastfm/nowplaying', payload: { track_id: trackId } });
    expect(settingsStore.lastfm_session_key).toBe('sess1');
  });

  it('callback redirects with error flag when the session fails', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
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

  it('nowplaying is a silent 204 when the user has no session (no fetch)', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'POST', url: '/lastfm/nowplaying', payload: { track_id: trackId } });
    expect(res.statusCode).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nowplaying calls Last.fm with enriched metadata when connected', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    settingsStore.lastfm_session_api_key = 'KEY';
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
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    settingsStore.lastfm_session_api_key = 'KEY';
    const res = await app.inject({ method: 'POST', url: '/lastfm/nowplaying', payload: { track_id: 9999 } });
    expect(res.statusCode).toBe(404);
  });

  it('scrobble validates started_at and passes it as timestamp', async () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    settingsStore.lastfm_session_api_key = 'KEY';
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
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    settingsStore.lastfm_session_api_key = 'KEY';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await app.inject({ method: 'POST', url: '/lastfm/scrobble', payload: { track_id: trackId, started_at: 1700000000 } });
    expect(res.statusCode).toBe(204);
  });

  // ── Scrobbles kept while Last.fm is away ────────────────────────────────────

  const connect = () => {
    appCreds.apiKey = 'KEY';
    appCreds.secret = 'SECRET';
    settingsStore.lastfm_session_key = 'SK';
    settingsStore.lastfm_session_api_key = 'KEY';
  };
  const recent = () => Math.floor(Date.now() / 1000) - 600;
  const pending = () => JSON.parse(settingsStore[PENDING_SCROBBLES_KEY] ?? '[]');
  const post = (startedAt) =>
    app.inject({ method: 'POST', url: '/lastfm/scrobble', payload: { track_id: trackId, started_at: startedAt } });
  const sentTimestamps = (fetchMock) =>
    fetchMock.mock.calls.map(([, init]) => new URLSearchParams(init.body).get('timestamp'));

  it('keeps a scrobble when the network is down', async () => {
    connect();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const at = recent();
    expect((await post(at)).statusCode).toBe(204);
    expect(pending()).toEqual([{ artist: 'Radiohead', track: 'Airbag', album: 'OK Computer', duration: 284, timestamp: at }]);
  });

  it('keeps a scrobble when Last.fm asks to come back later, not when it refuses it', async () => {
    connect();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ error: 16, message: 'Try again' }) })));
    await post(recent());
    expect(pending()).toHaveLength(1);

    delete settingsStore[PENDING_SCROBBLES_KEY];
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ error: 6, message: 'Invalid parameters' }) })));
    await post(recent());
    expect(pending()).toHaveLength(0);
  });

  it('does not keep a scrobble too old for Last.fm', async () => {
    connect();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await post(1700000000);
    expect(pending()).toHaveLength(0);
  });

  it('sends the waiting scrobbles first, oldest first, once Last.fm answers', async () => {
    connect();
    const first = recent();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await post(first);
    await post(first + 300);
    expect(pending().map(e => e.timestamp)).toEqual([first, first + 300]);

    const fetchMock = vi.fn(async () => ({ json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    await post(first + 600);
    await flushPendingScrobbles();
    await vi.waitFor(() => expect(pending()).toHaveLength(0));
    expect(sentTimestamps(fetchMock)).toEqual([first, first + 300, first + 600].map(String));
    expect(settingsStore).not.toHaveProperty(PENDING_SCROBBLES_KEY);
  });

  it('stops at the first scrobble Last.fm cannot take yet and drops a refused one', async () => {
    connect();
    const first = recent();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await post(first);
    await post(first + 300);
    await post(first + 600);

    // The first is refused for good, the second must wait: the third is not tried.
    const answers = [{ error: 6, message: 'Invalid parameters' }, { error: 29, message: 'Rate limit' }];
    const fetchMock = vi.fn(async () => ({ json: async () => answers.shift() ?? {} }));
    vi.stubGlobal('fetch', fetchMock);
    await flushPendingScrobbles();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pending().map(e => e.timestamp)).toEqual([first + 300, first + 600]);
  });

  it('flushes nothing without a session, and disconnecting forgets the waiting scrobbles', async () => {
    connect();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await post(recent());
    expect(pending()).toHaveLength(1);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    delete settingsStore.lastfm_session_key;
    await flushPendingScrobbles();
    expect(fetchMock).not.toHaveBeenCalled();

    await app.inject({ method: 'DELETE', url: '/lastfm/session' });
    expect(settingsStore).not.toHaveProperty(PENDING_SCROBBLES_KEY);
  });
});

// ── scrobbleQueue ─────────────────────────────────────────────────────────────

describe('scrobbleQueue', () => {
  const entry = (timestamp, track = 'Airbag') => ({ artist: 'Radiohead', track, timestamp });

  it('tells a transient failure from a final refusal', () => {
    expect(isTransientFailure(new Error('network down'))).toBe(true);
    expect(isTransientFailure(new LastfmError(11, 'offline'))).toBe(true);
    expect(isTransientFailure(new LastfmError(16, 'later'))).toBe(true);
    expect(isTransientFailure(new LastfmError(29, 'rate limit'))).toBe(true);
    expect(isTransientFailure(new LastfmError(9, 'invalid session'))).toBe(false);
  });

  it('reads the stored list and leaves out what it cannot read', () => {
    expect(parsePending(null)).toEqual([]);
    expect(parsePending('not json')).toEqual([]);
    expect(parsePending('{"a":1}')).toEqual([]);
    expect(parsePending(JSON.stringify([entry(10), null, { artist: 'x' }, 'y']))).toEqual([entry(10)]);
  });

  it('drops the scrobbles too old and the oldest beyond the limit', () => {
    const now = 2_000_000;
    expect(prunePending([entry(now - SCROBBLE_MAX_AGE_SEC - 1), entry(now - 10)], now)).toEqual([entry(now - 10)]);
    const many = Array.from({ length: PENDING_SCROBBLES_MAX + 5 }, (_, i) => entry(now - 1000 + i));
    const kept = prunePending(many, now);
    expect(kept).toHaveLength(PENDING_SCROBBLES_MAX);
    expect(kept[0]).toEqual(many[5]);
  });

  it('keeps the same play once and removes one entry', () => {
    const now = 2_000_000;
    const list = addPending([entry(now - 20)], entry(now - 20), now);
    expect(list).toEqual([entry(now - 20)]);
    const two = addPending(list, entry(now - 10, 'Paranoid Android'), now);
    expect(two).toHaveLength(2);
    expect(removePending(two, entry(now - 20))).toEqual([entry(now - 10, 'Paranoid Android')]);
  });
});
