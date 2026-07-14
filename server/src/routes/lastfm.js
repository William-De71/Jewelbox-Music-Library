import { getSetting, setSetting, deleteSetting } from '../db/settings.js';
import { authUrl, getSession, updateNowPlaying, scrobble } from '../utils/lastfm.js';
import { getTrackWithAlbum, durationToSeconds } from '../db/queries.js';

function getCreds() {
  const apiKey = getSetting('lastfm_api_key');
  const secret = getSetting('lastfm_api_secret');
  const sessionKey = getSetting('lastfm_session_key');
  return { apiKey, secret, sessionKey };
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
      return reply.code(400).send({ error: 'Last.fm API key and secret are not configured' });
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
      return reply.redirect(302, '/settings');
    } catch (err) {
      console.error('[Last.fm] callback failed:', err.message);
      return reply.redirect(302, '/settings?lastfm=error');
    }
  });

  fastify.delete('/lastfm/session', async (req, reply) => {
    deleteSetting('lastfm_session_key');
    deleteSetting('lastfm_username');
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
    return fireAndForget(req, reply, (creds, meta) => scrobble(creds, { ...meta, timestamp: Math.floor(startedAt) }));
  });
}
