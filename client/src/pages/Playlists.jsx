import { useState, useEffect } from 'preact/hooks';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';
import { usePlayer } from '../components/PlayerContext.jsx';
import {
  ListMusic, Plus, Play, Pause, Pencil, Trash2, X, Check, ArrowLeft,
  ChevronUp, ChevronDown, AlertCircle, Clock, Heart, RefreshCw,
  Sparkles, History, Music, ChartColumn, Library, Infinity as InfinityIcon,
} from 'lucide-preact';

const SMART_KEYS = [
  'newest', 'ever_played', 'never_played', 'last_played',
  'most_played', 'favourites', 'all_tracks', 'dynamic_mix',
];

const SMART_ICONS = {
  newest: Sparkles, ever_played: History, never_played: Music,
  last_played: Clock, most_played: ChartColumn, favourites: Heart,
  all_tracks: Library, dynamic_mix: InfinityIcon,
};

function formatSeconds(total) {
  if (!total) return '—';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function Playlists({ navigate, params }) {
  const { t } = useI18n();
  const {
    playTracks, playDynamicMix, current, playing, toggle, toggleFavorite,
    removeDynamicMixTrack, refreshDynamicMix,
  } = usePlayer();
  const [playlists, setPlaylists] = useState(null);
  const [smartPlaylists, setSmartPlaylists] = useState(null);
  const [playlist, setPlaylist] = useState(null);
  const [smart, setSmart] = useState(null); // { key, tracks } for the smart detail view
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [nameModal, setNameModal] = useState(null); // { mode: 'create' | 'rename', value }
  const [deleteTarget, setDeleteTarget] = useState(null);

  const playlistId = params?.id ? Number(params.id) : null;
  const smartKey = params?.smart || null;

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadList = () => {
    api.getPlaylists()
      .then((res) => setPlaylists(res.data))
      .catch((e) => setError(e.message));
    api.getSmartPlaylists()
      .then((res) => setSmartPlaylists(res.data))
      .catch(() => {});
  };

  const loadDetail = (id) => {
    api.getPlaylist(id)
      .then(setPlaylist)
      .catch((e) => setError(e.message));
  };

  const loadSmart = (key) => {
    api.getSmartPlaylist(key)
      .then(setSmart)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setError(null);
    if (smartKey) loadSmart(smartKey);
    else if (playlistId) loadDetail(playlistId);
    else loadList();
  }, [playlistId, smartKey]);

  const handleSaveName = async (e) => {
    e.preventDefault();
    const name = nameModal.value.trim();
    if (!name) return;
    try {
      if (nameModal.mode === 'create') {
        const created = await api.createPlaylist(name);
        setNameModal(null);
        showToast(t('playlists.created'));
        navigate('playlists', { id: created.id });
      } else {
        const updated = await api.renamePlaylist(nameModal.id, name);
        setNameModal(null);
        showToast(t('playlists.renamed'));
        if (playlistId) setPlaylist(updated);
        else loadList();
      }
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleDelete = async () => {
    try {
      await api.deletePlaylist(deleteTarget.id);
      setDeleteTarget(null);
      showToast(t('playlists.deleted'));
      if (playlistId) navigate('playlists');
      else loadList();
    } catch (err) {
      showToast(err.message, 'danger');
      setDeleteTarget(null);
    }
  };

  const playableTracks = playlist?.tracks?.filter((tr) => tr.has_file) || [];

  const handlePlayTrack = (track) => {
    if (current?.id === track.id) {
      toggle();
      return;
    }
    playTracks(playableTracks, playableTracks.findIndex((tr) => tr.entry_id === track.entry_id));
  };

  const handleRemoveEntry = async (entryId) => {
    try {
      const updated = await api.removePlaylistEntry(playlist.id, entryId);
      setPlaylist(updated);
      showToast(t('playlists.removed'));
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleMove = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= playlist.tracks.length) return;
    const previous = playlist;
    const tracks = [...playlist.tracks];
    [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
    setPlaylist({ ...playlist, tracks });
    try {
      const updated = await api.reorderPlaylist(playlist.id, tracks.map((tr) => tr.entry_id));
      setPlaylist(updated);
    } catch (err) {
      setPlaylist(previous);
      showToast(err.message, 'danger');
    }
  };

  // Smart playlist detail (read-only)
  const smartPlayable = smart?.tracks?.filter((tr) => tr.has_file) || [];

  const handlePlaySmart = () => {
    if (smartKey === 'dynamic_mix') playDynamicMix();
    else playTracks(smartPlayable);
  };

  const handlePlaySmartTrack = (track, i) => {
    if (current?.id === track.id) {
      toggle();
      return;
    }
    playTracks(smartPlayable, smartPlayable.findIndex((tr) => tr.id === track.id), { dynamic: smartKey === 'dynamic_mix' });
  };

  const [mixBusy, setMixBusy] = useState(false);

  const handleRefreshMix = async () => {
    setMixBusy(true);
    try {
      const tracks = await refreshDynamicMix();
      setSmart({ key: 'dynamic_mix', tracks });
      showToast(t('playlists.mixRefreshed'));
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setMixBusy(false);
    }
  };

  const handleRemoveMixTrack = async (track) => {
    try {
      const tracks = await removeDynamicMixTrack(track.id);
      setSmart({ key: 'dynamic_mix', tracks });
      showToast(t('playlists.mixRemoved'));
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleToggleSmartFavorite = (track) => {
    const next = !track.is_favorite;
    setSmart((s) => ({ ...s, tracks: s.tracks.map((tr) => (tr.id === track.id ? { ...tr, is_favorite: next } : tr)) }));
    toggleFavorite(track.id, next);
  };

  if (error) {
    return (
      <div class="container-xl">
        <div class="alert alert-danger">
          <AlertCircle size={16} class="me-2" />{error}
          <button class="btn btn-link p-0 ms-2" onClick={() => navigate('playlists')}>{t('common.back')}</button>
        </div>
      </div>
    );
  }

  return (
    <div class="container-xl">
      {toast && (
        <div class={`alert alert-${toast.type} toast-notification position-fixed top-0 end-0 m-3`}>
          {toast.message}
        </div>
      )}

      {smartKey ? (
        /* ── Smart playlist detail (read-only) ───────────────────────── */
        !smart ? (
          <div class="text-center py-5"><div class="spinner-border text-primary"></div></div>
        ) : (
          <>
            <div class="page-header d-print-none mb-3">
              <div class="row align-items-center">
                <div class="col-auto">
                  <button class="btn btn-outline-secondary" onClick={() => navigate('playlists')}>
                    <ArrowLeft size={16} class="me-1" />{t('playlists.backToList')}
                  </button>
                </div>
                <div class="col">
                  <h2 class="page-title">
                    {(() => { const Icon = SMART_ICONS[smartKey] || ListMusic; return <Icon size={22} class="me-2" />; })()}
                    {t('playlists.smart.' + smartKey)}
                  </h2>
                  <div class="text-muted">{t('playlists.trackCount', { n: String(smart.tracks.length) })}</div>
                </div>
                <div class="col-auto d-flex gap-2">
                  {smartKey === 'dynamic_mix' && (
                    <button class="btn btn-outline-secondary" onClick={handleRefreshMix} disabled={mixBusy}>
                      <RefreshCw size={16} class={`me-1${mixBusy ? ' icon-spin' : ''}`} />{t('playlists.mixRefresh')}
                    </button>
                  )}
                  {smartPlayable.length > 0 && (
                    <button class="btn btn-primary" onClick={handlePlaySmart}>
                      <Play size={16} class="me-1" />{t('playlists.listen')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {smart.tracks.length === 0 ? (
              <div class="card">
                <div class="card-body text-center text-muted py-5">
                  <ListMusic size={48} class="mb-2" />
                  <div>{t('playlists.noPlayableTracks')}</div>
                </div>
              </div>
            ) : (
              <div class="card">
                <div class="table-responsive">
                  <table class="table table-sm card-table align-middle">
                    <thead>
                      <tr>
                        <th class="track-number-col">#</th>
                        <th>{t('albumDetail.trackTitle')}</th>
                        <th class="d-none d-md-table-cell">{t('playlists.artist')}</th>
                        <th class="d-none d-lg-table-cell">{t('playlists.album')}</th>
                        <th class="text-end">{t('albumDetail.duration')}</th>
                        <th class="text-end"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {smart.tracks.map((track, i) => (
                        <tr key={`${track.id}-${i}`} class={current?.id === track.id ? 'track-playing' : ''}>
                          <td class="text-muted">
                            {track.has_file ? (
                              <button
                                class="btn btn-sm btn-icon btn-ghost-secondary"
                                onClick={() => handlePlaySmartTrack(track, i)}
                                title={current?.id === track.id && playing ? t('player.pause') : t('player.playTrack')}
                              >
                                {current?.id === track.id && playing ? <Pause size={14} /> : <Play size={14} />}
                              </button>
                            ) : (
                              i + 1
                            )}
                          </td>
                          <td>{track.title}</td>
                          <td class="text-muted d-none d-md-table-cell">{track.artist_name}</td>
                          <td class="d-none d-lg-table-cell">
                            <button class="btn btn-link p-0 text-muted" onClick={() => navigate('detail', { id: track.album_id })}>
                              {track.album_title}
                            </button>
                          </td>
                          <td class="text-end text-muted font-monospace small">{track.duration || '—'}</td>
                          <td class="text-end text-nowrap">
                            <button
                              class={`btn btn-sm btn-icon ${track.is_favorite ? 'text-danger' : 'btn-ghost-secondary'}`}
                              onClick={() => handleToggleSmartFavorite(track)}
                              title={track.is_favorite ? t('player.unfavorite') : t('player.favorite')}
                            >
                              <Heart size={14} fill={track.is_favorite ? 'currentColor' : 'none'} />
                            </button>
                            {smartKey === 'dynamic_mix' && (
                              <button
                                class="btn btn-sm btn-icon btn-ghost-danger"
                                onClick={() => handleRemoveMixTrack(track)}
                                title={t('playlists.mixRemove')}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )
      ) : playlistId ? (
        /* ── Detail view ─────────────────────────────────────────────── */
        !playlist ? (
          <div class="text-center py-5"><div class="spinner-border text-primary"></div></div>
        ) : (
          <>
            <div class="page-header d-print-none mb-3">
              <div class="row align-items-center">
                <div class="col-auto">
                  <button class="btn btn-outline-secondary" onClick={() => navigate('playlists')}>
                    <ArrowLeft size={16} class="me-1" />{t('playlists.backToList')}
                  </button>
                </div>
                <div class="col">
                  <h2 class="page-title"><ListMusic size={22} class="me-2" />{playlist.name}</h2>
                  <div class="text-muted">
                    {t('playlists.trackCount', { n: String(playlist.tracks.length) })}
                  </div>
                </div>
                <div class="col-auto d-flex gap-2">
                  {playableTracks.length > 0 && (
                    <button class="btn btn-primary" onClick={() => playTracks(playableTracks)}>
                      <Play size={16} class="me-1" />{t('playlists.play')}
                    </button>
                  )}
                  <button
                    class="btn btn-outline-secondary"
                    onClick={() => setNameModal({ mode: 'rename', id: playlist.id, value: playlist.name })}
                  >
                    <Pencil size={16} class="me-1" />{t('playlists.rename')}
                  </button>
                  <button class="btn btn-outline-danger" onClick={() => setDeleteTarget(playlist)}>
                    <Trash2 size={16} class="me-1" />{t('playlists.delete')}
                  </button>
                </div>
              </div>
            </div>

            {playlist.tracks.length === 0 ? (
              <div class="card">
                <div class="card-body text-center text-muted py-5">
                  <ListMusic size={48} class="mb-2" />
                  <div>{t('playlists.chooseOrCreate')}</div>
                </div>
              </div>
            ) : (
              <div class="card">
                <div class="table-responsive">
                  <table class="table table-sm card-table align-middle">
                    <thead>
                      <tr>
                        <th class="track-number-col">#</th>
                        <th>{t('albumDetail.trackTitle')}</th>
                        <th class="d-none d-md-table-cell">{t('playlists.artist')}</th>
                        <th class="d-none d-lg-table-cell">{t('playlists.album')}</th>
                        <th class="text-end">{t('albumDetail.duration')}</th>
                        <th class="text-end"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {playlist.tracks.map((track, i) => (
                        <tr key={track.entry_id} class={current?.id === track.id ? 'track-playing' : ''}>
                          <td class="text-muted">
                            {track.has_file ? (
                              <button
                                class="btn btn-sm btn-icon btn-ghost-secondary"
                                onClick={() => handlePlayTrack(track)}
                                title={current?.id === track.id && playing ? t('player.pause') : t('player.playTrack')}
                              >
                                {current?.id === track.id && playing ? <Pause size={14} /> : <Play size={14} />}
                              </button>
                            ) : (
                              track.position
                            )}
                          </td>
                          <td>{track.title}</td>
                          <td class="text-muted d-none d-md-table-cell">{track.artist_name}</td>
                          <td class="d-none d-lg-table-cell">
                            <button
                              class="btn btn-link p-0 text-muted"
                              onClick={() => navigate('detail', { id: track.album_id })}
                            >
                              {track.album_title}
                            </button>
                          </td>
                          <td class="text-end text-muted font-monospace small">{track.duration || '—'}</td>
                          <td class="text-end text-nowrap">
                            <button
                              class="btn btn-sm btn-icon btn-ghost-secondary"
                              onClick={() => handleMove(i, -1)}
                              disabled={i === 0}
                              title={t('playlists.reorderUp')}
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              class="btn btn-sm btn-icon btn-ghost-secondary"
                              onClick={() => handleMove(i, 1)}
                              disabled={i === playlist.tracks.length - 1}
                              title={t('playlists.reorderDown')}
                            >
                              <ChevronDown size={14} />
                            </button>
                            <button
                              class="btn btn-sm btn-icon btn-ghost-danger"
                              onClick={() => handleRemoveEntry(track.entry_id)}
                              title={t('playlists.remove')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )
      ) : (
        /* ── List view ───────────────────────────────────────────────── */
        <>
          <div class="page-header d-print-none mb-3">
            <div class="row align-items-center">
              <div class="col">
                <h2 class="page-title"><ListMusic size={22} class="me-2" />{t('playlists.title')}</h2>
              </div>
              <div class="col-auto">
                <button class="btn btn-primary" onClick={() => setNameModal({ mode: 'create', value: '' })}>
                  <Plus size={16} class="me-1" />{t('playlists.create')}
                </button>
              </div>
            </div>
          </div>

          {/* Smart playlists */}
          {smartPlaylists && smartPlaylists.length > 0 && (
            <div class="card mb-3">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0"><Sparkles size={18} class="me-2" />{t('playlists.smartTitle')}</h3>
              </div>
              <div class="list-group list-group-flush">
                {SMART_KEYS.map((key) => {
                  const meta = smartPlaylists.find((p) => p.key === key);
                  if (!meta) return null;
                  const Icon = SMART_ICONS[key] || ListMusic;
                  return (
                    <button
                      key={key}
                      type="button"
                      class="list-group-item list-group-item-action d-flex align-items-center gap-2"
                      onClick={() => navigate('playlists', { smart: key })}
                    >
                      <Icon size={16} class="text-muted flex-shrink-0" />
                      <span>{t('playlists.smart.' + key)}</span>
                      <span class="badge bg-secondary-lt ms-auto flex-shrink-0">
                        {t('playlists.trackCount', { n: String(meta.track_count) })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!playlists ? (
            <div class="text-center py-5"><div class="spinner-border text-primary"></div></div>
          ) : playlists.length === 0 ? (
            <div class="card">
              <div class="card-body text-center text-muted py-5">
                <ListMusic size={48} class="mb-3" />
                <h4 class="text-muted">{t('playlists.empty')}</h4>
                <p class="text-muted">{t('playlists.emptySubtitle')}</p>
                <button class="btn btn-primary" onClick={() => setNameModal({ mode: 'create', value: '' })}>
                  <Plus size={16} class="me-1" />{t('playlists.create')}
                </button>
              </div>
            </div>
          ) : (
            <div class="card">
              <div class="table-responsive">
                <table class="table table-hover card-table align-middle">
                  <thead>
                    <tr>
                      <th>{t('playlists.name')}</th>
                      <th>{t('playlists.tracks')}</th>
                      <th class="d-none d-md-table-cell"><Clock size={14} class="me-1" />{t('playlists.duration')}</th>
                      <th class="d-none d-lg-table-cell">{t('playlists.updatedAt')}</th>
                      <th class="text-end">{t('database.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playlists.map((p) => (
                      <tr key={p.id} class="cursor-pointer" onClick={() => navigate('playlists', { id: p.id })}>
                        <td class="fw-semibold"><ListMusic size={16} class="me-2 text-muted" />{p.name}</td>
                        <td class="text-muted">{t('playlists.trackCount', { n: String(p.track_count) })}</td>
                        <td class="text-muted d-none d-md-table-cell">{formatSeconds(p.total_duration_seconds)}</td>
                        <td class="text-muted d-none d-lg-table-cell">{fmtDate(p.updated_at)}</td>
                        <td class="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button
                            class="btn btn-sm btn-icon btn-ghost-secondary"
                            onClick={() => setNameModal({ mode: 'rename', id: p.id, value: p.name })}
                            title={t('playlists.rename')}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            class="btn btn-sm btn-icon btn-ghost-danger"
                            onClick={() => setDeleteTarget(p)}
                            title={t('playlists.delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create / rename modal */}
      {nameModal && (
        <div class="folder-picker-overlay" onClick={() => setNameModal(null)}>
          <div class="folder-picker-card" onClick={(e) => e.stopPropagation()}>
            <div class="folder-picker-header">
              <h5 class="mb-0">
                {nameModal.mode === 'create' ? t('playlists.createTitle') : t('playlists.renameTitle')}
              </h5>
              <button class="btn btn-icon btn-ghost-secondary" onClick={() => setNameModal(null)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveName}>
              <div class="folder-picker-body">
                <label class="form-label">{t('playlists.name')}</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder={t('playlists.namePlaceholder')}
                  value={nameModal.value}
                  onInput={(e) => setNameModal({ ...nameModal, value: e.currentTarget.value })}
                  autoFocus
                  required
                />
              </div>
              <div class="folder-picker-footer">
                <button type="button" class="btn btn-outline-secondary" onClick={() => setNameModal(null)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" class="btn btn-primary" disabled={!nameModal.value.trim()}>
                  <Check size={16} class="me-1" />{t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div class="folder-picker-overlay" onClick={() => setDeleteTarget(null)}>
          <div class="folder-picker-card" onClick={(e) => e.stopPropagation()}>
            <div class="folder-picker-header">
              <h5 class="mb-0">{t('playlists.delete')}</h5>
              <button class="btn btn-icon btn-ghost-secondary" onClick={() => setDeleteTarget(null)}>
                <X size={18} />
              </button>
            </div>
            <div class="folder-picker-body">
              <p class="mb-0 text-muted">
                {t('playlists.confirmDelete')} <strong>« {deleteTarget.name} »</strong> ?
              </p>
            </div>
            <div class="folder-picker-footer">
              <button class="btn btn-outline-secondary" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </button>
              <button class="btn btn-danger" onClick={handleDelete}>
                <Trash2 size={16} class="me-1" />{t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
