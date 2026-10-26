import { useState, useEffect } from 'preact/hooks';
import { albumsApi } from '../api/albums.js';
import { isMac } from '../utils/searchShortcut.js';
import { useI18n } from '../config/i18n/index.jsx';
import { Home, Search, Music2, Shuffle, Clock, BarChart3, Settings, Plus, Heart, PenLine, Disc, User, Database } from 'lucide-preact';

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

export function Dashboard({ navigate }) {
  const { t } = useI18n();
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [recentWanted, setRecentWanted] = useState([]);
  const [randomAlbum, setRandomAlbum] = useState(null);
  const [lentAlbums, setLentAlbums] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalWanted, setTotalWanted] = useState(0);
  const [activeDb, setActiveDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbCheckComplete, setDbCheckComplete] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [quickSearch, setQuickSearch] = useState('');
  const [quickSource, setQuickSource] = useState('musicbrainz');

  const loadData = async () => {
    try {
      setLoading(true);
      const dbData = await albumsApi.getActiveDatabase().catch(() => null);
      const db = dbData?.database;
      setActiveDb(db);
      setDbCheckComplete(true);
      if (!db) return;

      const [recentData, recentWantedData, countData, countWantedData, lentData] = await Promise.all([
        albumsApi.getAll({ sort: 'created_at', order: 'desc', limit: 10, wanted: 'false' }),
        albumsApi.getAll({ sort: 'created_at', order: 'desc', limit: 10, wanted: 'true' }),
        albumsApi.getAll({ limit: 1, wanted: 'false' }),
        albumsApi.getAll({ limit: 1, wanted: 'true' }),
        albumsApi.getAll({ lent: 'true', limit: 50 }),
      ]);

      setRecentAlbums(recentData.data);
      setRecentWanted(recentWantedData.data);
      setTotal(countData.pagination.total);
      setTotalWanted(countWantedData.pagination.total);
      setLentAlbums(lentData.data);

      if (countData.pagination.total > 0) {
        const randomPage = Math.floor(Math.random() * countData.pagination.total) + 1;
        const randomData = await albumsApi.getAll({ limit: 1, page: randomPage, wanted: 'false' });
        setRandomAlbum(randomData.data[0] || null);
      }
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const shuffleRandom = async () => {
    if (total === 0) return;
    try {
      const randomPage = Math.floor(Math.random() * total) + 1;
      const res = await albumsApi.getAll({ limit: 1, page: randomPage });
      setRandomAlbum(res.data[0] || null);
    } catch (e) {
      console.error('Shuffle error:', e);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate('collections', { search: searchQuery.trim() });
    } else {
      navigate('collections');
    }
  };

  if (!dbCheckComplete) {
    return null;
  }

  if (!activeDb && !loading) {
    return (
      <div class="page-container">
        <div class="container-fluid">
          <div class="row">
            <div class="col-12">
              <div class="card">
                <div class="card-header">
                  <h2 class="card-title">
                    <Home size={24} class="me-2 text-primary" />
                    {t('common.home')}
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
      <div class="container-fluid">
        <div class="row">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">
                  <Home size={24} class="me-2 text-primary" />
                  {t('common.home')}
                </h2>
              </div>
              <div class="card-body">

                {/* Search bar */}
                <form onSubmit={handleSearch} class="mb-4">
                  <div class="input-group">
                    <span class="input-group-text bg-transparent">
                      <Search size={20} class="text-muted" />
                    </span>
                    <input
                      type="text"
                      class="form-control"
                      placeholder={t('home.searchPlaceholder')}
                      data-search-shortcut
                      value={searchQuery}
                      onInput={(e) => setSearchQuery(e.target.value)}
                    />
                    <span class="input-group-text bg-transparent d-none d-md-flex" title={t('home.searchShortcut')}>
                      <kbd>{isMac() ? '⌘K' : 'Ctrl+K'}</kbd>
                    </span>
                    <button class="btn btn-primary" type="submit">
                      {t('common.search')}
                    </button>
                  </div>
                </form>

                {/* Quick add */}
                <div class="card mb-4">
                  <div class="card-header">
                    <h3 class="card-title fs-5 mb-0">
                      <Plus size={17} class="me-2 text-success" />
                      {t('home.quickAdd')}
                    </h3>
                  </div>
                  <div class="card-body">
                    <div class="row g-2 align-items-end">
                      <div class="col-12 col-sm-6 col-md-3">
                        <select
                          class="form-select"
                          value={quickSource}
                          onChange={(e) => setQuickSource(e.target.value)}
                        >
                          <option value="musicbrainz">{t('albumForm.musicbrainz')}</option>
                          <option value="discogs">{t('albumForm.discogs')}</option>
                        </select>
                      </div>
                      <div class="col-12 col-sm-6 col-md-5">
                        <input
                          type="text"
                          class="form-control"
                          placeholder={t('home.quickAddPlaceholder')}
                          value={quickSearch}
                          onInput={(e) => setQuickSearch(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && quickSearch.trim() && navigate('add', { initialSearch: quickSearch.trim(), initialSource: quickSource })}
                        />
                      </div>
                      <div class="col-12 col-md-4">
                        <button
                          class="btn btn-success w-100"
                          disabled={!quickSearch.trim()}
                          onClick={() => navigate('add', { initialSearch: quickSearch.trim(), initialSource: quickSource })}
                        >
                          <Search size={15} class="me-1" />{t('home.quickAddSearch')}
                        </button>
                      </div>
                    </div>
                    <div class="row g-2 mt-2">
                      <div class="col-12 col-sm-6">
                        <button class="btn btn-outline-primary btn-sm w-100" onClick={() => navigate('add', {})}>
                          <PenLine size={14} class="me-1" />{t('home.addManually')}
                        </button>
                      </div>
                      <div class="col-12 col-sm-6">
                        <button class="btn btn-outline-danger btn-sm w-100" onClick={() => navigate('add', { fromWantList: true })}>
                          <Heart size={14} class="me-1" />{t('home.addToWishlist')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div class="text-center py-5">
                    <div class="spinner-border" role="status">
                      <span class="visually-hidden">{t('common.loading')}</span>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Recent + Random — 3 colonnes */}
                    <div class="row mb-4 g-3">

                      {/* Colonne 1 : Collection */}
                      <div class="col-12 col-lg-4">
                        <div class="card h-100">
                          <div class="card-header">
                            <h3 class="card-title fs-5 mb-0">
                              <Clock size={16} class="me-2 text-primary" />
                              {t('home.recentOwned')}
                            </h3>
                          </div>
                          <div class="list-group list-group-flush">
                            {recentAlbums.length === 0 ? (
                              <div class="list-group-item text-muted text-center py-3 small">
                                {t('home.noAlbums')}
                              </div>
                            ) : recentAlbums.map(album => (
                              <div
                                key={album.id}
                                class="list-group-item list-group-item-action d-flex align-items-center gap-3"
                                style={{ cursor: 'pointer' }}
                                onClick={() => navigate('detail', { id: album.id })}
                              >
                                {album.cover_url ? (
                                  <img src={album.cover_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                                ) : (
                                  <div class="d-flex align-items-center justify-content-center bg-secondary-lt rounded" style={{ width: 40, height: 40, flexShrink: 0 }}>
                                    <Music2 size={18} class="text-muted" />
                                  </div>
                                )}
                                <div class="flex-grow-1 overflow-hidden">
                                  <div class="fw-semibold text-truncate small">{album.title}</div>
                                  <div class="text-muted" style={{ fontSize: '0.75rem' }}>{album.artist?.name}</div>
                                </div>
                                {album.year && <span class="text-muted flex-shrink-0" style={{ fontSize: '0.75rem' }}>{album.year}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Colonne 2 : Liste de souhaits */}
                      <div class="col-12 col-lg-4">
                        <div class="card h-100">
                          <div class="card-header">
                            <h3 class="card-title fs-5 mb-0">
                              <Heart size={16} class="me-2 text-danger" />
                              {t('home.recentWantedSection')}
                            </h3>
                          </div>
                          <div class="list-group list-group-flush">
                            {recentWanted.length === 0 ? (
                              <div class="list-group-item text-muted text-center py-3 small">
                                {t('home.noAlbums')}
                              </div>
                            ) : recentWanted.map(album => (
                              <div
                                key={album.id}
                                class="list-group-item list-group-item-action d-flex align-items-center gap-3"
                                style={{ cursor: 'pointer' }}
                                onClick={() => navigate('detail', { id: album.id })}
                              >
                                {album.cover_url ? (
                                  <img src={album.cover_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                                ) : (
                                  <div class="d-flex align-items-center justify-content-center bg-secondary-lt rounded" style={{ width: 40, height: 40, flexShrink: 0 }}>
                                    <Music2 size={18} class="text-muted" />
                                  </div>
                                )}
                                <div class="flex-grow-1 overflow-hidden">
                                  <div class="fw-semibold text-truncate small">{album.title}</div>
                                  <div class="text-muted" style={{ fontSize: '0.75rem' }}>{album.artist?.name}</div>
                                </div>
                                {album.year && <span class="text-muted flex-shrink-0" style={{ fontSize: '0.75rem' }}>{album.year}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Column 3: Listening suggestion */}
                      <div class="col-12 col-lg-4">
                        <div class="card h-100">
                          <div class="card-header d-flex justify-content-between align-items-center">
                            <h3 class="card-title fs-5 mb-0">
                              <Shuffle size={16} class="me-2 text-warning" />
                              {t('home.randomAlbum')}
                            </h3>
                            <button
                              class="btn btn-sm btn-outline-secondary"
                              onClick={shuffleRandom}
                              title={t('home.shuffle')}
                            >
                              <Shuffle size={13} />
                            </button>
                          </div>
                          <div class="card-body d-flex flex-column align-items-center justify-content-center text-center gap-2">
                            {randomAlbum ? (
                              <div
                                class="d-flex flex-column align-items-center gap-2"
                                style={{ cursor: 'pointer' }}
                                onClick={() => navigate('detail', { id: randomAlbum.id })}
                              >
                                {randomAlbum.cover_url ? (
                                  <img
                                    src={randomAlbum.cover_url}
                                    alt=""
                                    class="random-album-cover"
                                    style={{ maxWidth: '100%', width: 180, height: 180, objectFit: 'cover', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}
                                  />
                                ) : (
                                  <div
                                    class="d-flex align-items-center justify-content-center bg-secondary-lt rounded random-album-cover"
                                    style={{ maxWidth: '100%', width: 180, height: 180 }}
                                  >
                                    <Music2 size={56} class="text-muted" />
                                  </div>
                                )}
                                <div>
                                  <div class="fw-bold small">{randomAlbum.title}</div>
                                  <div class="text-muted small">{randomAlbum.artist?.name}</div>
                                  {randomAlbum.year && <div class="text-muted" style={{ fontSize: '0.75rem' }}>{randomAlbum.year}</div>}
                                </div>
                              </div>
                            ) : (
                              <p class="text-muted small">{t('home.noAlbums')}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Lent albums */}
                    {lentAlbums.length > 0 && (
                      <div class="card mb-4">
                        <div class="card-header">
                          <h3 class="card-title fs-5 mb-0">
                            📤 {t('home.currentlyLent')}
                          </h3>
                        </div>
                        <div class="list-group list-group-flush">
                          {lentAlbums.map(album => (
                            <div
                              key={album.id}
                              class="list-group-item list-group-item-action d-flex align-items-center gap-3"
                              style={{ cursor: 'pointer' }}
                              onClick={() => navigate('detail', { id: album.id })}
                            >
                              {album.cover_url
                                ? <img src={album.cover_url} alt=""
                                    style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                                : <div class="bg-secondary-lt rounded d-flex align-items-center justify-content-center flex-shrink-0"
                                    style={{ width: 40, height: 40 }}>
                                    <Disc size={18} class="text-muted" />
                                  </div>
                              }
                              <div class="flex-grow-1 overflow-hidden">
                                <strong class="text-truncate d-block">{album.title}</strong>
                                <span class="text-muted small">{album.artist?.name}</span>
                              </div>
                              <div class="flex-shrink-0 text-end">
                                <div class="badge bg-warning-lt text-warning">
                                  <User size={11} class="me-1" />{album.lent_to}
                                </div>
                                {album.lent_at && (
                                  <div class="text-muted mt-1" style={{ fontSize: '0.7rem' }}>
                                    <Clock size={10} class="me-1" />{daysAgo(album.lent_at)} {t('lend.days')}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Totals */}
                    <div class="d-flex flex-wrap justify-content-center gap-4 text-muted small pt-2">
                      <span>
                        <BarChart3 size={15} class="me-1" />
                        <strong>{total}</strong> {t('home.albumsTotal')}
                      </span>
                      {totalWanted > 0 && (
                        <span>
                          <Heart size={14} class="me-1 text-danger" />
                          <strong>{totalWanted}</strong> {t('home.wantedTotal')}
                        </span>
                      )}
                    </div>
                  </>
                )}

              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
