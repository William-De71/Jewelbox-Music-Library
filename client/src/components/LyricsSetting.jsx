import { useEffect, useState } from 'preact/hooks';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';

// Settings switch: may the server look the lyrics up on LRCLIB.
export function LyricsSetting({ notify }) {
  const { t } = useI18n();
  const [online, setOnline] = useState(null);

  useEffect(() => {
    api.getLyricsSettings().then(s => setOnline(s.online)).catch(() => setOnline(false));
  }, []);

  if (online === null) return null;

  const change = (value) => {
    setOnline(value);
    api.saveLyricsSettings(value).catch((e) => {
      setOnline(!value);
      notify?.(e.message, 'danger');
    });
  };

  return (
    <>
      <p class="text-muted small mb-3">{t('lyrics.settingDescription')}</p>
      <label class="form-check form-switch mb-0">
        <input class="form-check-input" type="checkbox" checked={online}
          onChange={(e) => change(e.currentTarget.checked)} />
        <span class="form-check-label">{t('lyrics.settingLabel')}</span>
      </label>
    </>
  );
}
