import { randomUUID } from 'crypto';

// Remote control of the players (web app, desktop, Android) by another
// client, Gladys first. Two halves, both in memory — what a player is doing
// right now is worth nothing after a restart:
//
// - a player that allows remote control keeps an event stream open
//   (GET /player/remote/events) and receives its commands on it;
// - every player reports its live state (PATCH /player/queue/state with
//   playback_state…) at each change, whether it allows control or not.
//
// Controllers read the list (GET /player/remote/devices) or watch it
// (GET /player/remote/watch) and send commands
// (POST /player/remote/devices/:id/commands).

// A player without a stream stays listed this long after its last report:
// players report at least every 30 s while playing, and once at a pause.
export const REPORT_TTL_MS = 90_000;

// What a player may announce it supports. play / pause / toggle / next /
// previous are always understood; the rest is optional.
export const CAPABILITIES = ['seek', 'volume', 'mute', 'shuffle', 'repeat', 'queue', 'play_media', 'append'];

export const PLAYBACK_STATES = ['playing', 'paused', 'idle'];
export const REPEAT_MODES = ['off', 'all', 'one'];
export const MEDIA_TYPES = ['album', 'playlist', 'smart', 'track', 'album_radio', 'artist_radio'];
export const PLAY_MODES = ['replace', 'next', 'append'];

// command -> capability it needs (null: every player)
const COMMANDS = {
  play: null,
  pause: null,
  toggle: null,
  next: null,
  previous: null,
  seek: 'seek',
  volume: 'volume',
  mute: 'mute',
  shuffle: 'shuffle',
  repeat: 'repeat',
  play_index: 'queue',
  play_media: 'play_media',
};

export function parseCapabilities(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return [...new Set(list.map(c => String(c).trim()).filter(c => CAPABILITIES.includes(c)))];
}

// Returns { command } (only the known fields, normalised) or { error, status }.
export function validateCommand(body, capabilities) {
  const name = body?.command;
  if (!Object.hasOwn(COMMANDS, name)) {
    return { status: 400, error: `command must be one of ${Object.keys(COMMANDS).join(', ')}` };
  }
  const needs = COMMANDS[name];
  if (needs && !capabilities.includes(needs)) {
    return { status: 422, error: `this player does not support ${name}` };
  }
  const command = { command: name };
  switch (name) {
    case 'seek':
      if (!Number.isFinite(body.position_sec) || body.position_sec < 0) {
        return { status: 400, error: 'position_sec must be a non-negative number' };
      }
      command.position_sec = body.position_sec;
      break;
    case 'volume':
      if (!Number.isFinite(body.volume) || body.volume < 0 || body.volume > 100) {
        return { status: 400, error: 'volume must be a number between 0 and 100' };
      }
      command.volume = Math.round(body.volume);
      break;
    case 'mute':
    case 'shuffle':
      if (typeof body[name === 'mute' ? 'muted' : 'shuffle'] !== 'boolean') {
        return { status: 400, error: `${name === 'mute' ? 'muted' : 'shuffle'} must be a boolean` };
      }
      if (name === 'mute') command.muted = body.muted;
      else command.shuffle = body.shuffle;
      break;
    case 'repeat':
      if (!REPEAT_MODES.includes(body.repeat)) {
        return { status: 400, error: `repeat must be one of ${REPEAT_MODES.join(', ')}` };
      }
      command.repeat = body.repeat;
      break;
    case 'play_index':
      if (!Number.isInteger(body.index) || body.index < 0) {
        return { status: 400, error: 'index must be a non-negative integer' };
      }
      command.index = body.index;
      break;
    case 'play_media': {
      const { media, mode = 'replace' } = body;
      if (!MEDIA_TYPES.includes(media?.type)) {
        return { status: 400, error: `media.type must be one of ${MEDIA_TYPES.join(', ')}` };
      }
      const id = media.type === 'smart' ? String(media.id ?? '') : media.id;
      if (media.type === 'smart' ? !id : !Number.isInteger(id) || id <= 0) {
        return { status: 400, error: 'media.id is required (a positive integer, or the key of a smart playlist)' };
      }
      if (!PLAY_MODES.includes(mode)) {
        return { status: 400, error: `mode must be one of ${PLAY_MODES.join(', ')}` };
      }
      if (mode !== 'replace' && !capabilities.includes('append')) {
        return { status: 422, error: `this player does not support the ${mode} mode` };
      }
      command.media = { type: media.type, id };
      command.mode = mode;
      break;
    }
    default:
      break;
  }
  return { command };
}

// Picks the live fields out of a state report. Returns null when the report
// carries no playback_state (an older player: position ping only).
export function parseLiveState(body) {
  if (!PLAYBACK_STATES.includes(body?.playback_state)) return null;
  const state = { playback_state: body.playback_state };
  if (Number.isFinite(body.position_sec) && body.position_sec >= 0) state.position_sec = body.position_sec;
  if (Number.isFinite(body.duration_sec) && body.duration_sec >= 0) state.duration_sec = body.duration_sec;
  if (Number.isInteger(body.current_index)) state.current_index = body.current_index;
  if (Number.isInteger(body.track_id) && body.track_id > 0) state.track_id = body.track_id;
  if (Number.isFinite(body.volume)) state.volume = Math.min(100, Math.max(0, Math.round(body.volume)));
  if (typeof body.muted === 'boolean') state.muted = body.muted;
  if (typeof body.shuffle === 'boolean') state.shuffle = body.shuffle;
  if (REPEAT_MODES.includes(body.repeat)) state.repeat = body.repeat;
  return state;
}

// The registry. `now` and `resolveTrack` are injectable for the tests.
export function createRemoteRegistry({ now = () => Date.now(), resolveTrack = () => null } = {}) {
  const players = new Map(); // device_id -> { label, streams: [], state, reportedAt }
  const watchers = new Set();

  const entry = (deviceId) => {
    let player = players.get(deviceId);
    if (!player) {
      player = { label: null, streams: [], capabilities: [], state: null, reportedAt: 0 };
      players.set(deviceId, player);
    }
    return player;
  };

  const isListed = (player) =>
    player.streams.length > 0 || (player.state && now() - player.reportedAt < REPORT_TTL_MS);

  const describe = (deviceId, player) => {
    const stream = player.streams.at(-1);
    return {
      device_id: deviceId,
      device_label: player.label,
      controllable: Boolean(stream),
      capabilities: stream ? stream.capabilities : [],
      state: player.state && {
        ...player.state,
        reported_at: new Date(player.reportedAt).toISOString(),
      },
    };
  };

  const notify = (deviceId) => {
    const player = players.get(deviceId);
    const event = player && isListed(player)
      ? { event: 'device', data: describe(deviceId, player) }
      : { event: 'gone', data: { device_id: deviceId } };
    for (const watcher of watchers) watcher(event);
  };

  const prune = () => {
    for (const [deviceId, player] of players) {
      if (!isListed(player)) {
        players.delete(deviceId);
        if (player.state) notify(deviceId);
      }
    }
  };

  return {
    // send(event, data) writes on the stream, close() ends it; returns the
    // detach function, to call when the connection goes away.
    connect(deviceId, { label, capabilities, send, close }) {
      const player = entry(deviceId);
      if (label) player.label = label;
      const stream = { capabilities: parseCapabilities(capabilities), send, close };
      player.streams.push(stream);
      notify(deviceId);
      return () => {
        player.streams = player.streams.filter(s => s !== stream);
        notify(deviceId);
        prune();
      };
    },

    report(deviceId, state, { label } = {}) {
      const player = entry(deviceId);
      if (label) player.label = label;
      const track = state.track_id ? resolveTrack(state.track_id) : null;
      player.state = { ...state, track };
      player.reportedAt = now();
      notify(deviceId);
    },

    list() {
      prune();
      return [...players].map(([id, player]) => describe(id, player));
    },

    get(deviceId) {
      prune();
      const player = players.get(deviceId);
      return player && isListed(player) ? describe(deviceId, player) : null;
    },

    // Returns { id } once written, or { status, error }. Commands go to the
    // most recent stream only: two tabs of the web app must not both play.
    // check(command) may refuse a valid command (an unknown album…) with
    // { status, error }.
    send(deviceId, body, { check } = {}) {
      const stream = players.get(deviceId)?.streams.at(-1);
      if (!stream) return { status: 404, error: 'this player is not connected or does not allow remote control' };
      const { command, status, error } = validateCommand(body, stream.capabilities);
      if (error) return { status, error };
      const refused = check?.(command);
      if (refused) return refused;
      const id = randomUUID();
      stream.send('command', { id, ...command });
      return { id };
    },

    watch(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },

    prune,

    // Closing the server: end every stream so app.close() does not wait for them.
    closeAll() {
      for (const player of players.values()) {
        for (const stream of player.streams) stream.close?.();
      }
      players.clear();
      watchers.clear();
    },
  };
}
