import { useState, useEffect } from 'preact/hooks';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';
import { Folder, Music, X, ChevronRight, AlertCircle, CornerLeftUp } from 'lucide-preact';

// Two callers, two filesystems: album association browses inside the library
// (relative paths, api.playerBrowse), library selection browses the server's
// allowed roots (absolute paths, api.settingsBrowse). Both list the same shape,
// so `browse` and `onChoose` are injected and the rendering stays shared.
export function FolderPickerModal({
  albumId,
  onClose,
  onAssociated,
  browse = api.playerBrowse,
  onChoose,
  startDir = '',
  title,
  hint,
}) {
  const { t } = useI18n();
  const [dir, setDir] = useState(startDir);
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    browse(dir)
      .then(setListing)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dir]);

  const handleChoose = async () => {
    if (onChoose) return onChoose(dir);
    setSaving(true);
    setError(null);
    try {
      const result = await api.setAlbumAudioFolder(albumId, dir);
      onAssociated(result);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  // Absolute listings (library selection) navigate by the server-provided
  // parent; relative ones rebuild the trail from the path itself.
  const isAbsolute = dir.startsWith('/');
  const crumbs = !isAbsolute && dir ? dir.split('/') : [];

  return (
    <div class="folder-picker-overlay" onClick={onClose}>
      <div class="folder-picker-card" onClick={(e) => e.stopPropagation()}>
        <div class="folder-picker-header">
          <h5 class="mb-0">{title || t('musicLibrary.browseTitle')}</h5>
          <button class="btn btn-icon btn-ghost-secondary" onClick={onClose} title={t('musicLibrary.cancel')}>
            <X size={18} />
          </button>
        </div>

        <div class="folder-picker-breadcrumb">
          <button class="btn btn-link p-0" onClick={() => setDir('')}>{t('musicLibrary.rootFolder')}</button>
          {isAbsolute ? (
            <span class="d-inline-flex align-items-center">
              <ChevronRight size={14} class="text-muted mx-1" />
              <span class="font-monospace small text-truncate">{dir}</span>
            </span>
          ) : crumbs.map((part, i) => (
            <span key={i} class="d-inline-flex align-items-center">
              <ChevronRight size={14} class="text-muted mx-1" />
              <button class="btn btn-link p-0" onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>
                {part}
              </button>
            </span>
          ))}
        </div>

        <div class="folder-picker-body">
          {hint && <p class="text-muted small mb-2">{hint}</p>}
          {error && (
            <div class="alert alert-danger p-2 d-flex align-items-center gap-2 mb-2">
              <AlertCircle size={16} class="flex-shrink-0" />{error}
            </div>
          )}
          {loading ? (
            <div class="text-center py-4">
              <div class="spinner-border spinner-border-sm text-primary"></div>
            </div>
          ) : listing?.folders?.length || (isAbsolute && listing) ? (
            <div class="list-group list-group-flush">
              {isAbsolute && listing.parent !== null && listing.parent !== undefined && (
                <button
                  type="button"
                  class="list-group-item list-group-item-action d-flex align-items-center gap-2"
                  onClick={() => setDir(listing.parent)}
                >
                  <CornerLeftUp size={16} class="text-muted flex-shrink-0" />
                  <span class="text-truncate">{t('musicLibrary.parentFolder')}</span>
                </button>
              )}
              {listing.folders.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  class="list-group-item list-group-item-action d-flex align-items-center gap-2"
                  onClick={() => setDir(folder.path)}
                >
                  <Folder size={16} class="text-muted flex-shrink-0" />
                  <span class="text-truncate">{folder.name}</span>
                  {folder.audio_files > 0 && (
                    <span class="badge bg-blue-lt ms-auto flex-shrink-0">
                      <Music size={12} class="me-1" />
                      {t('musicLibrary.audioFileCount', { n: folder.audio_files })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            !error && <div class="text-center text-muted py-4">{t('musicLibrary.noSubfolders')}</div>
          )}
        </div>

        <div class="folder-picker-footer">
          {listing && dir && listing.audio_files > 0 && (
            <span class="text-muted small me-auto">
              <Music size={14} class="me-1" />
              {t('musicLibrary.audioFileCount', { n: listing.audio_files })}
            </span>
          )}
          <button class="btn btn-outline-secondary" onClick={onClose}>{t('musicLibrary.cancel')}</button>
          <button class="btn btn-primary" onClick={handleChoose} disabled={!dir || saving}>
            {saving ? <span class="spinner-border spinner-border-sm"></span> : t('musicLibrary.chooseFolder')}
          </button>
        </div>
      </div>
    </div>
  );
}
