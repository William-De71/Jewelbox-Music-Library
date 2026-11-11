const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_HEADERS = {
  'User-Agent': 'JewelBox-Music-Library/1.0',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

import { getCacheKey, getFromCache, setCache } from '../utils/searchCache.js';
import { searchDiscogsByQuery, searchDiscogsByBarcode, getDiscogsRelease, isDiscogsConfigured } from '../utils/discogs.js';

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 10000; // 10 seconds between requests (MusicBrainz rate limit - extremely conservative)

async function fetchJson(url, retries = 3) {
  // Respect MusicBrainz rate limit
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`[MusicBrainz] Waiting ${waitTime}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`[MusicBrainz] Attempt ${attempt + 1}/${retries}: ${url}`);
      const res = await fetch(url, { 
        headers: MB_HEADERS,
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      if (!res.ok) {
        console.error(`[MusicBrainz] HTTP ${res.status} for ${url}`);
        throw new Error(`HTTP ${res.status}`);
      }
      
      // Check Content-Type to ensure we got JSON
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[MusicBrainz] Unexpected content-type: ${contentType}`);
        const text = await res.text();
        console.error(`[MusicBrainz] Response body: ${text.substring(0, 200)}...`);
        throw new Error(`Expected JSON but got ${contentType}`);
      }
      
      console.log(`[MusicBrainz] Success on attempt ${attempt + 1}`);
      return res.json();
    } catch (err) {
      console.error(`[MusicBrainz] Attempt ${attempt + 1} failed:`, err.message);
      
      // If this is the last attempt, throw the error
      if (attempt === retries - 1) {
        console.error(`[MusicBrainz] All ${retries} attempts failed for ${url}`);
        throw err;
      }
      
      // Wait with exponential backoff before retrying
      const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 5000);
      console.log(`[MusicBrainz] Retrying in ${backoffDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
}

async function searchByEAN(ean) {
  const cacheKey = getCacheKey(ean, 'ean');
  console.log(`[Search] EAN Query: "${ean}" -> Cache key: "${cacheKey}"`);
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[Search] Cache HIT for EAN "${ean}"`);
    return cached;
  }
  
  console.log(`[Search] Cache MISS for EAN "${ean}", fetching from MusicBrainz...`);
  
  const data = await fetchJson(
    `${MB_BASE}/release?query=barcode:${encodeURIComponent(ean)}&fmt=json&limit=1`
  );
  if (!data.releases?.length) {
    setCache(cacheKey, null);
    return null;
  }
  
  const result = normalizeMBRelease(data.releases[0]);
  console.log(`[Search] Caching EAN result for "${ean}"`);
  setCache(cacheKey, result);
  return result;
}

// Escapes special Lucene characters for MusicBrainz queries
function escapeLucene(value) {
  return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

// Builds a MusicBrainz query string. When artist and/or title are provided,
// builds a structured Lucene query (artist:"X" AND release:"Y" AND date:Z) for precise matching.
// Otherwise falls back to a plain free-text query.
function buildMBQuery({ q, artist, title, year }) {
  const clauses = [];
  if (artist) clauses.push(`artist:"${escapeLucene(artist)}"`);
  if (title) clauses.push(`release:"${escapeLucene(title)}"`);
  if (year) clauses.push(`date:${escapeLucene(String(year))}*`);

  if (clauses.length) return clauses.join(' AND ');
  return q;
}

async function searchByQuery(params) {
  const query = buildMBQuery(params);
  const cacheKey = getCacheKey(query, 'search');
  console.log(`[Search] Query: "${query}" -> Cache key: "${cacheKey}"`);

  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[Search] Cache HIT for "${query}"`);
    return cached;
  }

  console.log(`[Search] Cache MISS for "${query}", fetching from MusicBrainz...`);

  const data = await fetchJson(
    `${MB_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=50&inc=artist-credits+labels+recordings`
  );
  if (!data.releases?.length) {
    // Cache empty results too
    setCache(cacheKey, []);
    return [];
  }

  const results = data.releases.map(normalizeMBRelease);
  console.log(`[Search] Caching ${results.length} results for "${query}"`);
  setCache(cacheKey, results);
  return results;
}

async function getFullRelease(mbid) {
  const cacheKey = getCacheKey(mbid, 'release');
  console.log(`[Search] Release Query: "${mbid}" -> Cache key: "${cacheKey}"`);
  
  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[Search] Cache HIT for release "${mbid}"`);
    return cached;
  }
  
  console.log(`[Search] Cache MISS for release "${mbid}", fetching from MusicBrainz...`);
  
  const data = await fetchJson(
    `${MB_BASE}/release/${mbid}?inc=artist-credits+labels+recordings+genres&fmt=json`
  );
  
  const result = normalizeMBRelease(data);
  console.log(`[Search] Caching release result for "${mbid}"`);
  setCache(cacheKey, result);
  return result;
}

function normalizeMBRelease(r) {
  const artist = r['artist-credit']?.[0]?.artist?.name || '';
  const label = r['label-info']?.[0]?.label?.name || '';
  const year = r.date ? Number(r.date.split('-')[0]) : null;
  const genre = r.genres?.[0]?.name || '';

  const tracks = [];
  (r.media || []).forEach((medium) => {
    (medium.tracks || []).forEach((t) => {
      tracks.push({
        disc: medium.position || 1,
        position: t.position,
        title: t.title,
        duration: t.length ? msToMMSS(t.length) : null,
      });
    });
  });

  const total_duration = tracks.length
    ? null
    : r['track-count']
    ? null
    : null;

  const totalMs = (r.media || []).reduce((acc, m) => {
    return acc + (m.tracks || []).reduce((a, t) => a + (t.length || 0), 0);
  }, 0);

  return {
    mbid: r.id,
    title: r.title || '',
    artist_name: artist,
    label_name: label,
    year,
    genre,
    ean: r.barcode || '',
    cover_url: r.id ? `https://coverartarchive.org/release/${r.id}/front-250` : '', // Keep original URL
    total_duration: totalMs ? msToMMSS(totalMs) : '',
    tracks,
  };
}

function msToMMSS(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function searchRoutes(fastify) {
  // GET /api/search?q=<query>   →  search by title/artist
  // GET /api/search?ean=<ean>   →  lookup by barcode
  fastify.get('/search', async (req, reply) => {
    const { q, ean, artist, title, year, source = 'musicbrainz' } = req.query;

    if (!q && !ean && !artist && !title && !year) {
      return reply.code(400).send({ error: 'Provide q, ean, artist, title or year parameter' });
    }

    if (!['musicbrainz', 'discogs'].includes(source)) {
      return reply.code(400).send({ error: 'Source must be musicbrainz or discogs' });
    }

    try {
      if (ean) {
        if (source === 'discogs') {
          const result = await searchDiscogsByBarcode(ean);
          if (!result) return reply.code(404).send({ error: 'No release found for this barcode' });
          return result;
        } else {
          const result = await searchByEAN(ean);
          if (!result) return reply.code(404).send({ error: 'No release found for this barcode' });
          const full = await getFullRelease(result.mbid);
          return full;
        }
      }

      if (source === 'discogs') {
        const results = await searchDiscogsByQuery({ q, artist, title, year });
        return results;
      } else {
        const results = await searchByQuery({ q, artist, title, year });
        return results;
      }
    } catch (err) {
      fastify.log.error(err);
      return reply.code(200).send([]);
    }
  });

  // GET /api/search/:mbid  →  get full release details (MusicBrainz)
  fastify.get('/search/:mbid', async (req, reply) => {
    try {
      const full = await getFullRelease(req.params.mbid);
      return full;
    } catch (err) {
      fastify.log.error(err);
      // Return error message instead of 502 when MusicBrainz is unavailable
      return reply.code(404).send({ 
        error: 'MusicBrainz service temporarily unavailable. Please try again later.',
        fallback: true
      });
    }
  });

  // GET /api/search/discogs/:id  →  get full Discogs release details
  fastify.get('/search/discogs/:id', async (req, reply) => {
    try {
      const full = await getDiscogsRelease(req.params.id);
      return full;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(404).send({ 
        error: 'Discogs service temporarily unavailable. Please try again later.',
        fallback: true
      });
    }
  });
}
