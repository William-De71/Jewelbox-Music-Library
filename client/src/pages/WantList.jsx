import { useState, useEffect, useRef } from 'preact/hooks';
import { albumsApi } from '../api/albums.js';
import { api } from '../api/client.js';
import { AlbumCard } from '../components/AlbumCard.jsx';
import { AlbumRow } from '../components/AlbumRow.jsx';
import { AlbumRowMobile } from '../components/AlbumRowMobile.jsx';
import { Pagination } from '../components/Pagination.jsx';
import { useI18n } from '../config/i18n/index.jsx';
import { Search, Grid, List, X, Plus, Heart, Database, Music, CheckCheck, Settings } from 'lucide-preact';

const DEFAULT_LIMIT = 24;

export function WantList({ navigate, params = {} }) {
  const { t } = useI18n();
  const [albums, setAlbums] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeDatabase, setActiveDatabase] = useState(null);
  const [dbCheckComplete, setDbCheckComplete] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('jewelbox-wantlist-viewMode') || 'grid');
const [isMobile, setIsMobile] = useState(() => window.innerWidth < 576);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(() => {
    const saved = localStorage.getItem('jewelbox-wantlist-limit');
    return saved ? Number(saved) : DEFAULT_LIMIT;
  });
  const [filters, setFilters] = useState(() => {
    const savedSort = localStorage.getItem('jewelbox-wantlist-sort') || 'artist';
    const savedOrder = localStorage.getItem('jewelbox-wantlist-order') || 'asc';
    return { genre: '', rating: '', search: '', sort: savedSort, order: savedOrder };
  });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [acquireTarget, setAcquireTarget] = useState(null);
  const [toast, setToast] = useState(params.successMessage ? { msg: params.successMessage, type: 'success' } : null);
  const searchRef = useRef();

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Listen for window resize to detect mobile
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 576);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Effective view mode: force list on mobile
  const effectiveViewMode = isMobile ? 'list' : viewMode;

  useEffect(() => {
    const loadData = async () => {
      try {
        const dbData = await albumsApi.getActiveDatabase().catch(() => null);
        setActiveDatabase(dbData?.database || null);
      } catch (e) {
        console.error('Failed to load initial data:', e);
      } finally {
        setDbCheckComplete(true);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    const loadAlbums = async () => {
      if (!activeDatabase) return;
      setLoading(true);
      try {
        const result = await albumsApi.getAll({ page, limit, ...filters, wanted: 'true' });
        setAlbums(result.data);
        setTotal(result.pagination.total);
      } catch (e) {
        showToast(e.message, 'danger');
      } finally {
        setLoading(false);
      }
    };
    loadAlbums();
  }, [page, limit, filters, activeDatabase]);

  useEffect(() => { localStorage.setItem('jewelbox-wantlist-limit', limit); }, [limit]);
  useEffect(() => { localStorage.setItem('jewelbox-wantlist-viewMode', viewMode); }, [viewMode]);
  useEffect(() => {
    localStorage.setItem('jewelbox-wantlist-sort', filters.sort);
    localStorage.setItem('jewelbox-wantlist-order', filters.order);
  }, [filters.sort, filters.order]);

  const setFilter = (key, value) => { setFilters(prev => ({ ...prev, [key]: value })); setPage(1); };
  const handleLimitChange = (v) => { setLimit(Number(v)); setPage(1); };
  const handleSearch = (e) => { if (e.key === 'Enter' || e.type === 'click') setFilter('search', searchRef.current.value); };
  const handleClearSearch = () => { searchRef.current.value = ''; setFilter('search', ''); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteAlbum(deleteTarget.id);
      setAlbums(prev => prev.filter(a => a.id !== deleteTarget.id));
      setTotal(prev => prev - 1);
      showToast(t('messages.albumDeleted').replace('{title}', deleteTarget.title), 'success');
    } catch (e) {
      showToast(e.message, 'danger');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleAcquire = async () => {
    if (!acquireTarget) return;
    try {
      await albumsApi.update(acquireTarget.id, { is_wanted: false });
      setAlbums(prev => prev.filter(a => a.id !== acquireTarget.id));
      setTotal(prev => prev - 1);
      showToast(t('wantlist.acquired').replace('{title}', acquireTarget.title), 'success');
    } catch (e) {
      showToast(e.message, 'danger');
    } finally {
      setAcquireTarget(null);
    }
  };

  const handleRate = async (album, rating) => {
    try {
      const updated = await albumsApi.update(album.id, { rating });
      setAlbums(prev => prev.map(a => a.id === album.id ? { ...a, rating: updated.rating } : a));
    } catch (e) {
      showToast(e.message, 'danger');
    }
  };

  if (!dbCheckComplete) {
    return null;
  }

  if (!activeDatabase) {
    return (
      <div class="page-container">
        {toast && (
          <div class={`alert alert-${toast.type} alert-dismissible toast-notification top-0 end-0 m-3`}>
            {toast.msg}
            <button type="button" class="btn-close" onClick={() => setToast(null)}></button>
          </div>
        )}
        <div class="container-fluid">
          <div class="row">
            <div class="col-12">
              <div class="card">
                <div class="card-header">
                  <h2 class="card-title">
                    <Heart size={24} class="me-2 text-danger" />
                    {t('menu.wantlist')}
                  </h2>
                </div>
                <div class="card-body text-center py-5">
                  <Database size={48} class="text-muted mb-3" />
                  <p class="text-muted mb-3">{t('home.noActiveDatabase')}</p>
                  <button class="btn btn-primary" onClick={() => navigate('settings')}>
                    <Settings size={16} class="me-2" />
                    {t('home.goToSettings')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="page-container">
      {toast && (
        <div class={`alert alert-${toast.type} alert-dismissible toast-notification top-0 end-0 m-3`}>
          {toast.msg}
          <button type="button" class="btn-close" onClick={() => setToast(null)}></button>
        </div>
      )}

      <div class="container-fluid">
        <div class="row">
          <div class="col-12">
            <div class="card">
              <div class="card-header d-flex justify-content-between align-items-center">
                <h2 class="card-title mb-0">
                  <Heart size={24} class="me-2 text-danger" />
                  {t('menu.wantlist')}
                </h2>
                <button class="btn btn-danger btn-sm" onClick={() => navigate('add', { fromWantList: true, returnPage: page })}>
                  <Plus size={16} class="me-1" />
                  {t('wantlist.addToWishlist')}
                </button>
              </div>
              <div class="card-body">
                {loading && (
                  <div class="text-center py-5">
                    <div class="spinner-border" role="status"></div>
                  </div>
                )}

                {!loading && (
                  <>
                    {/* Top controls */}
                    <div class="row g-2 align-items-center mb-4">
                      <div class="col-12 col-sm-6 col-md-3">
                        <div class="d-flex align-items-center gap-2">
                          <span class="text-muted me-2">{t('dashboard.pagination.itemsPerPage')}</span>
                          <select class="form-select form-select-sm" style="width: auto;" value={limit} onChange={(e) => handleLimitChange(e.target.value)}>
                            <option value="12">12</option>
                            <option value="24">24</option>
                            <option value="48">48</option>
                            <option value="96">96</option>
                            <option value="999999">{t('common.all')}</option>
                          </select>
                        </div>
                      </div>
                      <div class="col-12 col-md-5">
                        <div class="input-group">
                          <input
                            type="text"
                            class="form-control"
                            placeholder={t('dashboard.searchPlaceholder')}
                            ref={searchRef}
                            value={filters.search || ''}
                            onKeyPress={handleSearch}
                            onChange={(e) => searchRef.current.value = e.target.value}
                          />
                          <button class="btn btn-outline-secondary" type="button" onClick={handleSearch}>
                            <Search size={16} />
                          </button>
                          {filters.search && (
                            <button class="btn btn-outline-secondary text-danger" type="button" onClick={handleClearSearch}>
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div class="col-12 col-sm-6 col-md-2">
                        <select class="form-select" value={`${filters.sort}_${filters.order}`} onChange={(e) => {
                          const [sort, order] = e.target.value.split('_');
                          setFilters(prev => ({ ...prev, sort, order }));
                        }}>
                          <option value="title_asc">{t('filters.sortTitleAsc')}</option>
                          <option value="title_desc">{t('filters.sortTitleDesc')}</option>
                          <option value="artist_asc">{t('filters.sortArtistAsc')}</option>
                          <option value="artist_desc">{t('filters.sortArtistDesc')}</option>
                        </select>
                      </div>
                      <div class="col-12 col-md-2 d-none d-sm-block">
                        <div class="btn-group w-100">
                          <button class={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setViewMode('grid')}>
                            <Grid size={16} class="me-1" />
                            {t('common.grid')}
                          </button>
                          <button class={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setViewMode('list')}>
                            <List size={16} class="me-1" />
                            {t('common.list')}
                          </button>
                        </div>
                      </div>
                    </div>

                    {albums.length > 0 ? (
                      <>
                        {effectiveViewMode === 'grid' && (
                          <div class="row row-cards">
                            {albums.map(album => (
                              <div class="col-6 col-sm-4 col-md-3 col-lg-2 album-grid-item" key={album.id}>
                                <AlbumCard
                                  album={album}
                                  onClick={(a) => navigate('detail', { id: a.id })}
                                  onEdit={(a) => navigate('edit', { id: a.id })}
                                  onDelete={(a) => setDeleteTarget(a)}
                                  onAcquire={(a) => setAcquireTarget(a)}
                                  onRate={handleRate}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {effectiveViewMode === 'list' && (
                          <>
                            {/* Mobile list view - Dashboard style */}
                            {isMobile && (
                              <div class="card">
                                <div class="list-group list-group-flush">
                                  {albums.map(album => (
                                    <AlbumRowMobile
                                      key={album.id}
                                      album={album}
                                      onClick={(a) => navigate('detail', { id: a.id })}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Desktop table view */}
                            {!isMobile && (
                              <div class="card">
                                <div class="table-responsive">
                                  <table class="table table-vcenter card-table">
                                    <thead>
                                      <tr>
                                        <th class="d-none d-sm-table-cell">{t('table.cover')}</th>
                                        <th>{t('table.title')}</th>
                                        <th>{t('table.artist')}</th>
                                        <th class="d-none d-lg-table-cell">{t('table.year')}</th>
                                        <th class="d-none d-lg-table-cell">{t('table.genre')}</th>
                                        <th class="d-none d-md-table-cell">{t('table.rating')}</th>
                                        <th class="d-none d-md-table-cell">{t('table.label')}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {albums.map(album => (
                                        <AlbumRow
                                          key={album.id}
                                          album={album}
                                          onClick={(a) => navigate('detail', { id: a.id })}
                                          onEdit={(a) => navigate('edit', { id: a.id })}
                                          onDelete={(a) => setDeleteTarget(a)}
                                          onAcquire={(a) => setAcquireTarget(a)}
                                          onRate={handleRate}
                                        />
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        <div class="mt-4 d-flex justify-content-between align-items-center">
                          <div class="text-muted">
                            {t('dashboard.pagination.showing', { start: (page - 1) * limit + 1, end: Math.min(page * limit, total), total })}
                          </div>
                          <Pagination page={page} limit={limit} total={total} onChange={setPage} />
                        </div>
                      </>
                    ) : (
                      <div class="empty">
                        <div class="empty-img">
                          {!filters.search ? <Heart size={48} class="text-muted mb-3" /> : <Search size={48} class="text-muted mb-3" />}
                        </div>
                        <p class="empty-title">
                          {!filters.search ? t('wantlist.empty') : t('dashboard.search.noResults')}
                        </p>
                        <p class="empty-subtitle text-muted">
                          {!filters.search ? t('wantlist.emptySubtitle') : t('dashboard.search.noResultsMessage', { query: filters.search })}
                        </p>
                        {!filters.search && (
                          <div class="mt-3">
                            <button class="btn btn-danger" onClick={() => navigate('add', { fromWantList: true, returnPage: page })}>
                              <Plus size={16} class="me-1" />
                              {t('wantlist.addToWishlist')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete modal */}
      {deleteTarget && (
        <div class="modal modal-blur show d-block modal-backdrop-dark">
          <div class="modal-dialog modal-sm modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-body">
                <div class="modal-title">{t('modals.deleteTitle')}</div>
                <div>{t('modals.deleteMessage', { title: deleteTarget.title })}</div>
              </div>
              <div class="modal-footer">
                <button class="btn me-auto" onClick={() => setDeleteTarget(null)}>{t('modals.cancel')}</button>
                <button class="btn btn-danger" onClick={handleDelete}>{t('card.delete')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Acquire modal */}
      {acquireTarget && (
        <div class="modal modal-blur show d-block modal-backdrop-dark">
          <div class="modal-dialog modal-sm modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-body">
                <div class="modal-title">
                  <CheckCheck size={18} class="me-2 text-success" />
                  {t('wantlist.acquireTitle')}
                </div>
                <div>{t('wantlist.acquireMessage').replace('{title}', acquireTarget.title)}</div>
              </div>
              <div class="modal-footer">
                <button class="btn me-auto" onClick={() => setAcquireTarget(null)}>{t('modals.cancel')}</button>
                <button class="btn btn-success" onClick={handleAcquire}>{t('wantlist.acquireConfirm')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
