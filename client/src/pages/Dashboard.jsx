import { useState, useEffect } from 'preact/hooks';
import { albumsApi } from '../api/albums.js';
import { api } from '../api/client.js';
import { isMac } from '../utils/searchShortcut.js';
import { useI18n } from '../config/i18n/index.jsx';
import { usePlayer } from '../components/PlayerContext.jsx';
import { Home, Search, Music2, Shuffle, Clock, Settings, Plus, Heart, Disc, User, Database, Play, Headphones, UserPlus } from 'lucide-preact';

// Albums shown in the "to listen today" band, and rows of each recent list.
const SUGGESTION_COUNT = 6;
const RECENT_COUNT = 5;

function AlbumRow({ album, onOpen }) {
  return (
    <button type="button" class="list-group-item list-group-item-action home-row" onClick={() => onOpen(album.id)}>
      {album.cover_url ? (
        <img src={album.cover_url} alt="" class="home-row-cover" />
      ) : (
        <span class="home-row-cover bg-secondary-lt"><Music2 size={18} class="text-muted" /></span>
      )}
      <span class="home-row-text">
        <span class="fw-semibold text-truncate d-block">{album.title}</span>
        <span class="text-muted small text-truncate d-block">{album.artist?.name}</span>
      </span>
      {album.year && <span class="text-muted small flex-shrink-0">{album.year}</span>}
    </button>
  );
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

export function Dashboard({ navigate }) {
  const { t } = useI18n();
  const { playAlbumById } = usePlayer();
  const [recentAlbums, setRecentAlbums] = useState([]);
  const [recentWanted, setRecentWanted] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lentAlbums, setLentAlbums] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalWanted, setTotalWanted] = useState(0);
  const [activeDb, setActiveDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbCheckComplete, setDbCheckComplete] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const dbData = await albumsApi.getActiveDatabase().catch(() => null);
      const db = dbData?.database;
      setActiveDb(db);
      setDbCheckComplete(true);
      if (!db) return;

      const [recentData, recentWantedData, lentData, home] = await Promise.all([
        albumsApi.getAll({ sort: 'created_at', order: 'desc', limit: RECENT_COUNT, wanted: 'false' }),
        albumsApi.getAll({ sort: 'created_at', order: 'desc', limit: RECENT_COUNT, wanted: 'true' }),
        albumsApi.getAll({ lent: 'true', limit: 50 }),
        // The day's suggestions, the same as on the players' home: playable
        // albums, well rated and not listened to lately. Never blocks the page.
        api.getHomeFeed().catch(() => null),
      ]);

      setRecentAlbums(recentData.data);
      setRecentWanted(recentWantedData.data);
      setTotal(recentData.pagination.total);
      setTotalWanted(recentWantedData.pagination.total);
      setLentAlbums(lentData.data);
      setSuggestions(home?.suggestions || []);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const refreshSuggestions = async () => {
    setRefreshing(true);
    try {
      const res = await api.redrawSuggestions();
      setSuggestions(res.suggestions || []);
    } catch (e) {
      console.error('Suggestions error:', e);
    } finally {
      setRefreshing(false);
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

  const openAlbum = (id) => navigate('detail', { id });

  return (
    <div class="page-container">
      <div class="container-fluid home">

        {/* Title + totals */}
        <div class="home-head">
          <h2 class="page-title flex-grow-1 mb-0">
            <Home size={24} class="me-2 text-primary" />
            {t('common.home')}
          </h2>
          {!loading && (
            <div class="home-totals">
              <button type="button" class="btn home-total" onClick={() => navigate('collections')}>
                <Disc size={15} class="me-2 text-primary" /><strong class="me-1">{total}</strong>{t('home.totalAlbums')}
              </button>
              <button type="button" class="btn home-total" onClick={() => navigate('wantlist')}>
                <Heart size={15} class="me-2 text-danger" /><strong class="me-1">{totalWanted}</strong>{t('home.totalWanted')}
              </button>
              <button type="button" class="btn home-total" onClick={() => navigate('lend')}>
                <UserPlus size={15} class="me-2 text-warning" /><strong class="me-1">{lentAlbums.length}</strong>{t('home.totalLent')}
              </button>
            </div>
          )}
        </div>

        {/* Search + add, on one line */}
        <div class="home-actions">
          <form onSubmit={handleSearch} class="home-search">
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
          <div class="home-add">
            <button type="button" class="btn btn-success flex-grow-1" onClick={() => navigate('add', {})}>
              <Plus size={16} class="me-1" />{t('home.addAlbum')}
            </button>
            <button type="button" class="btn btn-outline-danger" onClick={() => navigate('add', { fromWantList: true })}>
              <Heart size={15} class="me-1" />{t('home.addWish')}
            </button>
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
            {/* To listen today: full-width band */}
            <div class="card">
              <div class="card-header home-card-header">
                <h3 class="card-title fs-5 mb-0 flex-grow-1">
                  <Headphones size={16} class="me-2 text-warning" />
                  {t('home.suggestionsTitle')}
                </h3>
                <span class="text-muted small">{t('home.suggestionsHint')}</span>
                {suggestions.length > 0 && (
                  <button type="button" class="btn btn-sm btn-outline-secondary" onClick={refreshSuggestions} disabled={refreshing}>
                    <Shuffle size={13} class="me-1" />{t('home.suggestionsRefresh')}
                  </button>
                )}
              </div>
              {suggestions.length === 0 ? (
                <div class="card-body text-muted text-center small">{t('home.suggestionsEmpty')}</div>
              ) : (
                <div class="card-body home-suggestions">
                  {suggestions.slice(0, SUGGESTION_COUNT).map(album => (
                    <div key={album.id} class="home-suggestion">
                      <div class="home-suggestion-cover">
                        <button type="button" class="home-suggestion-open" onClick={() => openAlbum(album.id)} title={album.title}>
                          {album.cover_url ? (
                            <img src={album.cover_url} alt="" />
                          ) : (
                            <span class="home-suggestion-placeholder bg-secondary-lt"><Disc size={48} class="text-muted" /></span>
                          )}
                        </button>
                        <button
                          type="button"
                          class="btn btn-primary btn-icon home-suggestion-play"
                          onClick={() => playAlbumById(album.id)}
                          title={t('player.playAlbum')}
                          aria-label={`${t('player.playAlbum')} : ${album.title}`}
                        >
                          <Play size={16} fill="currentColor" />
                        </button>
                      </div>
                      <div class="fw-semibold text-truncate">{album.title}</div>
                      <div class="text-muted small text-truncate">{album.artist?.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Latest additions: collection and wish list side by side */}
            <div class="row g-3">
              <div class="col-12 col-lg-6">
                <div class="card h-100">
                  <div class="card-header home-card-header">
                    <h3 class="card-title fs-5 mb-0 flex-grow-1">
                      <Clock size={16} class="me-2 text-primary" />
                      {t('home.recentOwnedTitle')}
                    </h3>
                    <button type="button" class="btn btn-link btn-sm p-0" onClick={() => navigate('collections')}>{t('home.seeAll')}</button>
                  </div>
                  <div class="list-group list-group-flush">
                    {recentAlbums.length === 0 ? (
                      <div class="list-group-item text-muted text-center py-3 small">{t('home.noAlbums')}</div>
                    ) : recentAlbums.map(album => <AlbumRow key={album.id} album={album} onOpen={openAlbum} />)}
                  </div>
                </div>
              </div>
              <div class="col-12 col-lg-6">
                <div class="card h-100">
                  <div class="card-header home-card-header">
                    <h3 class="card-title fs-5 mb-0 flex-grow-1">
                      <Heart size={16} class="me-2 text-danger" />
                      {t('home.recentWantedTitle')}
                    </h3>
                    <button type="button" class="btn btn-link btn-sm p-0" onClick={() => navigate('wantlist')}>{t('home.seeAll')}</button>
                  </div>
                  <div class="list-group list-group-flush">
                    {recentWanted.length === 0 ? (
                      <div class="list-group-item text-muted text-center py-3 small">{t('home.noAlbums')}</div>
                    ) : recentWanted.map(album => <AlbumRow key={album.id} album={album} onOpen={openAlbum} />)}
                  </div>
                </div>
              </div>
            </div>

            {/* Lent albums */}
            {lentAlbums.length > 0 && (
              <div class="card">
                <div class="card-header home-card-header">
                  <h3 class="card-title fs-5 mb-0 flex-grow-1">
                    <UserPlus size={16} class="me-2 text-warning" />
                    {t('home.lentTitle')}
                  </h3>
                  <button type="button" class="btn btn-link btn-sm p-0" onClick={() => navigate('lend')}>{t('home.seeAll')}</button>
                </div>
                <div class="list-group list-group-flush">
                  {lentAlbums.map(album => (
                    <button
                      key={album.id}
                      type="button"
                      class="list-group-item list-group-item-action home-row"
                      onClick={() => openAlbum(album.id)}
                    >
                      {album.cover_url ? (
                        <img src={album.cover_url} alt="" class="home-row-cover" />
                      ) : (
                        <span class="home-row-cover bg-secondary-lt"><Disc size={18} class="text-muted" /></span>
                      )}
                      <span class="home-row-text">
                        <span class="fw-semibold text-truncate d-block">{album.title}</span>
                        <span class="text-muted small text-truncate d-block">{album.artist?.name}</span>
                      </span>
                      <span class="flex-shrink-0 text-end">
                        <span class="badge bg-warning-lt text-warning">
                          <User size={11} class="me-1" />{album.lent_to}
                        </span>
                        {album.lent_at && (
                          <span class="text-muted d-block mt-1 home-lent-since">
                            <Clock size={10} class="me-1" />{daysAgo(album.lent_at)} {t('lend.days')}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
