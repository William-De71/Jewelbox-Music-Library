// Remote control of this player by another client of the server (Gladys…).
//
// The server relays the commands on an event stream (GET
// /api/player/remote/events) the player keeps open while "Allow remote
// control" is on (a per-browser setting, on by default). In return the player
// reports its live state (PATCH /api/player/queue/state with
// playback_state…) at every change, setting on or off: that is what the
// controller shows. See server/src/utils/remote.js.

import { getDeviceId, getDeviceLabel } from './deviceId.js';

const STORAGE_KEY = 'jewelbox-remote-control';

// What this player supports beyond play / pause / next / previous.
export const CAPABILITIES = ['seek', 'volume', 'mute', 'shuffle', 'repeat', 'queue', 'play_media', 'append'];

// While playing, a report at least this often: without a stream the server
// forgets a player silent for 90 s.
export const HEARTBEAT_MS = 30000;
// A position this far from the extrapolated one is a seek (same threshold as
// the Gladys SDK).
const SEEK_TOLERANCE_SEC = 3;

export function isRemoteControlEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRemoteControlEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch { /* storage denied: the setting lasts for this page only */ }
  window.dispatchEvent(new CustomEvent('jewelbox-remote-control', { detail: enabled }));
}

// EventSource cannot set a header: the device id goes in the query string.
export function remoteEventsUrl() {
  const qs = new URLSearchParams({
    device_id: getDeviceId(),
    label: getDeviceLabel(),
    capabilities: CAPABILITIES.join(','),
  });
  return `/api/player/remote/events?${qs}`;
}

// The live state the server expects, from the player's own values.
export function liveStateOf({ current, index, playing, currentTime, duration, volume, muted, shuffle, repeat }) {
  return {
    playback_state: current ? (playing ? 'playing' : 'paused') : 'idle',
    ...(current ? { track_id: current.id } : {}),
    current_index: current ? index : -1,
    position_sec: Math.round(Math.max(0, currentTime || 0) * 10) / 10,
    duration_sec: Number.isFinite(duration) ? Math.round(Math.max(0, duration) * 10) / 10 : 0,
    volume: Math.round(Math.min(1, Math.max(0, volume)) * 100),
    muted: Boolean(muted),
    shuffle: Boolean(shuffle),
    repeat,
  };
}

const sameShown = (a, b) => {
  for (const key of Object.keys({ ...a, ...b })) {
    if (key === 'position_sec' || key === 'duration_sec') continue;
    if (a[key] !== b[key]) return false;
  }
  return true;
};

// When to report: every change of what a controller shows (play / pause,
// track, volume, modes…), a seek, and every HEARTBEAT_MS while playing. The
// player updates its time ~4 times per second: everything else is ignored.
export function createLiveReporter() {
  let last = null;
  let at = 0;
  return {
    forget() {
      last = null;
    },
    update(live, now) {
      if (last === null) {
        last = live;
        at = now;
        return true;
      }
      let changed = !sameShown(live, last);
      if (!changed && live.playback_state === 'playing') {
        const expected = last.position_sec + (now - at) / 1000;
        changed = Math.abs(live.position_sec - expected) > SEEK_TOLERANCE_SEC || now - at >= HEARTBEAT_MS;
      } else if (!changed) {
        changed = Math.abs(live.position_sec - last.position_sec) > SEEK_TOLERANCE_SEC;
      }
      if (changed) {
        last = live;
        at = now;
      }
      return changed;
    },
  };
}

// Runs one command on the player. `player` is the PlayerContext value plus
// play / pause / setMuted / setRepeatMode / playMedia.
export function runCommand(player, command) {
  switch (command?.command) {
    case 'play': return player.play();
    case 'pause': return player.pause();
    case 'toggle': return player.toggle();
    case 'next': return player.next();
    case 'previous': return player.prev();
    case 'seek': return player.seek(Number(command.position_sec));
    case 'volume': return player.setVolume(Number(command.volume) / 100);
    case 'mute': return player.setMuted(Boolean(command.muted));
    case 'shuffle':
      if (Boolean(command.shuffle) !== player.shuffle) player.toggleShuffle();
      return undefined;
    case 'repeat':
      if (['off', 'all', 'one'].includes(command.repeat)) player.setRepeatMode(command.repeat);
      return undefined;
    case 'play_index':
      // jumpTo restarts the track: on the current one, just make sure it plays.
      if (command.index === player.index) return player.play();
      return player.jumpTo(command.index);
    case 'play_media':
      return player.playMedia(command.media || {}, command.mode || 'replace');
    default:
      return undefined;
  }
}
