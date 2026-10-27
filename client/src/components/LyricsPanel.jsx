import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../config/i18n/index.jsx';
import { api } from '../api/client.js';
import { currentLineIndex } from '../utils/lyrics.js';

// Lyrics answers are kept for the session: each track is asked once.
const cache = new Map();

// The lyrics of the playing track, in the full player: synced lines follow
// the music (a tap seeks there), plain lyrics are shown as text.
export function LyricsPanel({ trackId, currentTime, onSeek }) {
  const { t } = useI18n();
  const [lyrics, setLyrics] = useState(() => cache.get(trackId) ?? null);
  const [failed, setFailed] = useState(false);
  const activeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (cache.has(trackId)) {
      setLyrics(cache.get(trackId));
      return undefined;
    }
    setLyrics(null);
    api.getLyrics(trackId)
      .then((data) => {
        cache.set(trackId, data);
        if (!cancelled) setLyrics(data);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [trackId]);

  const index = lyrics?.synced ? currentLineIndex(lyrics.lines, currentTime) : -1;

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [index]);

  if (failed) return <p class="text-muted text-center my-4">{t('lyrics.unavailable')}</p>;
  if (!lyrics) return <p class="text-muted text-center my-4">{t('lyrics.loading')}</p>;
  if (lyrics.instrumental) return <p class="text-muted text-center my-4">{t('lyrics.instrumental')}</p>;
  if (!lyrics.synced && !lyrics.plain) return <p class="text-muted text-center my-4">{t('lyrics.none')}</p>;

  return (
    <div class="lyrics-panel">
      {lyrics.synced ? (
        <ol class="list-unstyled mb-0">
          {lyrics.lines.map((line, i) => (
            <li key={`${line.time}-${i}`} ref={i === index ? activeRef : undefined}>
              <button
                type="button"
                class={`lyrics-line ${i === index ? 'active' : ''} ${i < index ? 'past' : ''}`}
                onClick={() => onSeek(line.time)}
              >
                {line.text || '♪'}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p class="lyrics-plain">{lyrics.plain}</p>
      )}
      {lyrics.source === 'lrclib' && <p class="text-muted small text-center mt-3 mb-0">{t('lyrics.credit')}</p>}
    </div>
  );
}
