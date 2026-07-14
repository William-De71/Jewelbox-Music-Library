import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

vi.mock('../utils/downloadCover.js', () => ({
  downloadCover: vi.fn(async (url) => url),
}));

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { albumRoutes } from '../routes/albums.js';
import { getDb } from '../db/database.js';
import { downloadCover } from '../utils/downloadCover.js';

let app;
let testDb;
let albumId;

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.exec(SCHEMA);
  getDb.mockReturnValue(testDb);

  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(albumRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

// ── POST /albums ──────────────────────────────────────────────────────────────

describe('POST /albums', () => {
  it('creates an album and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'OK Computer', artist_name: 'Radiohead', year: 1997, rating: 5, genre: 'Alternative Rock' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('OK Computer');
    expect(body.id).toBeDefined();
    albumId = body.id;
  });

  it('returns 400 for missing artist_name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'No Artist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 on duplicate EAN', async () => {
    await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Album A', artist_name: 'Artist X', ean: '1234567890123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Album B', artist_name: 'Artist Y', ean: '1234567890123' },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── GET /albums ───────────────────────────────────────────────────────────────

describe('GET /albums', () => {
  it('returns a paginated list with total', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.pagination.total).toBe('number');
    expect(body.pagination.total).toBeGreaterThan(0);
  });

  it('filters by search query', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums?search=OK+Computer' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.some(a => a.title === 'OK Computer')).toBe(true);
  });

  it('filters by genre', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums?genre=Alternative+Rock' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.every(a => a.genre === 'Alternative Rock')).toBe(true);
  });

  it('filters by rating', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums?rating=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.every(a => a.rating === 5)).toBe(true);
  });

  it('filters lent albums', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums?lent=true' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.every(a => a.is_lent === true)).toBe(true);
  });

  it('filters wanted=false albums', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums?wanted=false' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('sorts by artist descending', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums?sort=artist&order=desc' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('respects limit param', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums?limit=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });
});

// ── GET /albums/genres ────────────────────────────────────────────────────────

describe('GET /albums/genres', () => {
  it('returns an array of genres', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/genres' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.includes('Alternative Rock')).toBe(true);
  });
});

// ── GET /albums/:id ───────────────────────────────────────────────────────────

describe('GET /albums/:id', () => {
  it('returns the album with tracks array', async () => {
    const res = await app.inject({ method: 'GET', url: `/albums/${albumId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('OK Computer');
    expect(Array.isArray(body.tracks)).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/99999' });
    expect(res.statusCode).toBe(404);
  });
});

// ── PATCH /albums/:id ─────────────────────────────────────────────────────────

describe('PATCH /albums/:id', () => {
  it('updates the album rating', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { rating: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rating).toBe(4);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/albums/99999',
      payload: { rating: 3 },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── PATCH /albums/:id/lend ────────────────────────────────────────────────────

describe('PATCH /albums/:id/lend', () => {
  it('marks the album as lent and records lent_at', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}/lend`,
      payload: { is_lent: true, lent_to: 'Alice' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.is_lent).toBe(true);
    expect(body.lent_to).toBe('Alice');
    expect(body.lent_at).toBeTruthy();
  });

  it('marks the album as returned and clears lent fields', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}/lend`,
      payload: { is_lent: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.is_lent).toBe(false);
    expect(body.lent_to).toBeNull();
    expect(body.lent_at).toBeNull();
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/albums/99999/lend',
      payload: { is_lent: true, lent_to: 'Bob' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /albums/:id/loans ─────────────────────────────────────────────────────

describe('GET /albums/:id/loans', () => {
  it('returns the loan history', async () => {
    const res = await app.inject({ method: 'GET', url: `/albums/${albumId}/loans` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].lent_to).toBe('Alice');
    expect(body.data[0].returned_at).toBeTruthy();
  });

  it('returns empty array for album with no history', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Dummy Album', artist_name: 'Nobody' },
    });
    const newId = r.json().id;
    const res = await app.inject({ method: 'GET', url: `/albums/${newId}/loans` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });
});

// ── GET /albums/duplicate ─────────────────────────────────────────────────────

describe('GET /albums/duplicate', () => {
  it('detects a duplicate (case insensitive)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/albums/duplicate?title=ok+computer&artist=radiohead',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.duplicate).toBe(true);
    expect(body.album.id).toBe(albumId);
  });

  it('returns false for a non-existent album', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/albums/duplicate?title=Nonexistent+Album&artist=Nobody',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(false);
  });

  it('returns false when title or artist is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/duplicate?title=OK+Computer' });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(false);
  });
});

// ── GET /albums/export ────────────────────────────────────────────────────────

describe('GET /albums/export', () => {
  it('exports as CSV with correct headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/export?format=csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('collection.csv');
    expect(res.body).toContain('title');
    expect(res.body).toContain('OK Computer');
  });

  it('exports as JSON array', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/export?format=json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.some(a => a.title === 'OK Computer')).toBe(true);
  });
});

// ── GET /albums/artists ───────────────────────────────────────────────────────

describe('GET /albums/artists', () => {
  it('returns an array of artists', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/artists' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().some(a => a.name === 'Radiohead')).toBe(true);
  });
});

// ── GET /albums/labels ────────────────────────────────────────────────────────

describe('GET /albums/labels', () => {
  it('returns an array of labels', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/labels' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ── GET /albums/borrowers ─────────────────────────────────────────────────────

describe('GET /albums/borrowers', () => {
  it('returns an array of borrowers', async () => {
    const res = await app.inject({ method: 'GET', url: '/albums/borrowers' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ── GET /stats ────────────────────────────────────────────────────────────────

describe('GET /stats', () => {
  it('returns a statistics object including duration totals', async () => {
    await app.inject({ method: 'PATCH', url: `/albums/${albumId}`, payload: { total_duration: '45:30' } });
    await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Pablo Honey', artist_name: 'Radiohead', year: 1993, total_duration: '1:41:56' },
    });
    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total_owned).toBe('number');
    expect(typeof body.total_lent).toBe('number');
    expect(typeof body.total_duration_hours).toBe('number');
    expect(Array.isArray(body.by_genre)).toBe(true);
    expect(Array.isArray(body.by_decade)).toBe(true);
  });
});

// ── POST /albums — label + cover URL ─────────────────────────────────────────

describe('POST /albums with label and cover URL', () => {
  it('creates album with label_name (covers upsertLabel)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Kid A', artist_name: 'Radiohead', label_name: 'Parlophone', year: 2000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().label).not.toBeNull();
    expect(res.json().label.name).toBe('Parlophone');
  });

  it('creates album with coverartarchive URL (triggers download path)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Amnesiac', artist_name: 'Radiohead', cover_url: 'https://coverartarchive.org/release/123/front' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('creates album with discogs URL (triggers download path)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'In Rainbows', artist_name: 'Radiohead', cover_url: 'https://i.discogs.com/cover.jpg' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('falls back to original URL when download fails', async () => {
    downloadCover.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Moon Safari', artist_name: 'Air', cover_url: 'https://coverartarchive.org/release/456/front' },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ── PATCH /albums/:id with tracks ─────────────────────────────────────────────

describe('PATCH /albums/:id with tracks', () => {
  it('replaces track list on update', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: {
        tracks: [
          { position: 1, title: 'Everything in Its Right Place', duration: '4:11' },
          { title: 'Kid A', duration: '4:44' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toHaveLength(2);
  });

  it('preserves track ids, file paths and playlist entries on update', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: {
        title: 'Preserve Me',
        artist_name: 'Keeper',
        tracks: [
          { position: 1, title: 'One', duration: '1:00' },
          { position: 2, title: 'Two', duration: '2:00' },
          { position: 3, title: 'Three', duration: '3:00' },
        ],
      },
    });
    const id = created.json().id;
    const before = created.json().tracks;
    testDb.prepare('UPDATE tracks SET file_path = ? WHERE id = ?').run('Keeper/Preserve Me/01 - One.mp3', before[0].id);

    // Rename a track, change a duration, drop the third track
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${id}`,
      payload: {
        tracks: [
          { position: 1, title: 'One', duration: '1:11' },
          { position: 2, title: 'Two (Renamed)', duration: '2:00' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const after = res.json().tracks;
    expect(after.map(t => t.id)).toEqual([before[0].id, before[1].id]);
    expect(after[0].has_file).toBe(true);
    expect(after[0].duration).toBe('1:11');
    expect(after[1].title).toBe('Two (Renamed)');
  });

  it('updates artist_name (covers updateAlbum artist branch)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { artist_name: 'Radiohead' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().artist.name).toBe('Radiohead');
  });

  it('updates label_name (covers updateAlbum label branch)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { label_name: 'Parlophone' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label.name).toBe('Parlophone');
  });

  it('strips empty ean on update (covers EAN stripping branch)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { ean: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ean).toBeNull();
  });

  it('updates is_wanted as boolean true (covers boolean→1 conversion in updateAlbum)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { is_wanted: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('updates is_wanted as boolean false (covers boolean→0 conversion in updateAlbum)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { is_wanted: false },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 409 when updating EAN to an already existing one', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'EAN Conflict Album', artist_name: 'Test Artist', ean: 'EAN-CONFLICT-001' },
    });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { ean: 'EAN-CONFLICT-001' },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── POST /albums/import ───────────────────────────────────────────────────────

describe('POST /albums/import', () => {
  it('imports valid rows from CSV', async () => {
    const boundary = '----TestBoundary';
    const csv = 'title,artist,year,genre\n"The Bends","Radiohead","1995","Rock"\n"Dummy","Portishead","1994","Trip Hop"';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--`;
    const res = await app.inject({
      method: 'POST',
      url: '/albums/import',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBeGreaterThanOrEqual(2);
  });

  it('skips rows missing title or artist', async () => {
    const boundary = '----TestBoundary2';
    const csv = 'title,artist,year\n"","","1995"\n"Valid Title","Valid Artist","2000"';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--`;
    const res = await app.inject({
      method: 'POST',
      url: '/albums/import',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skipped).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 when no file is provided', async () => {
    const boundary = '----TestBoundary3';
    const body = `--${boundary}--`;
    const res = await app.inject({
      method: 'POST',
      url: '/albums/import',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Error handlers ───────────────────────────────────────────────────────────

describe('Error handlers (500 coverage)', () => {
  const brokenDb = { prepare: () => { throw new Error('DB error'); } };

  it('GET /albums returns 500 on DB error', async () => {
    getDb.mockReturnValueOnce(brokenDb);
    const res = await app.inject({ method: 'GET', url: '/albums' });
    expect(res.statusCode).toBe(500);
  });

  it('GET /albums/export returns 500 on DB error', async () => {
    getDb.mockReturnValueOnce(brokenDb);
    const res = await app.inject({ method: 'GET', url: '/albums/export?format=csv' });
    expect(res.statusCode).toBe(500);
  });

  it('POST /albums returns 500 on generic DB error', async () => {
    getDb.mockReturnValueOnce(brokenDb);
    const res = await app.inject({
      method: 'POST',
      url: '/albums',
      payload: { title: 'Error Album', artist_name: 'Error Artist' },
    });
    expect(res.statusCode).toBe(500);
  });

  it('GET /albums/duplicate returns 500 on DB error', async () => {
    getDb.mockReturnValueOnce(brokenDb);
    const res = await app.inject({ method: 'GET', url: '/albums/duplicate?title=Test&artist=Test' });
    expect(res.statusCode).toBe(500);
  });

  it('PATCH /albums/:id returns 500 on DB error', async () => {
    getDb.mockReturnValueOnce(brokenDb);
    const res = await app.inject({
      method: 'PATCH',
      url: `/albums/${albumId}`,
      payload: { genre: 'Rock' },
    });
    expect(res.statusCode).toBe(500);
  });
});

// ── DELETE /albums/:id ────────────────────────────────────────────────────────

describe('DELETE /albums/:id', () => {
  it('deletes the album and returns 204', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/albums/${albumId}` });
    expect(res.statusCode).toBe(204);
  });

  it('returns 404 for already deleted album', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/albums/${albumId}` });
    expect(res.statusCode).toBe(404);
  });

  it('cascades deletion to loan_history', () => {
    const remaining = testDb
      .prepare('SELECT * FROM loan_history WHERE album_id = ?')
      .all(albumId);
    expect(remaining).toHaveLength(0);
  });
});
