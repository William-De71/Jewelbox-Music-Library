import { useEffect, useRef } from 'preact/hooks';
import { useI18n } from '../config/i18n/index.jsx';
import { usePlayer } from './PlayerContext.jsx';
import { formatTime } from '../utils/formatTime.js';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X, Disc, ChevronDown, ListMusic,
  Shuffle, Repeat, Repeat1, Heart, Infinity as InfinityIcon,
} from 'lucide-preact';

export function PlayerView({ navigate }) {
  const { t } = useI18n();
  const {
    queue, index, current, playing, currentTime, duration, volume, expanded, repeat, shuffle, dynamicMix,
    toggle, next, prev, seek, setVolume, close, setExpanded, jumpTo, cycleRepeat, toggleShuffle, toggleFavorite,
  } = usePlayer();

  const repeatTitle = repeat === 'one' ? t('player.repeatOne') : repeat === 'all' ? t('player.repeatAll') : t('player.repeatOff');

  const collapseBtnRef = useRef(null);
  const activeItemRef = useRef(null);

  useEffect(() => {
    if (!expanded) return;
    collapseBtnRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded, setExpanded]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, index]);

  if (!expanded || !current) return null;

  const goToAlbum = () => {
    setExpanded(false);
    navigate('detail', { id: current.album_id });
  };

  return (
    <div class="player-view" role="dialog" aria-modal="true" aria-label={t('player.nowPlaying')}>
      <div class="player-view-content">
        <div class="player-view-header">
          <button
            ref={collapseBtnRef}
            class="btn btn-icon btn-ghost-secondary"
            onClick={() => setExpanded(false)}
            title={t('player.collapse')}
            aria-label={t('player.collapse')}
          >
            <ChevronDown size={22} />
          </button>
          <span class="text-muted small text-uppercase">{t('player.nowPlaying')}</span>
          <button class="btn btn-icon btn-ghost-secondary" onClick={close} title={t('player.close')}>
            <X size={20} />
          </button>
        </div>

        {current.cover_url ? (
          <img class="player-view-cover" src={current.cover_url} alt={current.album_title} />
        ) : (
          <div class="player-view-cover player-view-cover-placeholder">
            <Disc size={64} />
          </div>
        )}

        <div class="player-view-meta">
          <div class="player-view-title-row">
            <div class="player-view-title text-truncate">{current.title}</div>
            <button
              class={`btn btn-icon ${current.is_favorite ? 'text-danger' : 'btn-ghost-secondary'}`}
              onClick={() => toggleFavorite(current.id, !current.is_favorite)}
              title={current.is_favorite ? t('player.unfavorite') : t('player.favorite')}
            >
              <Heart size={20} fill={current.is_favorite ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div class="text-muted text-truncate">{current.artist_name}</div>
          <button class="btn btn-link p-0 text-muted small text-truncate" onClick={goToAlbum} title={t('player.goToAlbum')}>
            {current.album_title}
          </button>
        </div>

        <div class="player-view-progress">
          <span class="player-bar-time font-monospace">{formatTime(currentTime)}</span>
          <input
            type="range"
            class="player-bar-range"
            min="0"
            max={Number.isFinite(duration) && duration > 0 ? duration : 0}
            step="0.5"
            value={currentTime}
            onInput={(e) => seek(parseFloat(e.currentTarget.value))}
            aria-label={t('player.seek')}
          />
          <span class="player-bar-time font-monospace">{formatTime(duration)}</span>
        </div>

        <div class="player-view-controls">
          <button
            class={`btn btn-icon ${shuffle ? 'btn-ghost-primary' : 'btn-ghost-secondary'}`}
            onClick={toggleShuffle}
            aria-pressed={shuffle}
            title={shuffle ? t('player.shuffleOff') : t('player.shuffle')}
          >
            <Shuffle size={20} />
          </button>
          <button class="btn btn-icon btn-ghost-secondary" onClick={prev} title={t('player.previous')}>
            <SkipBack size={24} />
          </button>
          <button class="btn btn-icon btn-primary player-view-toggle" onClick={toggle} title={playing ? t('player.pause') : t('player.play')}>
            {playing ? <Pause size={28} /> : <Play size={28} />}
          </button>
          <button class="btn btn-icon btn-ghost-secondary" onClick={next} title={t('player.next')}>
            <SkipForward size={24} />
          </button>
          <button
            class={`btn btn-icon ${repeat !== 'off' ? 'btn-ghost-primary' : 'btn-ghost-secondary'}`}
            onClick={cycleRepeat}
            aria-pressed={repeat !== 'off'}
            title={repeatTitle}
          >
            {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
          </button>
        </div>

        <div class="player-view-volume">
          <button
            class="btn btn-icon btn-ghost-secondary"
            onClick={() => setVolume(volume > 0 ? 0 : 1)}
            title={volume > 0 ? t('player.mute') : t('player.unmute')}
          >
            {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <input
            type="range"
            class="player-bar-range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onInput={(e) => setVolume(parseFloat(e.currentTarget.value))}
            aria-label={t('player.volume')}
          />
        </div>

        <div class="player-view-queue-header text-muted small">
          <ListMusic size={14} class="me-1" />{t('player.queue')} ({queue.length})
          {dynamicMix && (
            <span class="badge bg-primary-lt ms-2">
              <InfinityIcon size={12} class="me-1" />{t('player.dynamicMix')}
            </span>
          )}
        </div>
        <ol class="player-view-queue list-unstyled">
          {queue.map((track, i) => (
            <li
              key={`${track.id}-${i}`}
              ref={i === index ? activeItemRef : undefined}
              class={i === index ? 'active' : ''}
            >
              <button type="button" class="player-view-queue-item" onClick={() => jumpTo(i)}>
                <span class="player-view-queue-num text-muted">{i + 1}</span>
                <span class="text-truncate">{track.title}</span>
                <span class="text-muted small text-truncate d-none d-sm-inline">{track.artist_name}</span>
                <span class="text-muted small font-monospace ms-auto">{track.duration || ''}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
