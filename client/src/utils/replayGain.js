// Volume normalization from the files' ReplayGain tags (written by JewelBox
// Ripper, read by the server's audio scan: track.replaygain, gains in dB).
//
// The gain goes through the <audio> volume, which tops out at 1: a negative
// gain (a loud master) lowers the track, a positive one (a quiet master) is
// left out rather than pushing past full scale. "album" keeps the nuances
// between the tracks of a disc; a missing gain falls back on the other one.

const STORAGE_KEY = 'jewelbox-replaygain';
export const REPLAYGAIN_MODES = ['off', 'track', 'album'];
const DEFAULT_MODE = 'album';

export function getReplayGainMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return REPLAYGAIN_MODES.includes(saved) ? saved : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function setReplayGainMode(mode) {
  if (!REPLAYGAIN_MODES.includes(mode)) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* storage denied: the setting lasts for this page only */ }
  window.dispatchEvent(new CustomEvent('jewelbox-replaygain', { detail: mode }));
}

// Volume multiplier (0–1] for a track: 1 when off, untagged, or louder.
export function replayGainFactor(replaygain, mode) {
  if (!replaygain || mode === 'off') return 1;
  const gain = mode === 'track'
    ? replaygain.track_gain ?? replaygain.album_gain
    : replaygain.album_gain ?? replaygain.track_gain;
  if (!Number.isFinite(gain)) return 1;
  return Math.min(1, 10 ** (gain / 20));
}
