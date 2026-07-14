import {
  getPlaylists,
  getPlaylistById,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTracksToPlaylist,
  removePlaylistEntry,
  reorderPlaylist,
  getTrackIdsForAlbum,
  trackExists,
} from '../db/queries.js';

export async function playlistRoutes(fastify) {
  fastify.get('/playlists', async (req, reply) => {
    try {
      return { data: getPlaylists() };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/playlists', async (req, reply) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return reply.code(400).send({ error: 'name is required' });
      return reply.code(201).send(createPlaylist(name));
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.get('/playlists/:id', async (req, reply) => {
    try {
      const playlist = getPlaylistById(Number(req.params.id));
      if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });
      return playlist;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.patch('/playlists/:id', async (req, reply) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return reply.code(400).send({ error: 'name is required' });
      const playlist = renamePlaylist(Number(req.params.id), name);
      if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });
      return playlist;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.delete('/playlists/:id', async (req, reply) => {
    try {
      if (!deletePlaylist(Number(req.params.id))) {
        return reply.code(404).send({ error: 'Playlist not found' });
      }
      return reply.code(204).send();
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Add one track ({track_id}) or a whole album ({album_id}) at the end
  fastify.post('/playlists/:id/tracks', async (req, reply) => {
    try {
      const playlistId = Number(req.params.id);
      if (!getPlaylistById(playlistId)) return reply.code(404).send({ error: 'Playlist not found' });

      const { track_id, album_id } = req.body || {};
      let trackIds;
      if (track_id != null) {
        if (!trackExists(Number(track_id))) return reply.code(404).send({ error: 'Track not found' });
        trackIds = [Number(track_id)];
      } else if (album_id != null) {
        trackIds = getTrackIdsForAlbum(Number(album_id));
        if (trackIds.length === 0) return reply.code(404).send({ error: 'Album not found or has no tracks' });
      } else {
        return reply.code(400).send({ error: 'track_id or album_id is required' });
      }

      const added = addTracksToPlaylist(playlistId, trackIds);
      return { ...getPlaylistById(playlistId), added };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.delete('/playlists/:id/tracks/:entryId', async (req, reply) => {
    try {
      const playlistId = Number(req.params.id);
      if (!removePlaylistEntry(playlistId, Number(req.params.entryId))) {
        return reply.code(404).send({ error: 'Playlist entry not found' });
      }
      return getPlaylistById(playlistId);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Reorder: body carries the full ordered list of entry ids
  fastify.put('/playlists/:id/tracks', async (req, reply) => {
    try {
      const playlistId = Number(req.params.id);
      if (!getPlaylistById(playlistId)) return reply.code(404).send({ error: 'Playlist not found' });

      const entryIds = req.body?.entry_ids;
      if (!Array.isArray(entryIds)) return reply.code(400).send({ error: 'entry_ids array is required' });
      if (!reorderPlaylist(playlistId, entryIds.map(Number))) {
        return reply.code(400).send({ error: 'entry_ids must match the playlist entries exactly' });
      }
      return getPlaylistById(playlistId);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
