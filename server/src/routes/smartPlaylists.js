import { getSmartPlaylists, getSmartPlaylistTracks } from '../db/smartPlaylists.js';

export async function smartPlaylistRoutes(fastify) {
  fastify.get('/smart-playlists', async (req, reply) => {
    try {
      return { data: getSmartPlaylists() };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.get('/smart-playlists/:key', async (req, reply) => {
    try {
      const excludeIds = String(req.query.exclude || '')
        .split(',')
        .map(Number)
        .filter(Number.isInteger);
      const tracks = getSmartPlaylistTracks(req.params.key, { excludeIds });
      if (!tracks) return reply.code(404).send({ error: 'Unknown smart playlist' });
      return { key: req.params.key, tracks };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
