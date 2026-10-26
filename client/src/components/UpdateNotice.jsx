import { useState, useEffect, useCallback } from 'preact/hooks';
import { CloudDownload, X, AlertCircle } from 'lucide-preact';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const SEEN_KEY = 'jewelbox-update-notified';
const COMMAND = 'docker compose pull && docker compose up -d';

// Waits for the container to come back with another version, then reloads.
async function waitForNewVersion(current, deadline) {
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const { version } = await api.getVersion();
      if (version && version !== current) return true;
    } catch { /* restarting */ }
  }
  return false;
}

// Menu link + one-time toast when a newer JewelBox release exists; the dialog
// shows its notes and, with Watchtower configured, updates in one click.
export function UpdateNotice() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [toast, setToast] = useState(false);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);

  const check = useCallback(() => api.getUpdate().then(setStatus).catch(() => {}), []);
  useEffect(() => {
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [check]);

  // Tell once per version, even across reloads.
  useEffect(() => {
    if (!status?.available) return;
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch { /* storage unavailable */ }
    if (seen === status.latest.version) return;
    try { localStorage.setItem(SEEN_KEY, status.latest.version); } catch { /* storage unavailable */ }
    setToast(true);
  }, [status]);

  if (!status?.available) return null;
  const version = status.latest.version;

  const update = async () => {
    setUpdating(true);
    setError(null);
    try {
      await api.applyUpdate();
      if (await waitForNewVersion(status.current, Date.now() + 5 * 60 * 1000)) {
        window.location.reload();
        return;
      }
      setError(t('update.timeout'));
    } catch (err) {
      setError(err.message);
    }
    setUpdating(false);
  };

  const showDialog = () => {
    setToast(false);
    setOpen(true);
  };

  const fixedTag = /^v?\d+\.\d+\.\d+/.test(status.image_tag ?? '');

  return (
    <>
      <li class="nav-item">
        <a
          class="nav-link text-primary fw-bold"
          href="#"
          onClick={(e) => { e.preventDefault(); showDialog(); }}
        >
          <CloudDownload size={20} class="me-2" />
          {t('update.available', { version })}
        </a>
      </li>

      {toast && (
        <div class="alert alert-info alert-dismissible toast-notification top-0 end-0 m-3" role="alert">
          <div class="d-flex align-items-start gap-2">
            <CloudDownload size={20} class="flex-shrink-0" />
            <div>
              <div class="fw-bold">{t('update.toastTitle', { version })}</div>
              <div>{t('update.toastBody', { current: status.current })}</div>
              <button class="btn btn-primary btn-sm mt-2" onClick={showDialog}>{t('update.see')}</button>
            </div>
          </div>
          <button type="button" class="btn-close" onClick={() => setToast(false)} aria-label={t('common.close')}></button>
        </div>
      )}

      {open && (
        <div class="folder-picker-overlay" onClick={() => !updating && setOpen(false)}>
          <div class="folder-picker-card" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div class="folder-picker-header">
              <h5 class="mb-0">{t('update.title', { version })}</h5>
              <button
                class="btn btn-icon btn-ghost-secondary"
                onClick={() => setOpen(false)}
                disabled={updating}
                title={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>

            <div class="folder-picker-body d-flex flex-column gap-3 px-4 py-3">
              <div class="text-muted">{t('update.current', { current: status.current })}</div>
              {updating && (
                <div class="alert alert-info p-2 d-flex align-items-center gap-2 mb-0">
                  <span class="spinner-border spinner-border-sm flex-shrink-0"></span>{t('update.updating')}
                </div>
              )}
              {error && (
                <div class="alert alert-danger p-2 d-flex align-items-center gap-2 mb-0">
                  <AlertCircle size={16} class="flex-shrink-0" />{error}
                </div>
              )}
              {!status.can_update && (
                <div class="alert alert-info p-2 mb-0">
                  {fixedTag ? (
                    t('update.fixedTag', { tag: status.image_tag })
                  ) : (
                    <>
                      <div>{t('update.manual')}</div>
                      <code class="d-block my-1 user-select-all">{COMMAND}</code>
                      <div>{t('update.enableWatchtower')}</div>
                    </>
                  )}
                </div>
              )}
              {status.latest.notes && (
                <div class="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {status.latest.notes}
                </div>
              )}
            </div>

            <div class="folder-picker-footer d-flex justify-content-end gap-2">
              <a class="btn" href={status.latest.url} target="_blank" rel="noopener">{t('update.seeOnGithub')}</a>
              {status.can_update && (
                <button class="btn btn-primary" onClick={update} disabled={updating}>
                  {updating
                    ? <span class="spinner-border spinner-border-sm me-2"></span>
                    : <CloudDownload size={16} class="me-2" />}
                  {t('update.updateNow')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
