import {
  getSmartPlaylists,
  getSmartPlaylistTracks,
  consumeDynamicMixTrack,
  refreshDynamicMix,
} from '../db/smartPlaylists.js';

export async function smartPlaylistRoutes(fastify) {
  fastify.get('/smart-playlists', async (req, reply) => {
    try {
      return { data: getSmartPlaylists() };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // A dynamic mix track finished playing: drop it from the list and refill.
  fastify.post('/smart-playlists/dynamic_mix/played', async (req, reply) => {
    try {
      const trackId = Number(req.body?.track_id);
      if (!Number.isInteger(trackId)) return reply.code(400).send({ error: 'track_id must be an integer' });
      return consumeDynamicMixTrack(trackId);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Manual removal (disliked track): same behaviour as a played track —
  // drop it from the list and refill at the bottom.
  fastify.delete('/smart-playlists/dynamic_mix/tracks/:trackId', async (req, reply) => {
    try {
      const trackId = Number(req.params.trackId);
      if (!Number.isInteger(trackId)) return reply.code(400).send({ error: 'trackId must be an integer' });
      return consumeDynamicMixTrack(trackId);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Full refresh: discard the current mix and draw a completely new one.
  fastify.post('/smart-playlists/dynamic_mix/refresh', async (req, reply) => {
    try {
      return { key: 'dynamic_mix', tracks: refreshDynamicMix() };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.get('/smart-playlists/:key', async (req, reply) => {
    try {
      const tracks = getSmartPlaylistTracks(req.params.key);
      if (!tracks) return reply.code(404).send({ error: 'Unknown smart playlist' });
      return { key: req.params.key, tracks };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
