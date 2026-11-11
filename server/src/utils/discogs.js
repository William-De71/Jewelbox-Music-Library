// Discogs API service for JewelBox Music Library
// Note: Discogs works without authentication but with lower rate limits

import { getManagerDb } from '../db/manager.js';

const DISCOGS_BASE = 'https://api.discogs.com';

function getDiscogsCredentials() {
  try {
    const db = getManagerDb();
    const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'discogs_key'").get();
    const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'discogs_secret'").get();
    const key = (keyRow?.value && keyRow.value.trim()) || process.env.DISCOGS_KEY || '';
    const secret = (secretRow?.value && secretRow.value.trim()) || process.env.DISCOGS_SECRET || '';
    return { key, secret };
  } catch {
    return { key: process.env.DISCOGS_KEY || '', secret: process.env.DISCOGS_SECRET || '' };
  }
}

let lastDiscogsRequestTime = 0;

async function fetchDiscogsJson(url, retries = 3) {
  const { key, secret } = getDiscogsCredentials();
  const headers = { 'User-Agent': 'JewelBox-Music-Library/1.0', 'Accept': 'application/json' };
  if (key && secret) headers['Authorization'] = `Discogs key=${key}, secret=${secret}`;
  const interval = (key && secret) ? 1000 : 2000;

  // Respect Discogs rate limit
  const now = Date.now();
  const timeSinceLastRequest = now - lastDiscogsRequestTime;
  if (timeSinceLastRequest < interval) {
    const waitTime = interval - timeSinceLastRequest;
    console.log(`[Discogs] Waiting ${waitTime}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastDiscogsRequestTime = Date.now();

  const authMode = (key && secret) ? 'authenticated' : 'unauthenticated';
  console.log(`[Discogs] Using ${authMode} mode`);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`[Discogs] Attempt ${attempt + 1}/${retries}: ${url}`);
      const res = await fetch(url, { 
        headers,
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      if (!res.ok) {
        console.error(`[Discogs] HTTP ${res.status} for ${url}`);
        if (res.status === 401) {
          throw new Error('Discogs authentication failed. Please check your DISCOGS_KEY and DISCOGS_SECRET.');
        }
        if (res.status === 429) {
          console.log(`[Discogs] Rate limited, waiting longer...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      
      console.log(`[Discogs] Success on attempt ${attempt + 1}`);
      return res.json();
    } catch (err) {
      console.error(`[Discogs] Attempt ${attempt + 1} failed:`, err.message);
      
      // If this is the last attempt, throw the error
      if (attempt === retries - 1) {
        console.error(`[Discogs] All ${retries} attempts failed for ${url}`);
        throw err;
      }
      
      // Wait with exponential backoff before retrying
      const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 5000);
      console.log(`[Discogs] Retrying in ${backoffDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
}

export async function searchDiscogsByQuery({ q, artist, title, year } = {}) {
  if (!q && !artist && !title && !year) {
    throw new Error('Query parameter is required');
  }

  const params = new URLSearchParams({ type: 'release', per_page: '50' });
  if (artist) params.set('artist', artist);
  if (title) params.set('release_title', title);
  if (year) params.set('year', year);
  if (!artist && !title && !year && q) params.set('q', q);

  const data = await fetchDiscogsJson(
    `${DISCOGS_BASE}/database/search?${params.toString()}`
  );

  return normalizeDiscogsSearch(data);
}

export async function searchDiscogsByBarcode(barcode) {
  if (!barcode) {
    throw new Error('Barcode parameter is required');
  }

  const data = await fetchDiscogsJson(
    `${DISCOGS_BASE}/database/search?q=${encodeURIComponent(barcode)}&type=release&per_page=1`
  );
  
  if (!data.results || data.results.length === 0) {
    return null;
  }
  
  // Get full release details
  const releaseId = data.results[0].id;
  return getDiscogsRelease(releaseId);
}

export async function getDiscogsRelease(releaseId) {
  if (!releaseId) {
    throw new Error('Release ID is required');
  }

  const data = await fetchDiscogsJson(
    `${DISCOGS_BASE}/releases/${releaseId}`
  );
  
  return normalizeDiscogsRelease(data);
}

function normalizeDiscogsSearch(data) {
  return (data.results || []).map(item => ({
    id: item.id,
    title: item.title || '', // Use title directly for search results
    artist_name: item.artist || extractArtistFromTitle(item.title), // Use artist field if available
    year: item.year ? Number(item.year) : null,
    cover_url: item.cover_image || '', // Keep original URL for search results
    source: 'discogs'
  }));
}

function normalizeDiscogsRelease(r) {
  console.log(`[Discogs] Raw release data:`, JSON.stringify({
    id: r.id,
    title: r.title,
    cover_image: r.cover_image,
    images: r.images,
    artists: r.artists,
    labels: r.labels
  }, null, 2));
  
  // Use artists array for artist name (more reliable than parsing title)
  const artist_name = r.artists?.[0]?.name || extractArtistFromTitle(r.title);
  const title = r.title; // Use title directly since Discogs provides it separately
  const label_name = r.labels?.[0]?.name || '';
  const year = r.year ? Number(r.year) : null;
  const genre = r.genres?.[0] || '';
  
  // Extract barcode from identifiers
  const ean = extractBarcode(r.identifiers || []);
  
  // Extract tracks
  const tracks = [];
  (r.tracklist || []).forEach((track, index) => {
    // Multi-CD releases number their tracks "disc-track" ("2-5").
    const multiDisc = /^(\d+)-(\d+)$/.exec(track.position || '');
    tracks.push({
      ...(multiDisc ? { disc: Number(multiDisc[1]) } : {}),
      position: multiDisc ? Number(multiDisc[2]) : track.position || String(index + 1),
      title: track.title || '',
      duration: track.duration || null,
    });
  });
  
  // Calculate total duration
  const total_duration = calculateTotalDuration(r.tracklist || []);
  
  // Try to find cover image from images array or use thumbnail
  let cover_url = '';
  if (r.images && r.images.length > 0) {
    // Find primary image (first one with type 'primary' or first image)
    const primaryImage = r.images.find(img => img.type === 'primary') || r.images[0];
    cover_url = primaryImage?.uri || primaryImage?.resource_url || '';
  } else if (r.artists?.[0]?.thumbnail_url) {
    // Fallback to artist thumbnail if no album cover
    cover_url = r.artists[0].thumbnail_url;
  }
  
  const result = {
    id: r.id,
    title: title || '',
    artist_name,
    label_name,
    year,
    genre,
    ean,
    cover_url, // Use extracted cover URL
    total_duration,
    tracks,
    source: 'discogs'
  };
  
  console.log(`[Discogs] Normalized result:`, JSON.stringify(result, null, 2));
  return result;
}

function extractArtistFromTitle(title) {
  if (!title) return '';
  
  // Discogs format is usually "Artist - Title"
  const match = title.match(/^(.+?)\s*-\s*(.+)$/);
  if (match) {
    return match[1].trim();
  }
  
  return title;
}

function extractTitleFromFullTitle(fullTitle) {
  if (!fullTitle) return '';
  
  // Discogs format is usually "Artist - Title"
  const match = fullTitle.match(/^(.+?)\s*-\s*(.+)$/);
  if (match) {
    return match[2].trim();
  }
  
  return fullTitle;
}

function extractBarcode(identifiers) {
  const barcode = identifiers.find(id => 
    id.type === 'Barcode' || 
    id.type === 'EAN' || 
    id.type === 'UPC'
  );
  
  return barcode?.value || '';
}

function calculateTotalDuration(tracklist) {
  let totalSeconds = 0;
  
  tracklist.forEach(track => {
    if (track.duration) {
      const seconds = durationToSeconds(track.duration);
      if (!isNaN(seconds)) {
        totalSeconds += seconds;
      }
    }
  });
  
  if (totalSeconds === 0) return '';
  
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function durationToSeconds(duration) {
  // Parse format like "3:45" or "3:45" (minutes:seconds)
  const parts = duration.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return minutes * 60 + seconds;
  }
  return 0;
}

export function isDiscogsConfigured() {
  // Discogs works without authentication, so always return true
  return true;
}

export function isDiscogsAuthenticated() {
  const { key, secret } = getDiscogsCredentials();
  return Boolean(key && secret);
}
