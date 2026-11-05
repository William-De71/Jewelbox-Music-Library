import { useState, useEffect } from 'preact/hooks';
import { useI18n } from '../config/i18n/index.jsx';
import { api } from '../api/client.js';
import { checkForUpdate } from '../components/UpdateNotice.jsx';
import { Info, Heart, RefreshCw } from 'lucide-preact';
import '../styles/version.css';

// Looks for a new release now. When there is one, UpdateNotice opens its dialog.
function UpdateCheck() {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState(null);

  const check = async () => {
    setChecking(true);
    setMessage(null);
    try {
      const status = await checkForUpdate();
      if (status.error) setMessage(t('update.checkFailed', { error: status.error }));
      else if (!status.available) setMessage(t('update.upToDate', { current: status.current }));
    } catch (err) {
      setMessage(t('update.checkFailed', { error: err.message }));
    }
    setChecking(false);
  };

  return (
    <div class="text-center mb-4">
      <button type="button" class="btn btn-outline-primary" disabled={checking} onClick={check}>
        {checking
          ? <span class="spinner-border spinner-border-sm me-2"></span>
          : <RefreshCw size={16} class="me-2" />}
        {t('update.check')}
      </button>
      {message && <p class="text-muted small mt-2 mb-0" role="status">{message}</p>}
    </div>
  );
}

export function About() {
  const { t } = useI18n();
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getVersion()
      .then(data => {
        setVersion(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch version:', err);
        setLoading(false);
      });
  }, []);

  return (
    <div class="container py-4">
      <div class="card">
            <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <h2 class="card-title d-flex align-items-center gap-2 mb-0">
                <Info size={24} />
                {t('about.title')}
              </h2>
              <a 
                href="https://github.com/William-De71/jewelbox-music-library" 
                target="_blank" 
                rel="noopener"
                class="btn btn-dark btn-sm"
                title={t('about.githubTitle')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </a>
            </div>
            <div class="card-body">
              {/* Logo et description */}
              <div class="text-center mb-4">
                <img 
                  src="/icons/icon-192.png" 
                  width="96" 
                  height="96" 
                  alt="JewelBox" 
                  style={{ borderRadius: '16px' }}
                  class="mb-3"
                />
                <div class="d-flex align-items-center justify-content-center gap-2 mb-2">
                  <h3 class="mb-0">{t('about.appName')}</h3>
                  {loading ? null : version ? (
                    <span class="version-badge">v{version.version}</span>
                  ) : null}
                </div>
                <p class="text-muted mb-0">
                  <em>{t('about.subtitle')}</em>
                </p>
              </div>

              <UpdateCheck />

              {/* Crédits */}
              <div class="text-center">
                <p class="mb-0">
                  {t('about.credits')} <Heart size={14} class="text-danger" style={{ display: 'inline' }} /> {t('about.by')}{' '}
                  <a href="https://github.com/William-De71" target="_blank" rel="noopener">William-De71</a>
                </p>
              </div>
            </div>
          </div>
    </div>
  );
}
