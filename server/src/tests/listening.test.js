import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import Fastify from 'fastify';
import { getDb } from '../db/database.js';
import { markTrackPlayed } from '../db/queries.js';
import { getListeningStats, periodStart, sqlUtc } from '../db/listening.js';
import { playerRoutes } from '../routes/player.js';

let db;
let ids;

// A fixed "now" in the server's time zone: Sunday 2026-10-25, 15:00.
const NOW = new Date(2026, 9, 25, 15, 0, 0);
const at = (...parts) => sqlUtc(new Date(...parts));

function play(trackId, playedAt) {
  db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id = ?').run(trackId);
  db.prepare('INSERT INTO track_plays (track_id, played_at) VALUES (?, ?)').run(trackId, playedAt);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  getDb.mockReturnValue(db);
  const artist = (name) => db.prepare('INSERT INTO artists (name) VALUES (?)').run(name).lastInsertRowid;
  const album = (title, artistId, wanted = 0) => db
    .prepare('INSERT INTO albums (title, artist_id, is_wanted, cover_url) VALUES (?, ?, ?, ?)')
    .run(title, artistId, wanted, `/covers/${title}.jpg`).lastInsertRowid;
  const track = (albumId, position, title, duration, file = true) => db
    .prepare('INSERT INTO tracks (album_id, position, title, duration, file_path) VALUES (?, ?, ?, ?, ?)')
    .run(albumId, position, title, duration, file ? `${title}.flac` : null).lastInsertRowid;

  const radiohead = artist('Radiohead');
  const portishead = artist('Portishead');
  const okc = album('OK Computer', radiohead);
  const dummy = album('Dummy', portishead);
  const kidA = album('Kid A', radiohead);
  album('Third', portishead, 1); // wish list: never "never played"
  const noAudio = album('Amnesiac', radiohead);
  ids = {
    airbag: track(okc, 1, 'Airbag', '4:44'),
    paranoid: track(okc, 2, 'Paranoid Android', '6:23'),
    sour: track(dummy, 1, 'Sour Times', '4:11'),
    everything: track(kidA, 1, 'Everything In Its Right Place', '4:11'),
    packt: track(noAudio, 1, 'Packt Like Sardines', '4:00', false),
  };

  // Before the log existed: counted in the all-time total only.
  db.prepare('UPDATE tracks SET play_count = 5 WHERE id = ?').run(ids.sour);
  play(ids.airbag, at(2026, 9, 25, 9, 0)); // today
  play(ids.airbag, at(2026, 9, 3, 21, 0)); // this month
  play(ids.paranoid, at(2026, 9, 12, 8, 0)); // this month
  play(ids.paranoid, at(2026, 2, 1, 12, 0)); // this year, March
  play(ids.sour, at(2025, 11, 31, 22, 0)); // last year, December
});

describe('periodStart', () => {
  it('gives the calendar month or year, nothing for all time', () => {
    expect(periodStart('month', NOW)).toEqual(new Date(2026, 9, 1));
    expect(periodStart('year', NOW)).toEqual(new Date(2026, 0, 1));
    expect(periodStart('all', NOW)).toBeNull();
  });
});

describe('getListeningStats', () => {
  it('counts the plays of today, the month, the year and all time', () => {
    const stats = getListeningStats({ now: NOW });
    expect(stats.counters).toEqual({ plays_today: 1, plays_month: 3, plays_year: 4, plays_all: 10 });
    expect(stats.tracking_since).toBe(new Date(2025, 11, 31, 22, 0).toISOString());
  });

  it('sums the period: plays, listening time, tracks and albums', () => {
    expect(getListeningStats({ now: NOW }).summary)
      .toEqual({ plays: 3, listening_minutes: 16, tracks: 2, albums: 1 });
    expect(getListeningStats({ period: 'all', now: NOW }).summary)
      .toEqual({ plays: 10, listening_minutes: 47, tracks: 3, albums: 2 });
  });

  it('ranks albums, artists and tracks of the period', () => {
    const month = getListeningStats({ now: NOW }).top;
    expect(month.albums.map(a => [a.title, a.plays])).toEqual([['OK Computer', 3]]);
    expect(month.albums[0]).toMatchObject({ artist_name: 'Radiohead', cover_url: '/covers/OK Computer.jpg' });
    expect(month.tracks.map(t => [t.title, t.plays])).toEqual([['Airbag', 2], ['Paranoid Android', 1]]);

    const all = getListeningStats({ period: 'all', now: NOW }).top;
    expect(all.albums.map(a => [a.title, a.plays])).toEqual([['Dummy', 6], ['OK Computer', 4]]);
    expect(all.artists.map(a => [a.name, a.plays])).toEqual([['Portishead', 6], ['Radiohead', 4]]);
  });

  it('gives the last twelve months, zeros included', () => {
    const months = getListeningStats({ now: NOW }).by_month;
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: '2025-11', plays: 0 });
    expect(months.find(m => m.month === '2025-12').plays).toBe(1);
    expect(months.find(m => m.month === '2026-03').plays).toBe(1);
    expect(months.at(-1)).toEqual({ month: '2026-10', plays: 3 });
  });

  it('lists the owned albums with audio never played', () => {
    const never = getListeningStats({ now: NOW }).never_played;
    expect(never.count).toBe(1);
    expect(never.albums.map(a => a.title)).toEqual(['Kid A']);
  });

  it('starts empty on a fresh collection', () => {
    db.exec('DELETE FROM track_plays; UPDATE tracks SET play_count = 0;');
    const stats = getListeningStats({ period: 'year', now: NOW });
    expect(stats.tracking_since).toBeNull();
    expect(stats.counters.plays_all).toBe(0);
    expect(stats.top.albums).toEqual([]);
    expect(stats.never_played.count).toBe(3);
  });
});

describe('markTrackPlayed', () => {
  it('logs the play along with the count', () => {
    expect(markTrackPlayed(ids.everything)).toBe(true);
    expect(db.prepare('SELECT play_count FROM tracks WHERE id = ?').get(ids.everything).play_count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM track_plays WHERE track_id = ?').get(ids.everything).c).toBe(1);
    expect(markTrackPlayed(99999)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS c FROM track_plays').get().c).toBe(6);
  });
});

describe('GET /player/stats', () => {
  it('answers the period asked, month by default, and refuses another', async () => {
    const app = Fastify();
    app.register(playerRoutes);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/player/stats' })).json().period).toBe('month');
    expect((await app.inject({ method: 'GET', url: '/player/stats?period=all' })).json().summary.plays).toBe(10);
    expect((await app.inject({ method: 'GET', url: '/player/stats?period=week' })).statusCode).toBe(400);
    await app.close();
  });
});
