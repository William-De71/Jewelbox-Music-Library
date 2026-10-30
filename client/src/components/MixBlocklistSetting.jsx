import { useEffect, useState } from 'preact/hooks';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';

// Settings card body: how many tracks the dynamic mix never draws ("never
// play again"), and a two-step button to empty that blocklist.
export function MixBlocklistSetting({ notify }) {
  const { t } = useI18n();
  const [count, setCount] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.dynamicMixBlocked().then(res => setCount(res.data.length)).catch(() => setCount(null));
  }, []);

  const clear = async () => {
    setBusy(true);
    try {
      await api.dynamicMixClearBlocked();
      setCount(0);
      notify?.(t('mixBlocklist.cleared'));
    } catch (e) {
      notify?.(e.message, 'danger');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <p class="text-muted small mb-3">{t('mixBlocklist.description')}</p>
      <p class="mb-3">
        {count === null
          ? t('mixBlocklist.unavailable')
          : count === 0
            ? t('mixBlocklist.none')
            : t(count === 1 ? 'mixBlocklist.count' : 'mixBlocklist.countPlural', { count })}
      </p>
      {confirming ? (
        <div class="d-flex gap-2 align-items-center flex-wrap">
          <span>{t('mixBlocklist.confirm')}</span>
          <button type="button" class="btn btn-danger btn-sm" onClick={clear} disabled={busy}>
            {t('mixBlocklist.clearConfirm')}
          </button>
          <button type="button" class="btn btn-sm" onClick={() => setConfirming(false)} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" class="btn btn-outline-danger btn-sm" onClick={() => setConfirming(true)} disabled={!count}>
          {t('mixBlocklist.clear')}
        </button>
      )}
    </>
  );
}
