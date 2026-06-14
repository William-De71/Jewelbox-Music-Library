import {
  getAlbums, getAlbumById, createAlbum, updateAlbum, deleteAlbum, getGenres, getAllArtists, getAllLabels, getStats, getBorrowers,
  getLoanHistory, addLoanHistory, closeLoan, getArtistLetters,
} from '../db/queries.js';
import { downloadCover } from '../utils/downloadCover.js';
import { getDb } from '../db/database.js';

export async function albumRoutes(fastify) {
  // GET /api/albums?page=1&limit=24&genre=Rock&rating=5&sort=title&order=asc&search=&letter=A
  fastify.get('/albums', async (req, reply) => {
    try {
      const { page, limit, genre, rating, sort, order, search, lent, wanted, letter } = req.query;
      const result = getAlbums({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 24,
        genre, rating, sort, order, search, lent, wanted, letter,
      });
      return result;
    } catch (err) {
      console.error('[GetAlbums] Error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/albums/artist-letters?wanted=false
  fastify.get('/albums/artist-letters', async (req, reply) => {
    try {
      return getArtistLetters({ wanted: req.query.wanted });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/albums/genres
  fastify.get('/albums/genres', async (req, reply) => {
    return getGenres();
  });

  // GET /api/albums/borrowers
  fastify.get('/albums/borrowers', async (req, reply) => {
    try {
      return getBorrowers();
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/stats
  fastify.get('/stats', async (req, reply) => {
    try {
      return getStats();
    } catch (err) {
      console.error('[Stats] Error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/albums/artists
  fastify.get('/albums/artists', async (req, reply) => {
    return getAllArtists();
  });

  // GET /api/albums/labels
  fastify.get('/albums/labels', async (req, reply) => {
    return getAllLabels();
  });

  // GET /api/albums/:id
  fastify.get('/albums/:id', async (req, reply) => {
    const album = getAlbumById(Number(req.params.id));
    if (!album) return reply.code(404).send({ error: 'Album not found' });
    return album;
  });

  // POST /api/albums
  fastify.post('/albums', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'artist_name'],
        properties: {
          title:          { type: 'string', minLength: 1 },
          artist_name:    { type: 'string', minLength: 1 },
          label_name:     { type: 'string' },
          year:           { type: 'integer' },
          genre:          { type: 'string' },
          total_duration: { type: 'string' },
          ean:            { type: 'string' },
          rating:         { type: 'integer', minimum: 1, maximum: 5 },
          cover_url:      { type: 'string' },
          notes:          { type: 'string' },
          is_wanted:      { type: 'boolean' },
          tracks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title'],
              properties: {
                position: { type: 'integer' },
                title:    { type: 'string' },
                duration: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const albumData = { ...req.body };
    
    // If cover_url is from external sources, download it locally
    if (albumData.cover_url && (
      albumData.cover_url.includes('coverartarchive.org') || 
      albumData.cover_url.includes('discogs.com') ||
      albumData.cover_url.includes('i.discogs.com')
    )) {
      const source = albumData.cover_url.includes('discogs.com') ? 'Discogs' : 'MusicBrainz';
      console.log(`[CreateAlbum] Downloading cover from ${source}: ${albumData.cover_url}`);
      const localCoverUrl = await downloadCover(albumData.cover_url);
      if (localCoverUrl) {
        albumData.cover_url = localCoverUrl;
        console.log(`[CreateAlbum] Cover downloaded successfully: ${localCoverUrl}`);
      } else {
        console.log(`[CreateAlbum] Cover download failed, keeping original URL: ${albumData.cover_url}`);
      }
    } else {
      console.log(`[CreateAlbum] No external cover URL detected: ${albumData.cover_url}`);
    }
    
    // Strip empty EAN to avoid UNIQUE constraint conflicts
    if (!albumData.ean || albumData.ean.trim() === '') {
      delete albumData.ean;
    }
    
    try {
      const album = createAlbum(albumData);
      return reply.code(201).send(album);
    } catch (err) {
      console.error('[CreateAlbum] Error creating album:', err);
      
      // Handle UNIQUE constraint violations
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (err.message.includes('albums.ean')) {
          return reply.code(409).send({ 
            error: 'Un album avec ce code EAN existe déjà dans votre collection.' 
          });
        }
        return reply.code(409).send({ 
          error: 'Cet album existe déjà dans votre collection.' 
        });
      }
      
      return reply.code(500).send({ error: err.message });
    }
  });

  // PATCH /api/albums/:id
  fastify.patch('/albums/:id', async (req, reply) => {
    try {
      const data = { ...req.body };
      // Strip empty EAN to avoid UNIQUE constraint conflicts
      if ('ean' in data && (!data.ean || String(data.ean).trim() === '')) {
        delete data.ean;
      }

      // If cover_url is from external sources, download it locally
      if (data.cover_url && (
        data.cover_url.includes('coverartarchive.org') ||
        data.cover_url.includes('discogs.com') ||
        data.cover_url.includes('i.discogs.com')
      )) {
        const source = data.cover_url.includes('discogs.com') ? 'Discogs' : 'MusicBrainz';
        console.log(`[UpdateAlbum] Downloading cover from ${source}: ${data.cover_url}`);
        const localCoverUrl = await downloadCover(data.cover_url);
        if (localCoverUrl) {
          data.cover_url = localCoverUrl;
          console.log(`[UpdateAlbum] Cover downloaded successfully: ${localCoverUrl}`);
        } else {
          console.log(`[UpdateAlbum] Cover download failed, keeping original URL: ${data.cover_url}`);
        }
      } else if (data.cover_url) {
        console.log(`[UpdateAlbum] No external cover URL detected: ${data.cover_url}`);
      }

      const album = updateAlbum(Number(req.params.id), data);
      if (!album) return reply.code(404).send({ error: 'Album not found' });
      return album;
    } catch (err) {
      console.error('[UpdateAlbum] Error:', err);
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return reply.code(409).send({ error: 'An album with this EAN already exists in your collection.' });
      }
      return reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/albums/:id
  fastify.delete('/albums/:id', async (req, reply) => {
    const ok = deleteAlbum(Number(req.params.id));
    if (!ok) return reply.code(404).send({ error: 'Album not found' });
    return reply.code(204).send();
  });

  // PATCH /api/albums/:id/lend
  fastify.patch('/albums/:id/lend', {
    schema: {
      body: {
        type: 'object',
        required: ['is_lent'],
        properties: {
          is_lent: { type: 'boolean' },
          lent_to: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { is_lent, lent_to } = req.body;
    const now = new Date().toISOString();
    const album = updateAlbum(Number(req.params.id), {
      is_lent: is_lent ? 1 : 0,
      lent_to: is_lent ? (lent_to || null) : null,
      lent_at: is_lent ? now : null,
    });
    if (!album) return reply.code(404).send({ error: 'Album not found' });
    if (is_lent && lent_to) {
      addLoanHistory(Number(req.params.id), lent_to, now);
    } else if (!is_lent) {
      closeLoan(Number(req.params.id));
    }
    return album;
  });

  // GET /api/albums/:id/loans
  fastify.get('/albums/:id/loans', async (req, reply) => {
    const history = getLoanHistory(Number(req.params.id));
    return { data: history };
  });

  // GET /api/albums/export?format=csv|json
  fastify.get('/albums/export', async (req, reply) => {
    try {
      const format = req.query.format === 'json' ? 'json' : 'csv';
      const { data } = getAlbums({ limit: 10000, wanted: 'false' });
      if (format === 'json') {
        reply.header('Content-Disposition', 'attachment; filename="collection.json"');
        reply.header('Content-Type', 'application/json');
        return reply.send(JSON.stringify(data, null, 2));
      }
      const header = 'id,title,artist,label,year,genre,rating,ean,notes,is_lent,lent_to,lent_at,total_duration,created_at';
      const rows = data.map(a => [
        a.id, `"${(a.title||'').replace(/"/g,'""')}"`,
        `"${(a.artist?.name||'').replace(/"/g,'""')}"`,
        `"${(a.label?.name||'').replace(/"/g,'""')}"`,
        a.year||'', `"${(a.genre||'').replace(/"/g,'""')}"`,
        a.rating||'', `"${(a.ean||'').replace(/"/g,'""')}"`,
        `"${(a.notes||'').replace(/"/g,'""')}"`,
        a.is_lent ? 1 : 0,
        `"${(a.lent_to||'').replace(/"/g,'""')}"`,
        a.lent_at||'', a.total_duration||'', a.created_at||'',
      ].join(','));
      reply.header('Content-Disposition', 'attachment; filename="collection.csv"');
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      return reply.send([header, ...rows].join('\n'));
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/albums/import (multipart CSV)
  fastify.post('/albums/import', async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No file provided' });
      const buf = await data.toBuffer();
      const text = buf.toString('utf-8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return reply.code(400).send({ error: 'Empty CSV' });

      const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
      const idx = k => header.indexOf(k);
      let imported = 0, skipped = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
        const get = (k) => (cols[idx(k)]||'').replace(/^"|"$/g,'').trim();
        const title = get('title');
        const artist_name = get('artist');
        if (!title || !artist_name) { skipped++; continue; }
        try {
          createAlbum({
            title, artist_name,
            label_name: get('label') || null,
            year: get('year') ? Number(get('year')) : null,
            genre: get('genre') || null,
            rating: get('rating') ? Number(get('rating')) : null,
            ean: get('ean') || null,
            notes: get('notes') || null,
            total_duration: get('total_duration') || null,
            is_wanted: 0,
          });
          imported++;
        } catch { skipped++; }
      }
      return { imported, skipped };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/albums/duplicate?title=...&artist=...
  fastify.get('/albums/duplicate', async (req, reply) => {
    try {
      const { title, artist } = req.query;
      if (!title || !artist) return { duplicate: false };
      const db = getDb();
      const row = db.prepare(`
        SELECT a.id, a.title, a.is_wanted FROM albums a
        JOIN artists ar ON ar.id = a.artist_id
        WHERE a.title = ? COLLATE NOCASE AND ar.name = ? COLLATE NOCASE
        LIMIT 1
      `).get(title, artist);
      return { duplicate: !!row, album: row || null };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
