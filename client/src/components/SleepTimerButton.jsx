import { useEffect, useRef, useState } from 'preact/hooks';
import { Moon } from 'lucide-preact';
import { useI18n } from '../config/i18n/index.jsx';
import { usePlayer } from './PlayerContext.jsx';
import { formatTime } from '../utils/formatTime.js';
import { SLEEP_TIMER_MINUTES } from '../utils/sleepTimer.js';

// Moon button of the full player: picks a sleep timer, shows what is left.
export function SleepTimerButton() {
  const { t } = useI18n();
  const { sleepTimer, setSleepTimer } = usePlayer();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const rootRef = useRef(null);

  // Countdown refresh, only while a timed timer runs.
  useEffect(() => {
    if (!sleepTimer?.endsAt) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sleepTimer]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = (command) => {
    setSleepTimer(command);
    setOpen(false);
  };

  const label = sleepTimer?.endOfTrack
    ? t('sleepTimer.endOfTrackShort')
    : sleepTimer?.endsAt
      ? formatTime(Math.max(0, Math.ceil((sleepTimer.endsAt - now) / 1000)))
      : null;

  return (
    <div class="dropdown position-relative" ref={rootRef}>
      <button
        type="button"
        class={`btn btn-ghost-${sleepTimer ? 'primary' : 'secondary'} ${label ? 'px-2' : 'btn-icon'}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('sleepTimer.title')}
        aria-label={t('sleepTimer.title')}
      >
        <Moon size={18} />
        {label && <span class="ms-1 small font-monospace">{label}</span>}
      </button>
      {open && (
        <div class="dropdown-menu dropdown-menu-end show" role="menu" style={{ right: 0, left: 'auto', bottom: '100%', top: 'auto' }}>
          <h6 class="dropdown-header">{t('sleepTimer.title')}</h6>
          {SLEEP_TIMER_MINUTES.map(minutes => (
            <button key={minutes} type="button" class="dropdown-item" role="menuitem" onClick={() => pick({ minutes })}>
              {t('sleepTimer.minutes', { minutes })}
            </button>
          ))}
          <button type="button" class="dropdown-item" role="menuitem" onClick={() => pick({ end_of_track: true })}>
            {t('sleepTimer.endOfTrack')}
          </button>
          {sleepTimer && (
            <>
              <div class="dropdown-divider" />
              <button type="button" class="dropdown-item text-danger" role="menuitem" onClick={() => pick({ minutes: 0 })}>
                {t('sleepTimer.cancel')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
