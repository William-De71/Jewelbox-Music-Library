import { getDb } from '../db/database.js';
import { getLiveTrack } from '../db/queries.js';
import { SMART_PLAYLIST_KEYS } from '../db/smartPlaylists.js';
import { createRemoteRegistry } from '../utils/remote.js';

// One registry for the whole server: the queue routes feed it the live state
// reports, the routes below the streams and the commands.
export const remote = createRemoteRegistry({ resolveTrack: id => getLiveTrack(id) });

const HEARTBEAT_MS = 20_000;
const PRUNE_MS = 15_000;

// EventSource cannot set a header: the web app passes ?device_id= instead.
function streamDeviceId(req) {
  const id = String(req.headers['x-device-id'] || req.query?.device_id || '').trim();
  return id && id.length <= 64 ? id : null;
}

// Server-Sent Events on the raw response. A comment line every 20 s keeps
// proxies and phone networks from dropping an idle connection.
function openStream(req, reply, onClose) {
  reply.hijack();
  reply.raw.writeHead(200, {
    ...reply.getHeaders(), // CORS, set by @fastify/cors before the hijack
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  reply.raw.write('retry: 3000\n\n');
  const send = (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    onClose?.();
    reply.raw.end();
  };
  req.raw.on('close', close);
  return { send, close };
}

function mediaExists({ type, id }) {
  const db = getDb();
  const has = (table) => Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
  switch (type) {
    case 'album':
    case 'album_radio':
      return has('albums');
    case 'artist_radio':
      return has('artists');
    case 'playlist':
      return has('playlists');
    case 'track':
      return has('tracks');
    case 'smart':
      return SMART_PLAYLIST_KEYS.includes(id);
    default:
      return false;
  }
}

export async function remoteRoutes(fastify) {
  const streams = new Set();
  const pruner = setInterval(() => remote.prune(), PRUNE_MS);
  pruner.unref();

  // Open streams never end on their own: close them before the server waits
  // for its connections.
  fastify.addHook('preClose', async () => {
    clearInterval(pruner);
    for (const stream of streams) stream.close();
  });

  // A player that allows remote control keeps this open. ?label= names it,
  // ?capabilities= lists what it supports (see CAPABILITIES).
  fastify.get('/player/remote/events', async (req, reply) => {
    const device = streamDeviceId(req);
    if (!device) return reply.code(400).send({ error: 'X-Device-Id header or device_id is required' });
    const label = req.query?.label ? String(req.query.label).slice(0, 64) : null;
    let detach = null;
    const stream = openStream(req, reply, () => {
      streams.delete(stream);
      detach?.();
    });
    streams.add(stream);
    detach = remote.connect(device, { label, capabilities: req.query?.capabilities, send: stream.send, close: stream.close });
    stream.send('hello', { device_id: device });
    return reply;
  });

  // For controllers: the whole list first, then one event per change.
  fastify.get('/player/remote/watch', async (req, reply) => {
    let unwatch = null;
    const stream = openStream(req, reply, () => {
      streams.delete(stream);
      unwatch?.();
    });
    streams.add(stream);
    stream.send('devices', { data: remote.list() });
    unwatch = remote.watch(({ event, data }) => stream.send(event, data));
    return reply;
  });

  fastify.get('/player/remote/devices', async () => ({ data: remote.list() }));

  // 202: written on the player's stream. The player confirms through its next
  // state report, not here.
  fastify.post('/player/remote/devices/:deviceId/commands', async (req, reply) => {
    try {
      const device = String(req.params.deviceId || '').trim();
      const result = remote.send(device, req.body, {
        check: (command) =>
          command.command === 'play_media' && !mediaExists(command.media)
            ? { status: 404, error: `${command.media.type} not found` }
            : null,
      });
      if (result.error) return reply.code(result.status).send({ error: result.error });
      return reply.code(202).send({ id: result.id });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
