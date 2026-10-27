import { useEffect, useState } from 'preact/hooks';
import { Archive, RotateCcw, Trash2, Save } from 'lucide-preact';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

export function formatBytes(bytes) {
  if (!bytes) return '0 Ko';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

const dateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

// Settings card: when to back up the collections, where, how many to keep,
// and the list of backups (restore, delete). The server does the work.
export function BackupSettings({ notify }) {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'restore' | 'delete', name }

  const load = () => api.getBackups()
    .then((data) => {
      setInfo(data);
      setForm({ ...data.settings, dir: data.settings.dir === data.default_dir ? '' : data.settings.dir });
    })
    .catch(() => setInfo(false));

  useEffect(() => { load(); }, []);

  if (info === false) {
    return <p class="text-muted small mb-0">{t('backup.unavailable')}</p>;
  }
  if (!info || !form) return null;

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const run = async (action, success) => {
    setBusy(true);
    try {
      const result = await action();
      notify?.(typeof success === 'function' ? success(result) : success, 'success');
      await load();
    } catch (e) {
      notify?.(e.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => api.saveBackupSettings({ ...form, keep: Number(form.keep) }), t('backup.saved'));
  const now = () => run(() => api.createBackup(), t('backup.done'));
  const doConfirm = () => {
    const { kind, name } = confirm;
    setConfirm(null);
    if (kind === 'delete') return run(() => api.deleteBackup(name), t('backup.deleted'));
    return run(
      () => api.restoreBackup(name),
      (res) => t('backup.restored', { count: res.restored.length }),
    ).then(() => setTimeout(() => window.location.reload(), 1500));
  };

  return (
    <div>
      <p class="text-muted small mb-3">{t('backup.description')}</p>
      <div class="row g-3 mb-3">
        <div class="col-12 col-md-4">
          <label class="form-label" for="backup-frequency">{t('backup.frequency')}</label>
          <select id="backup-frequency" class="form-select" value={form.frequency}
            onChange={(e) => set('frequency', e.currentTarget.value)}>
            {['off', 'daily', 'weekly'].map(f => <option key={f} value={f}>{t(`backup.frequencies.${f}`)}</option>)}
          </select>
        </div>
        {form.frequency === 'weekly' && (
          <div class="col-6 col-md-3">
            <label class="form-label" for="backup-weekday">{t('backup.weekday')}</label>
            <select id="backup-weekday" class="form-select" value={form.weekday}
              onChange={(e) => set('weekday', Number(e.currentTarget.value))}>
              {WEEKDAYS.map(d => <option key={d} value={d}>{t(`backup.weekdays.${d}`)}</option>)}
            </select>
          </div>
        )}
        {form.frequency !== 'off' && (
          <>
            <div class="col-6 col-md-2">
              <label class="form-label" for="backup-time">{t('backup.time')}</label>
              <input id="backup-time" type="time" class="form-control" value={form.time}
                onInput={(e) => set('time', e.currentTarget.value)} />
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label" for="backup-keep">{t('backup.keep')}</label>
              <input id="backup-keep" type="number" min="1" max="60" class="form-control" value={form.keep}
                onInput={(e) => set('keep', e.currentTarget.value)} />
            </div>
          </>
        )}
        <div class="col-12">
          <label class="form-label" for="backup-dir">{t('backup.dir')}</label>
          <input id="backup-dir" type="text" class="form-control font-monospace" value={form.dir}
            placeholder={info.default_dir} onInput={(e) => set('dir', e.currentTarget.value)} />
          <div class="form-hint">{t('backup.dirHint')}</div>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-2 mb-3">
        <button type="button" class="btn btn-primary" disabled={busy} onClick={save}>
          <Save size={16} class="me-1" />{t('backup.save')}
        </button>
        <button type="button" class="btn btn-outline-primary" disabled={busy || info.running} onClick={now}>
          <Archive size={16} class="me-1" />{t('backup.now')}
        </button>
      </div>
      {info.next_at && (
        <p class="text-muted small">{t('backup.next', { date: dateTime(info.next_at) })}</p>
      )}

      {info.backups.length === 0 ? (
        <p class="text-muted small mb-0">{t('backup.none')}</p>
      ) : (
        <div class="table-responsive">
          <table class="table table-sm table-vcenter mb-0">
            <thead>
              <tr>
                <th>{t('backup.date')}</th>
                <th>{t('backup.contents')}</th>
                <th class="text-end">{t('backup.size')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {info.backups.map(b => (
                <tr key={b.name}>
                  <td class="text-nowrap">
                    {dateTime(b.created_at)}
                    {b.reason !== 'scheduled' && (
                      <span class="badge bg-secondary-lt ms-2">{t(`backup.reasons.${b.reason}`)}</span>
                    )}
                  </td>
                  <td class="small">{b.databases.map(d => d.name).join(', ')}</td>
                  <td class="text-end text-nowrap small">{formatBytes(b.size)}</td>
                  <td class="text-end text-nowrap">
                    <button type="button" class="btn btn-sm btn-ghost-primary" disabled={busy}
                      onClick={() => setConfirm({ kind: 'restore', name: b.name, created_at: b.created_at })}
                      title={t('backup.restore')} aria-label={t('backup.restore')}>
                      <RotateCcw size={16} />
                    </button>
                    <button type="button" class="btn btn-sm btn-ghost-danger" disabled={busy}
                      onClick={() => setConfirm({ kind: 'delete', name: b.name, created_at: b.created_at })}
                      title={t('backup.delete')} aria-label={t('backup.delete')}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <div class="alert alert-warning mt-3 mb-0" role="alertdialog">
          <p class="mb-2">
            {t(confirm.kind === 'restore' ? 'backup.confirmRestore' : 'backup.confirmDelete',
              { date: dateTime(confirm.created_at) })}
          </p>
          <div class="d-flex gap-2">
            <button type="button" class={`btn btn-sm ${confirm.kind === 'restore' ? 'btn-warning' : 'btn-danger'}`}
              onClick={doConfirm}>
              {t(confirm.kind === 'restore' ? 'backup.restore' : 'backup.delete')}
            </button>
            <button type="button" class="btn btn-sm btn-ghost-secondary" onClick={() => setConfirm(null)}>
              {t('backup.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
