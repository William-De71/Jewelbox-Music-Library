// Soft transition between tracks, without overlap: the sound goes down over
// the last seconds of a track and back up at the start of the next one.
// Never between two tracks that follow each other on the same album (a live
// album, a concept album must stay gapless). Same rule on desktop and Android.

const STORAGE_KEY = 'jewelbox-transition-fade';
export const TRANSITION_FADE_CHOICES = [0, 2, 4, 6, 8];

export function getTransitionFade() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return TRANSITION_FADE_CHOICES.includes(saved) ? saved : 0;
  } catch {
    return 0;
  }
}

export function setTransitionFade(seconds) {
  if (!TRANSITION_FADE_CHOICES.includes(seconds)) return;
  try {
    localStorage.setItem(STORAGE_KEY, String(seconds));
  } catch { /* storage denied: this page only */ }
  window.dispatchEvent(new CustomEvent('jewelbox-transition-fade', { detail: seconds }));
}

// Two queue entries that follow each other on their album.
export function followsOnAlbum(before, after) {
  return Boolean(before && after && before.album_id != null && before.album_id === after.album_id
    && Number.isFinite(before.position) && after.position === before.position + 1);
}

// Volume multiplier at `time` of a track lasting `duration` (seconds).
export function transitionFadeFactor({ time, duration, fade, fadeIn = true, fadeOut = true }) {
  if (!fade || !Number.isFinite(time)) return 1;
  let factor = 1;
  if (fadeIn) factor = Math.min(factor, Math.max(0, time) / fade);
  if (fadeOut && Number.isFinite(duration) && duration > 2 * fade) {
    factor = Math.min(factor, Math.max(0, duration - time) / fade);
  }
  return Math.min(1, Math.max(0, factor));
}
