import { getSetting, setSetting, deleteSetting } from '../db/settings.js';
import { authUrl, getSession, updateNowPlaying, scrobble } from '../utils/lastfm.js';
import { getAppCredentials } from '../utils/lastfmCredentials.js';
import { getTrackWithAlbum, durationToSeconds } from '../db/queries.js';
import { addPending, isTransientFailure, parsePending, prunePending, removePending } from '../utils/scrobbleQueue.js';

// Scrobbles waiting for Last.fm to answer again (utils/scrobbleQueue.js),
// kept with the settings: like the session, they belong to the server, not
// to a collection.
export const PENDING_SCROBBLES_KEY = 'lastfm_pending_scrobbles';
const FLUSH_MS = 5 * 60 * 1000;

const nowSec = () => Math.floor(Date.now() / 1000);

function loadPending() {
  return prunePending(parsePending(getSetting(PENDING_SCROBBLES_KEY)), nowSec());
}

function storePending(list) {
  if (list.length) setSetting(PENDING_SCROBBLES_KEY, JSON.stringify(list));
  else deleteSetting(PENDING_SCROBBLES_KEY);
}

let flushing = false;

// Sends the waiting scrobbles, oldest first, and stops at the first one
// Last.fm cannot take yet. The list is read again around every call: a play
// reported meanwhile must not be lost.
export async function flushPendingScrobbles() {
  if (flushing) return;
  const creds = getCreds();
  if (!creds.apiKey || !creds.secret || !creds.sessionKey) return;
  flushing = true;
  try {
    for (const entry of loadPending()) {
      try {
        await scrobble(creds, entry);
      } catch (err) {
        if (isTransientFailure(err)) return;
        console.error('[Last.fm]', err.message); // refused for good: not sent again
      }
      storePending(removePending(loadPending(), entry));
    }
  } finally {
    flushing = false;
  }
}

// A Last.fm session key is bound to the API key that authorised it. When the
// app key changes (upgrade from the user-supplied key, env override, revoked
// key), old sessions silently stop scrobbling — drop them so the UI shows
// "not connected" and the user can re-authorise instead of scrobbling to a void.
export function dropStaleSession(apiKey = getAppCredentials().apiKey) {
  if (!apiKey || !getSetting('lastfm_session_key')) return;
  if (getSetting('lastfm_session_api_key') === apiKey) return;
  deleteSetting('lastfm_session_key');
  deleteSetting('lastfm_username');
  deleteSetting('lastfm_session_api_key');
}

function getCreds() {
  const { apiKey, secret } = getAppCredentials();
  dropStaleSession(apiKey);
  return { apiKey, secret, sessionKey: getSetting('lastfm_session_key') };
}

// Scrobbling must never disturb playback: enrich the track, call Last.fm,
// swallow every error and reply 204 either way.
async function fireAndForget(req, reply, action) {
  const creds = getCreds();
  if (!creds.apiKey || !creds.secret || !creds.sessionKey) return reply.code(204).send();

  const track = getTrackWithAlbum(Number(req.body?.track_id));
  if (!track) return reply.code(404).send({ error: 'Track not found' });

  try {
    await action(creds, {
      artist: track.artist_name,
      track: track.title,
      album: track.album_title,
      duration: durationToSeconds(track.duration) || undefined,
    });
  } catch (err) {
    console.error('[Last.fm]', err.message);
  }
  return reply.code(204).send();
}

export async function lastfmRoutes(fastify) {
  fastify.get('/lastfm/connect', async (req, reply) => {
    const { apiKey, secret } = getCreds();
    if (!apiKey || !secret) {
      return reply.code(503).send({ error: 'Last.fm support is unavailable in this build' });
    }
    const origin = String(req.query.origin || '');
    if (!/^https?:\/\//.test(origin)) {
      return reply.code(400).send({ error: 'Invalid origin' });
    }
    return { url: authUrl(apiKey, `${origin.replace(/\/$/, '')}/api/lastfm/callback`) };
  });

  fastify.get('/lastfm/callback', async (req, reply) => {
    const { apiKey, secret } = getCreds();
    const token = String(req.query.token || '');
    try {
      if (!apiKey || !secret || !token) throw new Error('Missing credentials or token');
      const session = await getSession(apiKey, secret, token);
      setSetting('lastfm_session_key', session.key);
      setSetting('lastfm_username', session.name);
      setSetting('lastfm_session_api_key', apiKey);
      return reply.redirect(302, '/settings');
    } catch (err) {
      console.error('[Last.fm] callback failed:', err.message);
      return reply.redirect(302, '/settings?lastfm=error');
    }
  });

  // Waiting scrobbles are tried again now and then, not only at the next play.
  const timer = setInterval(() => { flushPendingScrobbles().catch(() => {}); }, FLUSH_MS);
  timer.unref?.();
  fastify.addHook('onClose', async () => clearInterval(timer));

  fastify.delete('/lastfm/session', async (req, reply) => {
    // Plays waiting for this account must not land on the next one.
    deleteSetting(PENDING_SCROBBLES_KEY);
    deleteSetting('lastfm_session_key');
    deleteSetting('lastfm_username');
    deleteSetting('lastfm_session_api_key');
    return reply.code(204).send();
  });

  fastify.post('/lastfm/nowplaying', async (req, reply) => {
    return fireAndForget(req, reply, (creds, meta) => updateNowPlaying(creds, meta));
  });

  fastify.post('/lastfm/scrobble', async (req, reply) => {
    const startedAt = Number(req.body?.started_at);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      return reply.code(400).send({ error: 'started_at (epoch seconds) is required' });
    }
    // Kept for later when Last.fm cannot take it now; behind the scrobbles
    // already waiting, so the order holds.
    return fireAndForget(req, reply, async (creds, meta) => {
      const entry = { ...meta, timestamp: Math.floor(startedAt) };
      if (loadPending().length) {
        storePending(addPending(loadPending(), entry, nowSec()));
        flushPendingScrobbles().catch(() => {});
        return;
      }
      try {
        await scrobble(creds, entry);
      } catch (err) {
        if (isTransientFailure(err)) storePending(addPending(loadPending(), entry, nowSec()));
        throw err;
      }
    });
  });
}
