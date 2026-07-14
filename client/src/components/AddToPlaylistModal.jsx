import { useState, useEffect } from 'preact/hooks';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';
import { ListMusic, Plus, X, AlertCircle } from 'lucide-preact';

// Adds a track ({trackId}) or a whole album ({albumId}) to a playlist.
export function AddToPlaylistModal({ trackId, albumId, onClose, onAdded }) {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getPlaylists()
      .then((res) => setPlaylists(res.data))
      .catch((e) => setError(e.message));
  }, []);

  const payload = trackId != null ? { track_id: trackId } : { album_id: albumId };

  const handleAdd = async (playlistId) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.addToPlaylist(playlistId, payload);
      onAdded(result);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const handleCreateAndAdd = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const playlist = await api.createPlaylist(name);
      const result = await api.addToPlaylist(playlist.id, payload);
      onAdded(result);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div class="folder-picker-overlay" onClick={onClose}>
      <div class="folder-picker-card" onClick={(e) => e.stopPropagation()}>
        <div class="folder-picker-header">
          <h5 class="mb-0">
            {trackId != null ? t('playlists.addToPlaylist') : t('playlists.addAlbumToPlaylist')}
          </h5>
          <button class="btn btn-icon btn-ghost-secondary" onClick={onClose} title={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <div class="folder-picker-body">
          {error && (
            <div class="alert alert-danger p-2 d-flex align-items-center gap-2 mb-2">
              <AlertCircle size={16} class="flex-shrink-0" />{error}
            </div>
          )}
          {!playlists ? (
            <div class="text-center py-4">
              <div class="spinner-border spinner-border-sm text-primary"></div>
            </div>
          ) : playlists.length > 0 ? (
            <div class="list-group list-group-flush">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  class="list-group-item list-group-item-action d-flex align-items-center gap-2"
                  disabled={busy}
                  onClick={() => handleAdd(p.id)}
                >
                  <ListMusic size={16} class="text-muted flex-shrink-0" />
                  <span class="text-truncate">{p.name}</span>
                  <span class="badge bg-blue-lt ms-auto flex-shrink-0">
                    {t('playlists.trackCount', { n: String(p.track_count) })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div class="text-center text-muted py-3">{t('playlists.chooseOrCreate')}</div>
          )}
        </div>

        <div class="folder-picker-footer">
          <form class="d-flex gap-2 w-100" onSubmit={handleCreateAndAdd}>
            <input
              type="text"
              class="form-control"
              placeholder={t('playlists.namePlaceholder')}
              value={newName}
              onInput={(e) => setNewName(e.currentTarget.value)}
              disabled={busy}
            />
            <button type="submit" class="btn btn-primary flex-shrink-0" disabled={busy || !newName.trim()}>
              {busy
                ? <span class="spinner-border spinner-border-sm"></span>
                : <><Plus size={16} class="me-1" />{t('playlists.createAndAdd')}</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
