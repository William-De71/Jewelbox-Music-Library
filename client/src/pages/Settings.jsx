import { useState, useEffect, useRef } from 'preact/hooks';
import { databasesApi } from '../api/databases.js';
import { useI18n } from '../config/i18n/index.jsx';
import { api } from '../api/client.js';
import { FolderPickerModal } from '../components/FolderPickerModal.jsx';
import { Database, Plus, Play, Trash2, Edit, Check, X, Settings as SettingsIcon, Disc, Key, ExternalLink, ShieldCheck, ShieldOff, Download, Upload, FileText, FolderSearch, Music, Radio } from 'lucide-preact';

export function Settings({ navigate }) {
  const { t } = useI18n();
  const [databases, setDatabases] = useState([]);
  const [activeDb, setActiveDb] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingDb, setEditingDb] = useState(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [toast, setToast] = useState(null);
  const [discogsForm, setDiscogsForm] = useState({ discogs_key: '', discogs_secret: '' });
  const [discogsSaving, setDiscogsSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [musicPath, setMusicPath] = useState('');
  const [musicPathSaving, setMusicPathSaving] = useState(false);
  const [browsingLibrary, setBrowsingLibrary] = useState(false);
  const [lastfmStatus, setLastfmStatus] = useState({ connected: false, username: '', available: false });
  const [scanStatus, setScanStatus] = useState(null);
  const [scanning, setScanning] = useState(false);
  const scanTimer = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadDatabases = async () => {
    try {
      setLoading(true);
      const data = await databasesApi.getAll();
      setDatabases(data.databases);
      setActiveDb(data.active);
    } catch (err) {
      showToast(t('database.error.loadDatabases'), 'danger');
      console.error('Error loading databases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDatabases();
    api.getSettings().then(s => {
      setDiscogsForm({ discogs_key: s.discogs_key || '', discogs_secret: s.discogs_secret || '' });
      setMusicPath(s.music_library_path || '');
      setLastfmStatus({
        connected: Boolean(s.lastfm_connected),
        username: s.lastfm_username || '',
        available: Boolean(s.lastfm_available),
      });
    }).catch(() => {});
    if (new URLSearchParams(window.location.search).get('lastfm') === 'error') {
      showToast(t('lastfm.connectError'), 'danger');
      window.history.replaceState({}, '', '/settings');
    }
    // Resume status polling if a scan is already running server-side
    api.playerScanStatus().then(status => {
      setScanStatus(status);
      if (status.running) startScanPolling();
    }).catch(() => {});
    return () => clearInterval(scanTimer.current);
  }, []);

  const startScanPolling = () => {
    setScanning(true);
    clearInterval(scanTimer.current);
    scanTimer.current = setInterval(async () => {
      try {
        const status = await api.playerScanStatus();
        setScanStatus(status);
        if (!status.running && status.finishedAt) {
          clearInterval(scanTimer.current);
          setScanning(false);
          if (status.result) {
            showToast(t('musicLibrary.scanDone', {
              tracks: String(status.result.matched_tracks),
              albums: String(status.result.matched_albums),
              unmatched: String(status.result.unmatched_count),
            }), 'success');
          }
        }
      } catch {
        clearInterval(scanTimer.current);
        setScanning(false);
      }
    }, 1000);
  };

  const handleSaveMusicPath = async (e) => {
    e.preventDefault();
    setMusicPathSaving(true);
    try {
      await api.saveSettings({ music_library_path: musicPath.trim() });
      showToast(t('musicLibrary.saved'), 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setMusicPathSaving(false);
    }
  };

  const handleScan = async () => {
    try {
      await api.playerScan();
      setScanStatus(null);
      startScanPolling();
    } catch (err) {
      if (err.message.includes('already running')) showToast(t('musicLibrary.scanAlreadyRunning'), 'warning');
      else if (err.message.includes('not configured')) showToast(t('musicLibrary.pathNotConfigured'), 'danger');
      else showToast(err.message, 'danger');
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.importCSV(file);
      showToast(t('exportImport.importSuccess').replace('{n}', result.imported).replace('{s}', result.skipped), 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleSaveDiscogs = async (e) => {
    e.preventDefault();
    setDiscogsSaving(true);
    try {
      await api.saveSettings(discogsForm);
      showToast(t('discogs.saved'), 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setDiscogsSaving(false);
    }
  };

  const handleLastfmConnect = async () => {
    try {
      const { url } = await api.lastfmConnectUrl();
      window.location.href = url;
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleLastfmDisconnect = async () => {
    try {
      await api.lastfmDisconnect();
      setLastfmStatus(s => ({ ...s, connected: false, username: '' }));
      showToast(t('lastfm.disconnected'), 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleCreateDatabase = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    try {
      await databasesApi.create(formData.name.trim(), formData.description);
      showToast(t('database.success.databaseCreated'), 'success');
      setShowCreateForm(false);
      setFormData({ name: '', description: '' });
      loadDatabases();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleUpdateDatabase = async (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !editingDb) return;
    try {
      await databasesApi.update(editingDb.id, formData.name.trim(), formData.description);
      showToast(t('database.success.databaseUpdated'), 'success');
      setShowEditForm(false);
      setEditingDb(null);
      setFormData({ name: '', description: '' });
      loadDatabases();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleSetActive = async (dbId) => {
    try {
      await databasesApi.setActive(dbId);
      showToast(t('database.success.databaseActivated'), 'success');
      loadDatabases();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleDeleteDatabase = async () => {
    if (!deleteConfirmTarget) return;
    try {
      await databasesApi.delete(deleteConfirmTarget.id);
      showToast(t('database.success.databaseDeleted'), 'success');
      setDeleteConfirmTarget(null);
      loadDatabases();
    } catch (err) {
      showToast(err.message, 'danger');
      setDeleteConfirmTarget(null);
    }
  };

  const handleEditDatabase = (db) => {
    setEditingDb(db);
    setFormData({ name: db.name, description: db.description || '' });
    setShowEditForm(true);
  };

  const closeCreateForm = () => { setShowCreateForm(false); setFormData({ name: '', description: '' }); };
  const closeEditForm = () => { setShowEditForm(false); setEditingDb(null); setFormData({ name: '', description: '' }); };

  return (
    <div class="page-container">
      <div class="container-fluid">

        {/* Toast - fixed top right */}
        {toast && (
          <div class={`alert alert-${toast.type} alert-dismissible toast-notification top-0 end-0 m-3`}>
            {toast.msg}
            <button type="button" class="btn-close" onClick={() => setToast(null)} />
          </div>
        )}

        <div class="row">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">
                  <SettingsIcon size={24} class="me-2 text-secondary" />
                  {t('menu.settings')}
                </h2>
              </div>
              <div class="card-body">

                {/* Database list sub-header */}
                <div class="d-flex justify-content-between align-items-center mb-3">
                  <h3 class="mb-0 fs-5">
                    <Database size={18} class="me-2" />
                    {t('database.databaseList')}
                  </h3>
                  <button class="btn btn-primary btn-sm" onClick={() => setShowCreateForm(true)}>
                    <Plus size={16} class="me-1" />
                    {t('database.createDatabase')}
                  </button>
                </div>

                {/* Database table */}
                {loading ? (
                  <div class="text-center py-4">
                    <div class="spinner-border" role="status">
                      <span class="visually-hidden">{t('common.loading')}</span>
                    </div>
                  </div>
                ) : databases.length === 0 ? (
                  <div class="text-center py-4">
                    <Database size={48} class="text-muted mb-3" />
                    <h4 class="text-muted">{t('database.noDatabases')}</h4>
                    <p class="text-muted">{t('database.createFirstDatabase')}</p>
                    <button class="btn btn-primary" onClick={() => setShowCreateForm(true)}>
                      <Plus size={20} class="me-2" />
                      {t('database.createDatabase')}
                    </button>
                  </div>
                ) : (
                  <div class="table-responsive">
                    <table class="table table-hover align-middle">
                      <thead>
                        <tr>
                          <th>{t('database.name')}</th>
                          <th>{t('database.description')}</th>
                          <th>{t('database.createdAt')}</th>
                          <th>{t('database.status')}</th>
                          <th class="text-end">{t('database.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {databases.map(db => (
                          <tr key={db.id}>
                            <td>
                              <div class="d-flex align-items-center">
                                <Database size={18} class="me-2 text-muted" />
                                <strong>{db.name}</strong>
                              </div>
                            </td>
                            <td class="text-muted">{db.description || '—'}</td>
                            <td class="text-muted">{new Date(db.created_at).toLocaleDateString()}</td>
                            <td>
                              {db.is_active ? (
                                <span class="badge badge-pill bg-success-lt text-success" style={{ fontSize: '0.8rem', padding: '0.35em 0.75em' }}>
                                  <Check size={13} class="me-1" />
                                  {t('database.active')}
                                </span>
                              ) : (
                                <span class="badge badge-pill bg-secondary-lt text-muted" style={{ fontSize: '0.8rem', padding: '0.35em 0.75em' }}>
                                  {t('database.inactive')}
                                </span>
                              )}
                            </td>
                            <td class="text-end">
                              <div class="btn-group">
                                <button
                                  class="btn btn-sm btn-outline-success"
                                  onClick={() => handleSetActive(db.id)}
                                  title={t('database.activate')}
                                  disabled={db.is_active}
                                >
                                  <Play size={15} />
                                </button>
                                <button
                                  class="btn btn-sm btn-outline-primary"
                                  onClick={() => handleEditDatabase(db)}
                                  title={t('database.edit')}
                                >
                                  <Edit size={15} />
                                </button>
                                <button
                                  class="btn btn-sm btn-outline-danger"
                                  onClick={() => setDeleteConfirmTarget(db)}
                                  title={t('database.delete')}
                                >
                                  <Trash2 size={15} />
                                </button>
                                <button
                                  class="btn btn-sm btn-outline-info"
                                  onClick={() => navigate('collections')}
                                  title={t('database.viewCollection')}
                                  disabled={!db.is_active}
                                >
                                  <Disc size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>

        {/* Discogs API section */}
        <div class="row mt-4">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0">
                  <Key size={18} class="me-2" />
                  {t('discogs.title')}
                </h3>
              </div>
              <div class="card-body">
                <div class="alert alert-info mb-4" style={{ display: 'block', columns: 'unset', columnCount: 'unset' }}>
                  <p class="mb-1">{t('discogs.description')}</p>
                  <p class="mb-1 text-muted small">
                    <ExternalLink size={13} class="me-1" />
                    {t('discogs.howTo')}
                  </p>
                  <span class="badge bg-secondary-lt text-muted" style={{ whiteSpace: 'normal', textAlign: 'left' }}>{t('discogs.optional')}</span>
                </div>

                {(discogsForm.discogs_key && discogsForm.discogs_secret) ? (
                  <div class="mb-3 d-flex align-items-center gap-2">
                    <ShieldCheck size={16} class="text-success" />
                    <span class="text-success small fw-semibold">{t('discogs.authenticated')}</span>
                  </div>
                ) : (
                  <div class="mb-3 d-flex align-items-center gap-2">
                    <ShieldOff size={16} class="text-muted" />
                    <span class="text-muted small">{t('discogs.unauthenticated')}</span>
                  </div>
                )}

                <form onSubmit={handleSaveDiscogs}>
                  <div class="row g-3">
                    <div class="col-md-6">
                      <label class="form-label">{t('discogs.consumerKey')}</label>
                      <input
                        type="text"
                        class="form-control font-monospace"
                        placeholder={t('discogs.keyPlaceholder')}
                        value={discogsForm.discogs_key}
                        onInput={(e) => setDiscogsForm({ ...discogsForm, discogs_key: e.target.value })}
                        autocomplete="off"
                      />
                    </div>
                    <div class="col-md-6">
                      <label class="form-label">{t('discogs.consumerSecret')}</label>
                      <input
                        type="password"
                        class="form-control font-monospace"
                        placeholder={t('discogs.secretPlaceholder')}
                        value={discogsForm.discogs_secret}
                        onInput={(e) => setDiscogsForm({ ...discogsForm, discogs_secret: e.target.value })}
                        autocomplete="off"
                      />
                    </div>
                  </div>
                  <div class="mt-3">
                    <button type="submit" class="btn btn-primary" disabled={discogsSaving}>
                      {discogsSaving
                        ? <span class="spinner-border spinner-border-sm me-2" />
                        : <Check size={16} class="me-1" />}
                      {t('discogs.save')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Music library section */}
        <div class="row mt-4">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0">
                  <Music size={18} class="me-2" />
                  {t('musicLibrary.title')}
                </h3>
              </div>
              <div class="card-body">
                <p class="text-muted small mb-3">{t('musicLibrary.description')}</p>

                <form onSubmit={handleSaveMusicPath}>
                  <div class="row g-3 align-items-end">
                    <div class="col-md-8">
                      <label class="form-label">{t('musicLibrary.pathLabel')}</label>
                      <div class="input-group">
                        <input
                          type="text"
                          class="form-control font-monospace"
                          placeholder={t('musicLibrary.pathPlaceholder')}
                          value={musicPath}
                          onInput={(e) => setMusicPath(e.target.value)}
                          autocomplete="off"
                        />
                        <button
                          type="button"
                          class="btn btn-outline-secondary"
                          onClick={() => setBrowsingLibrary(true)}
                        >
                          <FolderSearch size={16} class="me-1" />{t('musicLibrary.browse')}
                        </button>
                      </div>
                    </div>
                    <div class="col-md-4 d-flex gap-2">
                      <button type="submit" class="btn btn-primary" disabled={musicPathSaving}>
                        {musicPathSaving
                          ? <span class="spinner-border spinner-border-sm me-2" />
                          : <Check size={16} class="me-1" />}
                        {t('musicLibrary.save')}
                      </button>
                      <button type="button" class="btn btn-outline-primary" onClick={handleScan} disabled={scanning || !musicPath.trim()}>
                        {scanning
                          ? <><span class="spinner-border spinner-border-sm me-2" />{t('musicLibrary.scanning')}</>
                          : <><FolderSearch size={16} class="me-1" />{t('musicLibrary.scan')}</>}
                      </button>
                    </div>
                  </div>
                </form>

                {scanning && scanStatus?.progress?.files_total > 0 && (
                  <div class="mt-3">
                    <div class="progress">
                      <div
                        class="progress-bar progress-bar-striped progress-bar-animated"
                        style={{ width: `${Math.round((scanStatus.progress.files_scanned / scanStatus.progress.files_total) * 100)}%` }}
                      />
                    </div>
                    <div class="text-muted small mt-1">
                      {scanStatus.progress.files_scanned} / {scanStatus.progress.files_total}
                    </div>
                  </div>
                )}

                {!scanning && scanStatus?.result && (
                  <div class="mt-3">
                    <div class="alert alert-info mb-2">
                      {t('musicLibrary.scanDone', {
                        tracks: String(scanStatus.result.matched_tracks),
                        albums: String(scanStatus.result.matched_albums),
                        unmatched: String(scanStatus.result.unmatched_count),
                      })}
                    </div>
                    {scanStatus.result.errors?.length > 0 && (
                      <div class="alert alert-warning mb-2">
                        <strong>{t('musicLibrary.scanErrors')} :</strong>
                        <ul class="mb-0 mt-1">
                          {scanStatus.result.errors.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                      </div>
                    )}
                    {scanStatus.result.unmatched_files?.length > 0 && (
                      <details class="text-muted small">
                        <summary class="cursor-pointer">
                          {t('musicLibrary.unmatchedFiles')} ({scanStatus.result.unmatched_count})
                        </summary>
                        <ul class="mt-2 font-monospace">
                          {scanStatus.result.unmatched_files.map((file, i) => <li key={i}>{file}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Last.fm section */}
        <div class="row mt-4">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0">
                  <Radio size={18} class="me-2" />
                  {t('lastfm.title')}
                </h3>
              </div>
              <div class="card-body">
                <p class="text-muted small mb-3">{t('lastfm.description')}</p>

                {!lastfmStatus.available ? (
                  <p class="text-muted small mb-0">{t('lastfm.unavailable')}</p>
                ) : (
                  <div class="d-flex flex-wrap align-items-center gap-2">
                    {lastfmStatus.connected ? (
                      <>
                        <span class="d-inline-flex align-items-center gap-1 text-success small fw-semibold">
                          <ShieldCheck size={16} />
                          {t('lastfm.connectedAs', { name: lastfmStatus.username })}
                        </span>
                        <button type="button" class="btn btn-outline-danger" onClick={handleLastfmDisconnect}>
                          <X size={16} class="me-1" />{t('lastfm.disconnect')}
                        </button>
                      </>
                    ) : (
                      <button type="button" class="btn btn-primary" onClick={handleLastfmConnect}>
                        <Radio size={16} class="me-1" />{t('lastfm.connect')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Export / Import section */}
        <div class="row mt-4">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0">
                  <FileText size={18} class="me-2" />
                  {t('exportImport.title')}
                </h3>
              </div>
              <div class="card-body">
                <div class="row g-4">
                  <div class="col-md-6">
                    <h5 class="fw-semibold mb-1">{t('exportImport.exportTitle')}</h5>
                    <p class="text-muted small mb-3">{t('exportImport.exportDesc')}</p>
                    <div class="d-flex gap-2">
                      <a href={api.exportCollection('csv')} download class="btn btn-outline-primary">
                        <Download size={16} class="me-1" />{t('exportImport.exportCsv')}
                      </a>
                      <a href={api.exportCollection('json')} download class="btn btn-outline-secondary">
                        <Download size={16} class="me-1" />{t('exportImport.exportJson')}
                      </a>
                    </div>
                  </div>
                  <div class="col-md-6">
                    <h5 class="fw-semibold mb-1">{t('exportImport.importTitle')}</h5>
                    <p class="text-muted small mb-3">{t('exportImport.importDesc')}</p>
                    <label class="btn btn-outline-success" style={{ cursor: 'pointer' }}>
                      {importing
                        ? <><span class="spinner-border spinner-border-sm me-2" />{t('exportImport.importing')}</>
                        : <><Upload size={16} class="me-1" />{t('exportImport.importBtn')}</>}
                      <input type="file" accept=".csv" class="d-none" onInput={handleImport} disabled={importing} />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create Database Modal */}
        {showCreateForm && (
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
            onClick={closeCreateForm}
          >
            <div
              style={{ backgroundColor: 'var(--tblr-bg-surface)', borderRadius: '8px', padding: 0, maxWidth: '460px', width: '90%', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '1.5rem' }}>
                <h5 style={{ margin: '0 0 1rem 0', fontWeight: 600 }}>
                  <Plus size={18} class="me-2" />
                  {t('database.createDatabase')}
                </h5>
                <form onSubmit={handleCreateDatabase}>
                  <div class="mb-3">
                    <label class="form-label">{t('database.name')} *</label>
                    <input type="text" class="form-control" value={formData.name} onInput={(e) => setFormData({ ...formData, name: e.target.value })} required autoFocus />
                  </div>
                  <div class="mb-3">
                    <label class="form-label">{t('database.description')}</label>
                    <textarea class="form-control" rows={3} value={formData.description} onInput={(e) => setFormData({ ...formData, description: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button type="button" class="btn btn-outline-secondary" onClick={closeCreateForm}>
                      <X size={16} class="me-1" />{t('common.cancel')}
                    </button>
                    <button type="submit" class="btn btn-primary">
                      <Plus size={16} class="me-1" />{t('database.create')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Edit Database Modal */}
        {showEditForm && editingDb && (
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
            onClick={closeEditForm}
          >
            <div
              style={{ backgroundColor: 'var(--tblr-bg-surface)', borderRadius: '8px', padding: 0, maxWidth: '460px', width: '90%', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '1.5rem' }}>
                <h5 style={{ margin: '0 0 1rem 0', fontWeight: 600 }}>
                  <Edit size={18} class="me-2" />
                  {t('database.editDatabase')}
                </h5>
                <form onSubmit={handleUpdateDatabase}>
                  <div class="mb-3">
                    <label class="form-label">{t('database.name')} *</label>
                    <input type="text" class="form-control" value={formData.name} onInput={(e) => setFormData({ ...formData, name: e.target.value })} required autoFocus />
                  </div>
                  <div class="mb-3">
                    <label class="form-label">{t('database.description')}</label>
                    <textarea class="form-control" rows={3} value={formData.description} onInput={(e) => setFormData({ ...formData, description: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button type="button" class="btn btn-outline-secondary" onClick={closeEditForm}>
                      <X size={16} class="me-1" />{t('common.cancel')}
                    </button>
                    <button type="submit" class="btn btn-primary">
                      <Check size={16} class="me-1" />{t('database.save')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirm Modal */}
        {deleteConfirmTarget && (
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
            onClick={() => setDeleteConfirmTarget(null)}
          >
            <div
              style={{ backgroundColor: 'var(--tblr-bg-surface)', borderRadius: '8px', padding: 0, maxWidth: '400px', width: '90%', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '1.5rem' }}>
                <h5 style={{ margin: '0 0 1rem 0', fontWeight: 600 }}>{t('database.delete')}</h5>
                <p style={{ margin: 0, color: 'var(--tblr-muted)' }}>
                  {t('database.confirm.deleteDatabase')} <strong>« {deleteConfirmTarget.name} »</strong>
                </p>
              </div>
              <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--tblr-border-color)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button class="btn btn-outline-secondary" onClick={() => setDeleteConfirmTarget(null)}>
                  <X size={16} class="me-1" />{t('common.cancel')}
                </button>
                <button class="btn btn-danger" onClick={handleDeleteDatabase}>
                  <Trash2 size={16} class="me-1" />{t('database.delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {browsingLibrary && (
          <FolderPickerModal
            browse={api.settingsBrowse}
            startDir={musicPath.trim()}
            title={t('musicLibrary.browseLibraryTitle')}
            hint={t('musicLibrary.browseHint')}
            onClose={() => setBrowsingLibrary(false)}
            onChoose={(dir) => {
              setMusicPath(dir);
              setBrowsingLibrary(false);
            }}
          />
        )}

      </div>
    </div>
  );
}
