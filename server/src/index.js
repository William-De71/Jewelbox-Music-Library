import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { albumRoutes } from './routes/albums.js';
import { searchRoutes } from './routes/search.js';
import { versionRoutes, APP_VERSION } from './routes/version.js';
import { playerRoutes } from './routes/player.js';
import { playlistRoutes } from './routes/playlists.js';
import { lastfmRoutes, dropStaleSession } from './routes/lastfm.js';
import { isLastfmAvailable } from './utils/lastfmCredentials.js';
import { getBrowseRoots, resolveInRoots, listDirectory, parentWithinRoots } from './utils/fsBrowser.js';
import { smartPlaylistRoutes } from './routes/smartPlaylists.js';
import { createDatabase, setActiveDatabase, deleteDatabase } from './db/manager.js';
import { advertise, stopAdvertising, serviceName } from './utils/mdns.js';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database setup
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MANAGER_DB_PATH = path.join(DATA_DIR, 'jewelbox_manager.db');
let managerDb = null;

function getManagerDb() {
  if (!managerDb) {
    managerDb = new Database(MANAGER_DB_PATH);
    managerDb.exec(`
      CREATE TABLE IF NOT EXISTS databases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  return managerDb;
}

const fastify = Fastify({
  logger: false
});

// Register CORS
await fastify.register(cors);

// Register multipart (for CSV import)
await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

// Register static files plugin for sendFile support
await fastify.register(staticFiles, {
  root: DATA_DIR,
  serve: false,
  decorateReply: true
});

// Register album routes
await fastify.register(albumRoutes, { prefix: '/api' });

// Register search routes
await fastify.register(searchRoutes, { prefix: '/api' });

// Register audio player routes
await fastify.register(playerRoutes, { prefix: '/api' });

// Register playlist routes
await fastify.register(playlistRoutes, { prefix: '/api' });

// Register Last.fm scrobbling routes
await fastify.register(lastfmRoutes, { prefix: '/api' });

// Register smart playlist routes
await fastify.register(smartPlaylistRoutes, { prefix: '/api' });

// Register version routes
await fastify.register(versionRoutes);

// Serve covers from active database folder
fastify.get('/covers/:filename', async (req, reply) => {
  try {
    console.log(`[Covers] Request for: ${req.params.filename}`);
    
    const db = getManagerDb();
    const activeDb = db.prepare('SELECT * FROM databases WHERE is_active = 1 LIMIT 1').get();
    
    if (!activeDb) {
      console.error('[Covers] No active database found');
      return reply.code(404).send({ error: 'No active database' });
    }
    
    console.log(`[Covers] Active DB: ${activeDb.path}`);
    
    const dbFolder = path.dirname(activeDb.path);
    const coversFolder = path.join(dbFolder, 'covers');
    const filePath = path.join(coversFolder, req.params.filename);
    
    console.log(`[Covers] Looking for file: ${filePath}`);
    
    // Security: ensure file is within covers folder
    if (!filePath.startsWith(coversFolder)) {
      console.error('[Covers] Security violation - path outside covers folder');
      return reply.code(403).send({ error: 'Forbidden' });
    }
    
    if (!fs.existsSync(filePath)) {
      console.error(`[Covers] File not found: ${filePath}`);
      return reply.code(404).send({ error: 'File not found' });
    }
    
    console.log(`[Covers] Serving file: ${filePath}`);
    return reply.sendFile(req.params.filename, coversFolder);
  } catch (err) {
    console.error('[Covers] Error serving file:', err);
    return reply.code(500).send({ error: 'Failed to serve file' });
  }
});

// Real database routes
fastify.get('/api/databases', async (req, reply) => {
  try {
    const db = getManagerDb();
    const databases = db.prepare('SELECT * FROM databases ORDER BY created_at DESC').all();
    const activeDb = db.prepare('SELECT * FROM databases WHERE is_active = 1 LIMIT 1').get();
    
    return { databases, active: activeDb };
  } catch (err) {
    console.error('[DB] Error fetching databases:', err);
    return reply.code(500).send({ error: 'Failed to fetch databases' });
  }
});

fastify.post('/api/databases', async (req, reply) => {
  try {
    const { name, description } = req.body;
    
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'Database name is required' });
    }

    const db = getManagerDb();
    
    // Create folder for this database
    const dbFolder = path.join(DATA_DIR, name.trim());
    if (!fs.existsSync(dbFolder)) {
      fs.mkdirSync(dbFolder, { recursive: true });
    }
    
    // Create covers subfolder
    const coversFolder = path.join(dbFolder, 'covers');
    if (!fs.existsSync(coversFolder)) {
      fs.mkdirSync(coversFolder, { recursive: true });
    }
    
    const dbPath = path.join(dbFolder, `${name.trim()}.db`);
    
    // Create the database file with correct schema
    const newDb = new Database(dbPath);
    newDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS artists (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS labels (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS albums (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        title          TEXT NOT NULL,
        artist_id      INTEGER NOT NULL REFERENCES artists(id) ON DELETE RESTRICT,
        label_id       INTEGER REFERENCES labels(id) ON DELETE SET NULL,
        year           INTEGER,
        genre          TEXT,
        total_duration TEXT,
        ean            TEXT UNIQUE,
        rating         INTEGER CHECK(rating BETWEEN 1 AND 5),
        cover_url      TEXT,
        notes          TEXT,
        is_lent        INTEGER NOT NULL DEFAULT 0 CHECK(is_lent IN (0,1)),
        lent_to        TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        position   INTEGER NOT NULL,
        title      TEXT NOT NULL,
        duration   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_albums_artist  ON albums(artist_id);
      CREATE INDEX IF NOT EXISTS idx_albums_label   ON albums(label_id);
      CREATE INDEX IF NOT EXISTS idx_albums_genre   ON albums(genre);
      CREATE INDEX IF NOT EXISTS idx_albums_rating  ON albums(rating);
      CREATE INDEX IF NOT EXISTS idx_tracks_album   ON tracks(album_id);
    `);
    
    newDb.close();
    
    console.log(`[CreateDB] Created database with correct schema: ${dbPath}`);

    // Insert into manager
    const result = db.prepare(`
      INSERT INTO databases (name, path, description) 
      VALUES (?, ?, ?)
    `).run(name.trim(), dbPath, description || '');
    
    return reply.code(201).send({
      id: result.lastInsertRowid,
      name: name.trim(),
      description: description || '',
      message: 'Database created successfully'
    });
  } catch (err) {
    console.error('[DB] Error creating database:', err);
    
    if (err.message.includes('UNIQUE constraint failed')) {
      return reply.code(409).send({ error: 'Database name already exists' });
    }
    
    return reply.code(500).send({ error: 'Failed to create database' });
  }
});

// Activate database
fastify.post('/api/databases/:id/activate', {
  config: {
    rawBody: false
  }
}, async (req, reply) => {
  try {
    const { id } = req.params;
    console.log('[ACTIVATE] Received ID:', id, 'Type:', typeof id);
    const db = getManagerDb();
    
    // Clear all active flags
    db.exec('UPDATE databases SET is_active = 0');
    
    // Set new active
    const result = db.prepare('UPDATE databases SET is_active = 1 WHERE id = ?').run(parseInt(id));
    
    if (result.changes === 0) {
      return reply.code(404).send({ error: 'Database not found' });
    }
    
    return { message: 'Database activated successfully' };
  } catch (err) {
    console.error('[DB] Error activating database:', err);
    console.error('[DB] Error details:', err.message, err.stack);
    return reply.code(500).send({ error: 'Failed to activate database' });
  }
});

// Update database
fastify.patch('/api/databases/:id', async (req, reply) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'Database name is required' });
    }

    const db = getManagerDb();
    const result = db.prepare(`
      UPDATE databases 
      SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(name.trim(), description || '', parseInt(id));
    
    if (result.changes === 0) {
      return reply.code(404).send({ error: 'Database not found' });
    }
    
    return { message: 'Database updated successfully' };
  } catch (err) {
    console.error('[DB] Error updating database:', err);
    
    if (err.message.includes('UNIQUE constraint failed')) {
      return reply.code(409).send({ error: 'Database name already exists' });
    }
    
    return reply.code(500).send({ error: 'Failed to update database' });
  }
});

// Delete database
fastify.delete('/api/databases/:id', async (req, reply) => {
  try {
    const { id } = req.params;
    const db = getManagerDb();
    
    // Get database info
    const dbRecord = db.prepare('SELECT * FROM databases WHERE id = ?').get(parseInt(id));
    if (!dbRecord) {
      return reply.code(404).send({ error: 'Database not found' });
    }

    // Delete the entire database folder
    const dbFolder = path.dirname(dbRecord.path);
    if (fs.existsSync(dbFolder)) {
      // Remove folder and all contents recursively
      fs.rmSync(dbFolder, { recursive: true, force: true });
    }

    // Delete from manager
    const result = db.prepare('DELETE FROM databases WHERE id = ?').run(parseInt(id));
    
    return { message: 'Database deleted successfully' };
  } catch (err) {
    console.error('[DB] Error deleting database:', err);
    return reply.code(500).send({ error: 'Failed to delete database' });
  }
});

// Get settings
// Secrets never leave the server; the client only sees "configured" booleans.
// The Last.fm app key/secret ship with the build (see utils/lastfmCredentials.js)
// and are no longer stored in settings; legacy rows are hidden and ignored.
const HIDDEN_SETTINGS = ['lastfm_api_key', 'lastfm_api_secret', 'lastfm_session_key', 'lastfm_session_api_key'];

fastify.get('/api/settings', async (req, reply) => {
  try {
    const db = getManagerDb();
    // Sessions authorised with a different app key are dead: clear them first
    // so the UI never reports "connected" for a session that cannot scrobble.
    dropStaleSession();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { if (!HIDDEN_SETTINGS.includes(r.key)) settings[r.key] = r.value; });
    settings.lastfm_connected = rows.some(r => r.key === 'lastfm_session_key' && r.value);
    settings.lastfm_available = isLastfmAvailable();
    return settings;
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Save settings
fastify.put('/api/settings', async (req, reply) => {
  try {
    const db = getManagerDb();
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    const entries = Object.entries(req.body);
    const READONLY_SETTINGS = new Set([
      // Synthetic flags from GET /api/settings.
      'lastfm_connected', 'lastfm_available',
      // App credentials ship with the build; the session key is set by the auth flow.
      'lastfm_api_key', 'lastfm_api_secret', 'lastfm_session_key', 'lastfm_session_api_key',
    ]);
    entries.forEach(([key, value]) => {
      if (READONLY_SETTINGS.has(key)) return;
      stmt.run(key, value ?? '');
    });
    return { message: 'Settings saved' };
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Browse the server filesystem to pick the music library directory.
// Unlike GET /api/player/browse, this walks absolute paths and does not need a
// library to be configured yet — that is the whole point: it is how you choose one.
fastify.get('/api/settings/browse', async (req, reply) => {
  try {
    const roots = getBrowseRoots();
    const dir = String(req.query.dir || '');

    // No dir: hand back the roots themselves as the starting point.
    if (!dir) {
      const entries = roots.map(root => ({
        name: root,
        path: root,
        audio_files: 0,
      }));
      return { dir: '', parent: null, audio_files: 0, folders: entries, roots };
    }

    const abs = resolveInRoots(dir, roots);
    if (!abs) return reply.code(403).send({ error: 'Forbidden' });
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      return reply.code(404).send({ error: 'Directory not found' });
    }

    const { folders, audioFiles } = await listDirectory(abs);
    return {
      dir: abs,
      parent: parentWithinRoots(abs, roots),
      audio_files: audioFiles,
      folders,
      roots,
    };
  } catch (err) {
    if (err.code === 'EACCES') return reply.code(403).send({ error: 'Permission denied' });
    return reply.code(500).send({ error: err.message });
  }
});

// Get active database info
fastify.get('/api/database/active', async (req, reply) => {
  try {
    const db = getManagerDb();
    const activeDb = db.prepare('SELECT * FROM databases WHERE is_active = 1 LIMIT 1').get();
    
    if (!activeDb) {
      return reply.code(404).send({ error: 'No active database found' });
    }
    
    return { database: activeDb };
  } catch (err) {
    console.error('[DB] Error fetching active database:', err);
    return reply.code(500).send({ error: 'Failed to fetch active database' });
  }
});

// Stable identity for this server, minted on first boot and kept in the manager
// DB. The LAN address changes with every DHCP lease, so this is what lets a
// client recognise a server it has already paired with after rediscovery.
function getServerId() {
  const db = getManagerDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'server_id'").get();
  if (row?.value) return row.value;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('server_id', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(id);
  return id;
}

// What a client fetches right after resolving the mDNS record, to confirm it
// found a JewelBox and not some other service squatting the port.
fastify.get('/api/server-info', async (req, reply) => {
  try {
    const db = getManagerDb();
    const activeDb = db.prepare('SELECT name FROM databases WHERE is_active = 1 LIMIT 1').get();
    return {
      app: 'jewelbox',
      name: serviceName(),
      version: APP_VERSION,
      server_id: getServerId(),
      api: '/api',
      collection: activeDb?.name ?? null,
    };
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Health check
fastify.get('/api/health', async (req, reply) => {
  return { status: 'ok' };
});

// Serve frontend static files (production)
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  fastify.get('/*', async (req, reply) => {
    const filePath = path.join(clientDist, req.url === '/' ? 'index.html' : req.url);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return reply.sendFile(req.url === '/' ? 'index.html' : req.url, clientDist);
    }
    return reply.sendFile('index.html', clientDist);
  });
}

// Start server
const PORT = parseInt(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Server listening at http://${HOST}:${PORT}`);
  advertise({ port: PORT, version: APP_VERSION, serverId: getServerId() });
} catch (err) {
  console.error('Error starting server:', err);
  process.exit(1);
}

// Withdraw the mDNS record on the way out, otherwise clients keep resolving a
// dead address from their cache.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopAdvertising();
    await fastify.close();
    process.exit(0);
  });
}
