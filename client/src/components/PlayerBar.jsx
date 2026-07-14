import { useI18n } from '../config/i18n/index.jsx';
import { usePlayer } from './PlayerContext.jsx';
import { formatTime } from '../utils/formatTime.js';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X, Disc } from 'lucide-preact';

export function PlayerBar() {
  const { t } = useI18n();
  const {
    current, playing, currentTime, duration, volume, expanded,
    toggle, next, prev, seek, setVolume, close, setExpanded,
  } = usePlayer();

  if (!current) return null;

  const expand = () => setExpanded(true);

  return (
    <div class="player-bar" role="region" aria-label={t('player.nowPlaying')}>
      <div
        class="player-bar-info cursor-pointer"
        role="button"
        aria-expanded={expanded}
        title={t('player.expand')}
        onClick={expand}
      >
        {current.cover_url ? (
          <img class="player-bar-cover" src={current.cover_url} alt={current.album_title} />
        ) : (
          <div class="player-bar-cover player-bar-cover-placeholder">
            <Disc size={24} />
          </div>
        )}
        <div class="player-bar-meta">
          <div class="player-bar-title text-truncate">{current.title}</div>
          <div class="player-bar-artist text-muted text-truncate">{current.artist_name}</div>
        </div>
      </div>

      <div class="player-bar-center">
        <div class="player-bar-controls">
          <button class="btn btn-icon btn-ghost-secondary" onClick={prev} title={t('player.previous')}>
            <SkipBack size={18} />
          </button>
          <button class="btn btn-icon btn-primary player-bar-toggle" onClick={toggle} title={playing ? t('player.pause') : t('player.play')}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button class="btn btn-icon btn-ghost-secondary" onClick={next} title={t('player.next')}>
            <SkipForward size={18} />
          </button>
        </div>
        <div class="player-bar-progress">
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
      </div>

      <div class="player-bar-right">
        <button
          class="btn btn-icon btn-ghost-secondary player-bar-volume-btn"
          onClick={() => setVolume(volume > 0 ? 0 : 1)}
          title={volume > 0 ? t('player.mute') : t('player.unmute')}
        >
          {volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <input
          type="range"
          class="player-bar-range player-bar-volume"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onInput={(e) => setVolume(parseFloat(e.currentTarget.value))}
          aria-label={t('player.volume')}
        />
        <button class="btn btn-icon btn-ghost-secondary" onClick={close} title={t('player.close')}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
