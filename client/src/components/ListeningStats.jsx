import { useEffect, useState } from 'preact/hooks';
import { Headphones, CalendarDays, Clock, Disc, Play } from 'lucide-preact';
import { api } from '../api/client.js';
import { useI18n } from '../config/i18n/index.jsx';
import { HBar, KpiCard } from './StatsWidgets.jsx';
import { usePlayer } from './PlayerContext.jsx';

export const LISTENING_PERIODS = ['month', 'year', 'all'];

// 754 -> "12 h 34", 42 -> "42 min"
export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

// "2026-03" -> "mars" (the year only on January, to mark the turn)
export function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  const name = date.toLocaleDateString('fr-FR', { month: 'short' });
  return month === 1 ? `${name} ${String(year).slice(2)}` : name;
}

function MonthBars({ data }) {
  const max = Math.max(...data.map(d => d.plays), 1);
  return (
    <div class="d-flex align-items-end gap-1" style={{ height: 160 }} role="img"
      aria-label={data.map(d => `${monthLabel(d.month)} : ${d.plays}`).join(', ')}>
      {data.map(d => (
        <div key={d.month} class="d-flex flex-column align-items-center flex-fill" style={{ minWidth: 0 }}>
          <span class="small fw-semibold" style={{ fontSize: '0.7rem' }}>{d.plays || ''}</span>
          <div style={{
            width: '100%',
            maxWidth: 32,
            height: `${(d.plays / max) * 110}px`,
            minHeight: d.plays ? 3 : 1,
            background: d.plays ? '#7B93DB' : 'var(--tblr-border-color, #dee2e6)',
            borderRadius: 4,
          }} />
          <span class="text-muted text-truncate" style={{ fontSize: '0.65rem', maxWidth: '100%' }}>{monthLabel(d.month)}</span>
        </div>
      ))}
    </div>
  );
}

// size in px, or 'fill' for a square as wide as its column.
function Cover({ url, title, size = 48 }) {
  const box = size === 'fill' ? { width: '100%', aspectRatio: '1 / 1' } : { width: size, height: size };
  return url
    ? <img src={url} alt={title} class="rounded flex-shrink-0 d-block" style={{ ...box, objectFit: 'cover' }} />
    : (
      <span class="rounded bg-secondary-lt d-flex align-items-center justify-content-center flex-shrink-0" style={box}>
        <Disc size={24} />
      </span>
    );
}

export function ListeningStats({ navigate }) {
  const { t } = useI18n();
  const { playAlbumById } = usePlayer();
  const [period, setPeriod] = useState('month');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.getListeningStats(period)
      .then((data) => { if (!cancelled) setStats(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [period]);

  if (error) return <div class="alert alert-danger">{t('stats.error.loadFailed')}</div>;
  if (!stats) return null;

  const playsText = (count) => t(count > 1 ? 'stats.listening.playsPlural' : 'stats.listening.plays', { count });
  const openAlbum = (id) => navigate?.('detail', { id });
  const { counters, summary, top, never_played: never } = stats;
  const since = stats.tracking_since
    ? t('stats.listening.trackingSince', { date: new Date(stats.tracking_since).toLocaleDateString('fr-FR') })
    : t('stats.listening.trackingNone');

  return (
    <div>
      <div class="row g-3 mb-4">
        <div class="col-6 col-md-3">
          <KpiCard icon={<Headphones size={22} />} value={counters.plays_today} label={t('stats.listening.playsToday')} color="primary" />
        </div>
        <div class="col-6 col-md-3">
          <KpiCard icon={<CalendarDays size={22} />} value={counters.plays_month} label={t('stats.listening.playsMonth')} color="info" />
        </div>
        <div class="col-6 col-md-3">
          <KpiCard icon={<Play size={22} />} value={counters.plays_all} label={t('stats.listening.playsAll')} color="success" />
        </div>
        <div class="col-6 col-md-3">
          <KpiCard icon={<Clock size={22} />} value={formatMinutes(summary.listening_minutes)}
            label={`${t('stats.listening.listeningTime')} · ${t(`stats.listening.periods.${period}`).toLowerCase()}`} color="warning" />
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <h3 class="card-title fs-5 mb-0">{t('stats.listening.byMonth')}</h3>
        </div>
        <div class="card-body">
          <MonthBars data={stats.by_month} />
          <p class="text-muted small mb-0 mt-3">{since} {t('stats.listening.countRule')}</p>
        </div>
      </div>

      <div class="btn-group mb-3" role="group">
        {LISTENING_PERIODS.map(p => (
          <button key={p} type="button" class={`btn ${p === period ? 'btn-primary' : 'btn-outline-primary'}`}
            aria-pressed={p === period} onClick={() => setPeriod(p)}>
            {t(`stats.listening.periods.${p}`)}
          </button>
        ))}
      </div>

      {summary.plays === 0 ? (
        <div class="card mb-3"><div class="card-body text-muted">{t('stats.listening.empty')}</div></div>
      ) : (
        <div class="row g-3 mb-3">
          <div class="col-12 col-lg-6">
            <div class="card h-100">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0">{t('stats.listening.topAlbums')}</h3>
                <span class="ms-auto text-muted small">{t('stats.listening.albumsPlayed')} : {summary.albums}</span>
              </div>
              <ol class="list-group list-group-flush">
                {top.albums.map((album, i) => (
                  <li key={album.album_id} class="list-group-item d-flex align-items-center gap-3">
                    <span class="text-muted" style={{ width: 18 }}>{i + 1}</span>
                    <button type="button" class="btn btn-link p-0 d-flex align-items-center gap-3 text-start text-reset text-decoration-none flex-grow-1" style={{ minWidth: 0 }}
                      onClick={() => openAlbum(album.album_id)}>
                      <Cover url={album.cover_url} title={album.title} />
                      <span class="text-truncate">
                        <span class="d-block text-truncate fw-semibold">{album.title}</span>
                        <span class="d-block text-truncate text-muted small">{album.artist_name}</span>
                      </span>
                    </button>
                    <span class="text-muted small text-nowrap">{playsText(album.plays)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div class="col-12 col-lg-6 d-flex flex-column gap-3">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0">{t('stats.listening.topArtists')}</h3>
              </div>
              <div class="card-body">
                <HBar data={top.artists.map(a => ({ label: a.name, count: a.plays }))} color="#C47BA8" labelWidth={140} />
              </div>
            </div>
            <div class="card">
              <div class="card-header">
                <h3 class="card-title fs-5 mb-0">{t('stats.listening.topTracks')}</h3>
              </div>
              <ol class="list-group list-group-flush">
                {top.tracks.map(track => (
                  <li key={track.id} class="list-group-item d-flex align-items-center gap-2 py-2">
                    <span class="flex-grow-1" style={{ minWidth: 0 }}>
                      <span class="d-block text-truncate">{track.title}</span>
                      <span class="d-block text-truncate text-muted small">{track.artist_name} · {track.album_title}</span>
                    </span>
                    <span class="text-muted small text-nowrap">{playsText(track.plays)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      <div class="card">
        <div class="card-header">
          <h3 class="card-title fs-5 mb-0">{t('stats.listening.neverPlayed')}</h3>
        </div>
        <div class="card-body">
          {never.count === 0 ? (
            <p class="text-muted mb-0">{t('stats.listening.neverPlayedNone')}</p>
          ) : (
            <>
              <p class="text-muted small">{t('stats.listening.neverPlayedCount', { count: never.count })}</p>
              <div class="row g-3">
                {never.albums.map(album => (
                  <div key={album.album_id} class="col-6 col-sm-4 col-md-3 col-xl-2">
                    <div class="position-relative">
                      <button type="button" class="btn btn-link p-0 w-100 text-start text-reset text-decoration-none"
                        onClick={() => openAlbum(album.album_id)}>
                        <Cover url={album.cover_url} title={album.title} size="fill" />
                        <span class="d-block text-truncate fw-semibold small mt-1">{album.title}</span>
                        <span class="d-block text-truncate text-muted small">{album.artist_name}</span>
                      </button>
                      <button type="button" class="btn btn-primary btn-icon btn-sm position-absolute top-0 end-0 m-1"
                        onClick={() => playAlbumById(album.album_id)} title={t('player.play')} aria-label={t('player.play')}>
                        <Play size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
