import { useState, useEffect } from 'preact/hooks';
import { api } from '../api/client.js';
import { StarRating } from '../components/StarRating.jsx';
import { usePlayer, buildQueue } from '../components/PlayerContext.jsx';
import { FolderPickerModal } from '../components/FolderPickerModal.jsx';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal.jsx';
import { ArrowLeft, UserCheck, UserPlus, User, Pencil, Trash2, Disc, StickyNote, ListOrdered, Clock, Music2, AlertCircle, Info, Heart, History, Play, Pause, FolderSearch, FolderX, ListPlus, ListEnd, ListStart } from 'lucide-preact';
import { useI18n } from '../config/i18n/index.jsx';
import '../styles/AlbumDetail.css';

function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function AlbumDetail({ navigate, albumId }) {
  const { t } = useI18n();
  const { playAlbum, current, playing, toggle, toggleFavorite, addToQueue, playNext } = usePlayer();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lendModalOpen, setLendModalOpen] = useState(false);
  const [lentToInput, setLentToInput] = useState('');
  const [borrowers, setBorrowers] = useState([]);
  const [showBorrowerSuggestions, setShowBorrowerSuggestions] = useState(false);
  const [loanHistory, setLoanHistory] = useState([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [addToPlaylist, setAddToPlaylist] = useState(null); // { trackId } | { albumId }
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const playableTracks = album?.tracks?.filter((tr) => tr.has_file) || [];

  const handlePlayTrack = (track) => {
    if (current?.id === track.id) {
      toggle();
      return;
    }
    playAlbum(album, playableTracks.findIndex((tr) => tr.id === track.id));
  };

  const handleToggleFavorite = (track) => {
    const next = !track.is_favorite;
    // Optimistic local update; the context also syncs the player queue + calls the API
    setAlbum((a) => ({
      ...a,
      tracks: a.tracks.map((tr) => (tr.id === track.id ? { ...tr, is_favorite: next } : tr)),
    }));
    toggleFavorite(track.id, next);
  };

  const handleFolderAssociated = (result) => {
    setAlbum(result.album);
    setFolderPickerOpen(false);
    showToast(t('musicLibrary.folderAssociated', { matched: String(result.matched), total: String(result.total) }));
  };

  const handleDissociateFolder = async () => {
    try {
      const result = await api.clearAlbumAudioFolder(albumId);
      setAlbum(result.album);
      showToast(t('musicLibrary.folderDissociated'));
    } catch (e) {
      showToast(e.message, 'danger');
    }
  };

  useEffect(() => {
    api.getAlbum(albumId)
      .then(setAlbum)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api.getBorrowers().then(setBorrowers).catch(() => {});
    api.getLoanHistory(albumId).then(r => setLoanHistory(r.data || [])).catch(() => {});
  }, [albumId]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteAlbum(albumId);
      navigate(album?.is_wanted ? 'wantlist' : 'collections', { successMessage: t('albumDetail.deleteSuccess') });
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  const handleLend = () => {
    if (album.is_lent) {
      handleConfirmLend(false, null);
    } else {
      setLentToInput('');
      setLendModalOpen(true);
    }
  };

  const handleConfirmLend = async (isLent, name) => {
    try {
      const updated = await api.lendAlbum(albumId, isLent, name);
      setAlbum(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setLendModalOpen(false);
    }
  };

  if (loading) {
    return (
      <div class="text-center py-5">
        <div class="spinner-border text-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div class="alert alert-danger">
        <AlertCircle size={16} class="me-2" />{error}
        <button class="btn btn-link p-0 ms-2" onClick={() => navigate('dashboard')}>{t('common.back')}</button>
      </div>
    );
  }

  if (!album) return null;

  const totalDuration = album.tracks?.length
    ? album.total_duration || '—'
    : album.total_duration || '—';

  return (
    <div class="container-xl">
      <div class="page-header d-print-none mb-3">
        <div class="row align-items-center">
          <div class="col-auto">
            <button class="btn btn-outline-secondary" onClick={() => navigate(album?.is_wanted ? 'wantlist' : 'collections')}>
              <ArrowLeft size={16} class="me-1" />{t('common.back')}
            </button>
          </div>
          <div class="col">
            <h2 class="page-title">{album.title}</h2>
            <div class="text-muted">{album.artist?.name}</div>
          </div>
        </div>
      </div>

      <div class="row g-3">
        {/* Left column: cover & rating */}
        <div class="col-12 col-md-3">
          <div class="card h-100">
            <div class="card-body d-flex flex-column align-items-center gap-3">
              <div class="position-relative cover-preview">
                {album.cover_url ? (
                  <img
                    src={album.cover_url}
                    alt={album.title}
                    class="w-100 h-100 rounded object-fit-cover"
                    onError={(e) => {
                      e.target.src = '';
                      e.target.style.display = 'none';
                      const placeholder = e.target.parentElement.querySelector('.cover-placeholder');
                      if (placeholder) placeholder.style.display = 'flex';
                    }}
                  />
                ) : (
                  <div class="w-100 h-100 d-flex align-items-center justify-content-center bg-secondary-subtle rounded cover-placeholder">
                    <Disc size={48} class="text-muted" />
                  </div>
                )}
              </div>
              <div class="w-100 mt-3">
                <label class="form-label small mb-2">{t('albumDetail.rating')}</label>
                <StarRating value={album.rating} readOnly />
              </div>
            </div>
          </div>
        </div>

        {/* Right column: info & tracks */}
        <div class="col-12 col-md-9">
          {/* Info card */}
          <div class="card h-100">
            <div class="card-header">
              <h3 class="card-title"><Info size={18} class="me-2" />{t('albumDetail.info')}</h3>
            </div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-12 col-sm-8">
                  <label class="form-label">{t('albumDetail.title')}</label>
                  <div class="fw-semibold">{album.title}</div>
                </div>
                <div class="col-12 col-sm-4">
                  <label class="form-label">{t('albumDetail.year')}</label>
                  <div class="fw-semibold">{album.year || '—'}</div>
                </div>
                <div class="col-12 col-sm-6">
                  <label class="form-label">{t('albumDetail.artist')}</label>
                  <div class="fw-semibold">{album.artist?.name || '—'}</div>
                </div>
                <div class="col-12 col-sm-6">
                  <label class="form-label">{t('albumDetail.label')}</label>
                  <div class="fw-semibold">{album.label?.name || '—'}</div>
                </div>
                <div class="col-12 col-sm-4">
                  <label class="form-label">{t('albumDetail.genre')}</label>
                  <div>{album.genre ? <span class="badge bg-blue-lt">{album.genre}</span> : '—'}</div>
                </div>
                <div class="col-12 col-sm-4">
                  <label class="form-label">{t('albumDetail.totalDuration')}</label>
                  <div class="fw-semibold">{album.total_duration || '—'}</div>
                </div>
                <div class="col-12 col-sm-4">
                  <label class="form-label">{t('albumDetail.ean')}</label>
                  <div class="fw-semibold font-monospace small">{album.ean || '—'}</div>
                </div>
                {album.is_lent && (
                  <div class="col-12">
                    <div class="alert alert-warning p-2 mb-0 d-flex align-items-center gap-2">
                      <UserPlus size={16} class="flex-shrink-0" />
                      <strong>{t('albumDetail.lent')}</strong>
                      {album.lent_to && <strong>{album.lent_to}</strong>}
                      {album.lent_at && <span class="text-muted small">({fmt(album.lent_at)})</span>}
                    </div>
                  </div>
                )}
                {album.is_wanted && (
                  <div class="col-12">
                    <div class="alert alert-danger p-2 mb-0">
                      <Heart size={16} class="me-1" />
                      <strong>{t('albumDetail.wanted')}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Notes section - full width */}
      {album.notes && (
        <div class="row g-3 mt-0">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title"><StickyNote size={18} class="me-2" />{t('albumDetail.notes')}</h3>
              </div>
              <div class="card-body">
                <p class="mb-0 album-notes">{album.notes}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tracks section - full width */}
      <div class="row g-3 mt-0">
        <div class="col-12">
          {album.tracks && album.tracks.length > 0 ? (
            <div class="card">
              <div class="card-header d-flex align-items-center flex-wrap gap-2">
                <h3 class="card-title mb-0">
                  <ListOrdered size={18} class="me-2" />
                  {t('albumDetail.tracks')} ({album.tracks.length})
                </h3>
                <div class="ms-auto d-flex align-items-center gap-2">
                  {album.total_duration && (
                    <span class="text-muted small">
                      <Clock size={16} class="me-1" />{album.total_duration}
                    </span>
                  )}
                  {album.audio_folder ? (
                    <button
                      class="btn btn-sm btn-outline-secondary"
                      onClick={handleDissociateFolder}
                      title={`${t('musicLibrary.audioFolder')} : ${album.audio_folder}`}
                    >
                      <FolderX size={14} class="me-1" />{t('musicLibrary.dissociateFolder')}
                    </button>
                  ) : (
                    <button
                      class="btn btn-sm btn-outline-secondary"
                      onClick={() => setFolderPickerOpen(true)}
                      title={t('musicLibrary.browseTitle')}
                    >
                      <FolderSearch size={14} class="me-1" />{t('musicLibrary.associateFolder')}
                    </button>
                  )}
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    onClick={() => setAddToPlaylist({ albumId: album.id })}
                    title={t('playlists.addAlbumToPlaylist')}
                  >
                    <ListPlus size={14} class="me-1" />{t('playlists.addToPlaylist')}
                  </button>
                  {playableTracks.length > 0 && (
                    <>
                      <button
                        class="btn btn-sm btn-outline-secondary"
                        onClick={() => playNext(buildQueue(album))}
                        title={t('player.playNext')}
                      >
                        <ListStart size={14} class="me-1" />{t('player.playNext')}
                      </button>
                      <button
                        class="btn btn-sm btn-outline-secondary"
                        onClick={() => addToQueue(buildQueue(album))}
                        title={t('player.addToQueue')}
                      >
                        <ListEnd size={14} class="me-1" />{t('player.addToQueue')}
                      </button>
                      <button class="btn btn-sm btn-primary" onClick={() => playAlbum(album)}>
                        <Play size={14} class="me-1" />{t('player.playAlbum')}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div class="table-responsive">
                <table class="table table-sm card-table">
                  <thead>
                    <tr>
                      <th class="track-number-col">{t('albumDetail.trackNumber')}</th>
                      <th>{t('albumDetail.trackTitle')}</th>
                      <th class="track-detail-actions-col text-end">{t('albumDetail.duration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {album.tracks.map((track) => (
                      <tr key={track.id} class={current?.id === track.id ? 'track-playing' : ''}>
                        <td class="text-muted">
                          {track.has_file ? (
                            <button
                              class="btn btn-sm btn-icon btn-ghost-secondary track-play-btn"
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
                        <td class="text-end">
                          <div class="track-actions">
                            <span class="text-muted font-monospace small">{track.duration || '—'}</span>
                            <button
                              class={`btn btn-sm btn-icon ${track.is_favorite ? 'text-danger' : 'btn-ghost-secondary'}`}
                              onClick={() => handleToggleFavorite(track)}
                              title={track.is_favorite ? t('player.unfavorite') : t('player.favorite')}
                            >
                              <Heart size={14} fill={track.is_favorite ? 'currentColor' : 'none'} />
                            </button>
                            {track.has_file && (
                              <>
                                <button
                                  class="btn btn-sm btn-icon btn-ghost-secondary"
                                  onClick={() => playNext(buildQueue(album).filter(qt => qt.id === track.id))}
                                  title={t('player.playNext')}
                                  aria-label={t('player.playNext')}
                                >
                                  <ListStart size={14} />
                                </button>
                                <button
                                  class="btn btn-sm btn-icon btn-ghost-secondary"
                                  onClick={() => addToQueue(buildQueue(album).filter(qt => qt.id === track.id))}
                                  title={t('player.addToQueue')}
                                  aria-label={t('player.addToQueue')}
                                >
                                  <ListEnd size={14} />
                                </button>
                              </>
                            )}
                            <button
                              class="btn btn-sm btn-icon btn-ghost-secondary"
                              onClick={() => setAddToPlaylist({ trackId: track.id })}
                              title={t('playlists.addToPlaylist')}
                            >
                              <ListPlus size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div class="card">
              <div class="card-body text-center text-muted py-4">
                <Music2 size={48} class="mb-2" />
                <div class="mt-2">{t('albumDetail.noTracks')}</div>
                <button class="btn btn-sm btn-outline-primary mt-2" onClick={() => navigate('edit', { id: albumId })}>
                  <Pencil size={16} class="me-1" />{t('albumDetail.editAlbum')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Loan history section */}
      {loanHistory.length > 0 && (
        <div class="row g-3 mt-0">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title"><History size={18} class="me-2" />{t('lend.loanHistory')}</h3>
              </div>
              <div class="table-responsive">
                <table class="table table-sm card-table">
                  <thead>
                    <tr>
                      <th><User size={14} class="me-1" />{t('lend.borrower')}</th>
                      <th><Clock size={14} class="me-1" />{t('lend.lentSince')}</th>
                      <th>{t('lend.returnedOn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanHistory.map(h => (
                      <tr key={h.id}>
                        <td class="fw-semibold">{h.lent_to}</td>
                        <td class="text-muted">{fmt(h.lent_at)}</td>
                        <td>
                          {h.returned_at
                            ? <span class="text-success">{fmt(h.returned_at)}</span>
                            : <span class="badge bg-warning-lt text-warning">{t('lend.stillLent')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div class="d-flex gap-2 justify-content-end mt-3 mb-4">
        {!album.is_wanted && (
          <button
            class={`btn ${album.is_lent ? 'btn-success' : 'btn-warning'}`}
            onClick={handleLend}
            title={album.is_lent ? t('albumDetail.markReturned') : t('albumDetail.markLent')}
          >
            {album.is_lent ? <UserCheck size={16} class="me-1" /> : <UserPlus size={16} class="me-1" />}
            {album.is_lent ? t('albumDetail.returned') : t('common.lend')}
          </button>
        )}
        <button class="btn btn-primary" onClick={() => navigate('edit', { id: albumId })}>
          <Pencil size={16} class="me-1" />{t('albumDetail.edit')}
        </button>
        <button class="btn btn-danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={16} class="me-1" />{t('albumDetail.delete')}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div class={`alert alert-${toast.type} position-fixed top-0 end-0 m-3`} style={{ zIndex: 10000 }}>
          {toast.message}
        </div>
      )}

      {/* Add to playlist modal */}
      {addToPlaylist && (
        <AddToPlaylistModal
          trackId={addToPlaylist.trackId}
          albumId={addToPlaylist.albumId}
          onClose={() => setAddToPlaylist(null)}
          onAdded={(result) => {
            setAddToPlaylist(null);
            showToast(t('playlists.added', { n: String(result.added) }));
          }}
        />
      )}

      {/* Audio folder picker modal */}
      {folderPickerOpen && (
        <FolderPickerModal
          albumId={albumId}
          onClose={() => setFolderPickerOpen(false)}
          onAssociated={handleFolderAssociated}
        />
      )}

      {/* Lend modal */}
      {lendModalOpen && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={() => setLendModalOpen(false)}
        >
          <div
            style={{ backgroundColor: 'var(--tblr-bg-surface)', borderRadius: 8, padding: 0, maxWidth: 400, width: '90%', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '1.5rem 1.5rem 1rem' }}>
              <h5 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 600 }}>{t('modals.lendTitle')}</h5>
              <p class="mb-2 text-muted">{album.title}</p>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  class="form-control"
                  placeholder={t('modals.lendPlaceholder')}
                  value={lentToInput}
                  onInput={(e) => { setLentToInput(e.target.value); setShowBorrowerSuggestions(true); }}
                  onFocus={() => setShowBorrowerSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowBorrowerSuggestions(false), 150)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmLend(true, lentToInput || null)}
                  autoFocus
                />
                {showBorrowerSuggestions && borrowers.filter(n => n.toLowerCase().includes(lentToInput.toLowerCase())).length > 0 && (
                  <div class="dropdown-menu show w-100" style={{ top: '100%', left: 0, zIndex: 1100 }}>
                    {borrowers
                      .filter(n => n.toLowerCase().includes(lentToInput.toLowerCase()))
                      .map(name => (
                        <button key={name} type="button" class="dropdown-item d-flex align-items-center gap-2 py-2"
                          onMouseDown={() => { setLentToInput(name); setShowBorrowerSuggestions(false); }}>
                          <User size={14} class="text-muted flex-shrink-0" />
                          <span>{name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--tblr-border-color)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button class="btn btn-outline-secondary me-auto" onClick={() => setLendModalOpen(false)}>{t('modals.cancel')}</button>
              <button class="btn btn-warning" onClick={() => handleConfirmLend(true, lentToInput || null)}>
                <UserPlus size={15} class="me-1" />{t('modals.lendTitle')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={() => setConfirmDelete(false)}
        >
          <div 
            style={{
              backgroundColor: 'var(--tblr-bg-surface)',
              borderRadius: '8px',
              padding: '0',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '1.5rem' }}>
              <h5 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: 600 }}>
                {t('modals.deleteTitle')}
              </h5>
              <p style={{ margin: 0, color: 'var(--tblr-muted)' }}>
                {t('albumDetail.confirmDelete')} <strong>« {album.title} »</strong> ?
              </p>
            </div>
            <div style={{ 
              padding: '1rem 1.5rem', 
              borderTop: '1px solid var(--tblr-border-color)',
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'flex-end'
            }}>
              <button class="btn btn-outline-secondary" onClick={() => setConfirmDelete(false)}>
                {t('modals.cancel')}
              </button>
              <button class="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? <span class="spinner-border spinner-border-sm"></span> : <><Trash2 size={16} class="me-1" />{t('common.delete')}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
