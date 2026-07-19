import path from 'path';
import fs from 'fs';
import { getMusicLibraryPath } from '../db/settings.js';
import { startScan, getScanStatus, matchManualFolder, isAudioFile } from '../utils/audioScanner.js';
import {
  getAlbumById,
  getAlbums,
  getTrackForStream,
  searchTracks,
  setAlbumAudioFolder,
  setTrackFilePaths,
  markTrackPlayed,
  setTrackFavorite,
  recordPlay,
  getRecentPlayedItems,
  getSuggestedAlbums,
  getQueue,
  saveQueue,
  updateQueueState,
  appendToQueue,
  removeFromQueue,
  clearQueue,
  listQueueDevices,
  getTrackIdsForAlbum,
  trackExists,
} from '../db/queries.js';

// Resolves a library-relative path and guarantees it stays inside the library root.
function resolveInLibrary(libRoot, relPath) {
  const abs = path.resolve(libRoot, relPath || '.');
  if (abs !== libRoot && !abs.startsWith(libRoot + path.sep)) return null;
  return abs;
}

// Queues are scoped to a device, not a user: there are no accounts, and the
// point is to keep the web player and the phone from overwriting each other.
// Returns null after answering 400 when the header is missing.
function requireDeviceId(req, reply) {
  const id = String(req.headers['x-device-id'] || '').trim();
  if (!id || id.length > 64) {
    reply.code(400).send({ error: 'X-Device-Id header is required' });
    return null;
  }
  return id;
}

// Resolves {track_id} or {album_id} to a list of track ids, or answers an error.
function resolveTrackIds(body, reply) {
  const { track_id, album_id } = body || {};
  if (track_id != null) {
    if (!trackExists(Number(track_id))) {
      reply.code(404).send({ error: 'Track not found' });
      return null;
    }
    return [Number(track_id)];
  }
  if (album_id != null) {
    const ids = getTrackIdsForAlbum(Number(album_id));
    if (ids.length === 0) {
      reply.code(404).send({ error: 'Album not found or has no tracks' });
      return null;
    }
    return ids;
  }
  reply.code(400).send({ error: 'track_id or album_id is required' });
  return null;
}

export async function playerRoutes(fastify) {
  fastify.post('/player/scan', async (req, reply) => {
    const libRoot = getMusicLibraryPath();
    if (!libRoot) {
      return reply.code(400).send({ error: 'Music library path not configured or not a directory' });
    }
    try {
      startScan(libRoot);
    } catch (err) {
      if (err.code === 'SCAN_RUNNING') return reply.code(409).send({ error: 'Scan already running' });
      return reply.code(500).send({ error: err.message });
    }
    return reply.code(202).send({ message: 'Scan started' });
  });

  fastify.get('/player/scan/status', async () => {
    return getScanStatus();
  });

  fastify.get('/player/tracks/:id/stream', async (req, reply) => {
    try {
      const libRoot = getMusicLibraryPath();
      if (!libRoot) return reply.code(400).send({ error: 'Music library path not configured' });

      const track = getTrackForStream(Number(req.params.id));
      if (!track || !track.file_path) return reply.code(404).send({ error: 'No audio file for this track' });

      const abs = resolveInLibrary(libRoot, track.file_path);
      if (!abs) return reply.code(403).send({ error: 'Forbidden' });
      if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'File not found' });

      return reply.sendFile(path.relative(libRoot, abs), libRoot);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/player/tracks/:id/played', async (req, reply) => {
    try {
      if (!markTrackPlayed(Number(req.params.id))) {
        return reply.code(404).send({ error: 'Track not found' });
      }
      return reply.code(204).send();
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.patch('/player/tracks/:id/favorite', async (req, reply) => {
    try {
      if (typeof req.body?.is_favorite !== 'boolean') {
        return reply.code(400).send({ error: 'is_favorite must be a boolean' });
      }
      const result = setTrackFavorite(Number(req.params.id), req.body.is_favorite);
      if (!result) return reply.code(404).send({ error: 'Track not found' });
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Records that playback started from an album or playlist, feeding the
  // "recently played" section of the app's home screen.
  fastify.post('/player/history', async (req, reply) => {
    try {
      const { item_type, item_id } = req.body ?? {};
      if (item_type !== 'album' && item_type !== 'playlist') {
        return reply.code(400).send({ error: "item_type must be 'album' or 'playlist'" });
      }
      if (!Number.isInteger(item_id) || item_id <= 0) {
        return reply.code(400).send({ error: 'item_id must be a positive integer' });
      }
      if (!recordPlay(item_type, item_id)) {
        return reply.code(404).send({ error: `${item_type} not found` });
      }
      return reply.code(204).send();
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── Playback queue ─────────────────────────────────────────────────────────

  fastify.get('/player/queue', async (req, reply) => {
    try {
      const device = requireDeviceId(req, reply);
      if (!device) return reply;
      return getQueue(device);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Full replacement, sent when playback starts from an album or a playlist.
  fastify.put('/player/queue', async (req, reply) => {
    try {
      const device = requireDeviceId(req, reply);
      if (!device) return reply;

      const { track_ids, current_index, position_sec, device_label } = req.body ?? {};
      if (!Array.isArray(track_ids)) {
        return reply.code(400).send({ error: 'track_ids array is required' });
      }
      if (track_ids.some(id => !Number.isInteger(id) || id <= 0)) {
        return reply.code(400).send({ error: 'track_ids must be positive integers' });
      }
      return saveQueue(device, track_ids, {
        currentIndex: Number.isInteger(current_index) ? current_index : -1,
        positionSec: Number.isFinite(position_sec) ? position_sec : 0,
        label: device_label ? String(device_label).slice(0, 64) : null,
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Lightweight progress ping. The client throttles this: writing on every
  // timeupdate (~4 Hz) would hammer SQLite for no benefit.
  fastify.patch('/player/queue/state', async (req, reply) => {
    try {
      const device = requireDeviceId(req, reply);
      if (!device) return reply;

      const { current_index, position_sec } = req.body ?? {};
      if (current_index != null && !Number.isInteger(current_index)) {
        return reply.code(400).send({ error: 'current_index must be an integer' });
      }
      if (position_sec != null && !Number.isFinite(position_sec)) {
        return reply.code(400).send({ error: 'position_sec must be a number' });
      }
      updateQueueState(device, { currentIndex: current_index, positionSec: position_sec });
      return reply.code(204).send();
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Append ({track_id} or {album_id}), or insert right after {after_index}
  // for "play next".
  fastify.post('/player/queue/tracks', async (req, reply) => {
    try {
      const device = requireDeviceId(req, reply);
      if (!device) return reply;

      const { after_index } = req.body ?? {};
      if (after_index != null && (!Number.isInteger(after_index) || after_index < 0)) {
        return reply.code(400).send({ error: 'after_index must be a non-negative integer' });
      }
      const trackIds = resolveTrackIds(req.body, reply);
      if (!trackIds) return reply;

      return appendToQueue(device, trackIds, { afterIndex: after_index });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.delete('/player/queue/tracks/:entryId', async (req, reply) => {
    try {
      const device = requireDeviceId(req, reply);
      if (!device) return reply;

      if (!removeFromQueue(device, Number(req.params.entryId))) {
        return reply.code(404).send({ error: 'Queue entry not found' });
      }
      return getQueue(device);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.delete('/player/queue', async (req, reply) => {
    try {
      const device = requireDeviceId(req, reply);
      if (!device) return reply;

      clearQueue(device);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Queues left on other devices, so the phone can pick up what the desktop
  // was playing.
  fastify.get('/player/queue/devices', async (req, reply) => {
    try {
      const device = requireDeviceId(req, reply);
      if (!device) return reply;
      return { data: listQueueDevices(device) };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Home feed: the 8 last-played albums/playlists plus the day's suggested
  // albums (drawn once per day, see getSuggestedAlbums). Albums that entered the
  // recent section after the draw are filtered out here so the two sections
  // never show the same album twice.
  fastify.get('/player/home', async (req, reply) => {
    try {
      const recent = getRecentPlayedItems(8);
      const excludeIds = recent
        .filter(e => e.item_type === 'album')
        .map(e => e.album.id);
      const suggestions = getSuggestedAlbums({ excludeIds, limit: 12 })
        .filter(a => !excludeIds.includes(a.id));
      return { recent, suggestions };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Library search for the app's search tab: album titles and artist names via
  // getAlbums, track titles via searchTracks. Owned collection only, capped
  // (30 albums / 100 tracks) instead of paginated.
  fastify.get('/player/search', async (req, reply) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        return reply.code(400).send({ error: 'q must be at least 2 characters' });
      }
      const { data: albums } = getAlbums({ search: q, wanted: 'false', limit: 30, sort: 'artist' });
      return { albums, tracks: searchTracks(q) };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.get('/player/browse', async (req, reply) => {
    try {
      const libRoot = getMusicLibraryPath();
      if (!libRoot) return reply.code(400).send({ error: 'Music library path not configured' });

      const dir = String(req.query.dir || '');
      const abs = resolveInLibrary(libRoot, dir);
      if (!abs) return reply.code(403).send({ error: 'Forbidden' });
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        return reply.code(404).send({ error: 'Directory not found' });
      }

      const relDir = path.relative(libRoot, abs).split(path.sep).filter(Boolean).join('/');
      const entries = await fs.promises.readdir(abs, { withFileTypes: true });
      const folders = [];
      let audioFiles = 0;
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          const subRel = relDir ? `${relDir}/${entry.name}` : entry.name;
          let count = 0;
          try {
            const subEntries = await fs.promises.readdir(path.join(abs, entry.name), { withFileTypes: true });
            count = subEntries.filter(e => e.isFile() && isAudioFile(e.name)).length;
          } catch { /* unreadable folder: keep it listed with 0 files */ }
          folders.push({ name: entry.name, path: subRel, audio_files: count });
        } else if (entry.isFile() && isAudioFile(entry.name)) {
          audioFiles++;
        }
      }
      folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

      return {
        dir: relDir,
        parent: relDir ? relDir.split('/').slice(0, -1).join('/') : null,
        audio_files: audioFiles,
        folders,
      };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.put('/player/albums/:id/folder', async (req, reply) => {
    try {
      const libRoot = getMusicLibraryPath();
      if (!libRoot) return reply.code(400).send({ error: 'Music library path not configured' });

      const albumId = Number(req.params.id);
      const album = getAlbumById(albumId);
      if (!album) return reply.code(404).send({ error: 'Album not found' });

      const folder = String(req.body?.folder || '').trim();
      if (!folder) return reply.code(400).send({ error: 'folder is required' });
      const abs = resolveInLibrary(libRoot, folder);
      if (!abs || abs === libRoot) return reply.code(400).send({ error: 'Invalid folder' });
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        return reply.code(400).send({ error: 'Directory not found' });
      }

      const relFolder = path.relative(libRoot, abs).split(path.sep).join('/');
      const entries = await matchManualFolder(libRoot, relFolder, album);

      setAlbumAudioFolder(albumId, relFolder);
      setTrackFilePaths(album.tracks.map(t => ({ trackId: t.id, filePath: null })));
      setTrackFilePaths(entries);

      return {
        album: getAlbumById(albumId),
        matched: entries.length,
        total: album.tracks.length,
      };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.delete('/player/albums/:id/folder', async (req, reply) => {
    try {
      const albumId = Number(req.params.id);
      const album = getAlbumById(albumId);
      if (!album) return reply.code(404).send({ error: 'Album not found' });

      setAlbumAudioFolder(albumId, null);
      return { album: getAlbumById(albumId) };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
