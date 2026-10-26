import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';

// Same Proxy mock as PlayerContext.test.jsx: the reads are spelled out, every
// fire-and-forget write is a resolved spy.
vi.mock('../api/client.js', () => {
  const explicit = {
    trackStreamUrl: (id) => `/api/player/tracks/${id}/stream`,
    getAlbum: vi.fn(),
    getPlaylist: vi.fn(),
    getTrack: vi.fn(),
    getRadio: vi.fn(),
    getSmartPlaylist: vi.fn(() => Promise.resolve({ tracks: [] })),
    getQueue: vi.fn(() => Promise.resolve({ tracks: [], current_index: -1, position_sec: 0 })),
  };
  return {
    api: new Proxy(explicit, {
      get(target, prop) {
        if (prop in target) return target[prop];
        target[prop] = vi.fn(() => Promise.resolve());
        return target[prop];
      },
    }),
  };
});

import { api } from '../api/client.js';
import { PlayerProvider, usePlayer } from '../components/PlayerContext.jsx';
import {
  createLiveReporter,
  liveStateOf,
  remoteEventsUrl,
  setRemoteControlEnabled,
  isRemoteControlEnabled,
  HEARTBEAT_MS,
} from '../utils/remoteControl.js';

class FakeAudio {
  constructor() {
    this.listeners = {};
    this.src = '';
    this.currentTime = 0;
    this.duration = 200;
    this.paused = true;
    this.volume = 1;
    this.muted = false;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  emit(type) { (this.listeners[type] || []).forEach(fn => fn()); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  removeAttribute() {}
  load() {}
}

class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, data) { (this.listeners[type] || []).forEach(fn => fn({ data: JSON.stringify(data) })); }
  close() { this.closed = true; }
}

const TRACKS = [
  { id: 1, title: 'One', has_file: true, album_id: 1, album_title: 'A', artist_name: 'X', cover_url: null },
  { id: 2, title: 'Two', has_file: true, album_id: 1, album_title: 'A', artist_name: 'X', cover_url: null },
];

let fakeAudio;
beforeEach(() => {
  fakeAudio = new FakeAudio();
  global.Audio = vi.fn(() => fakeAudio);
  FakeEventSource.instances = [];
  global.EventSource = FakeEventSource;
  localStorage.clear();
  api.reportLiveState.mockClear();
});

afterEach(() => {
  delete global.EventSource;
});

function harness() {
  const ref = {};
  function Probe() {
    const player = usePlayer();
    useEffect(() => { ref.player = player; });
    return null;
  }
  render(<PlayerProvider><Probe /></PlayerProvider>);
  return ref;
}

const stream = () => FakeEventSource.instances.at(-1);
const send = async (command) => {
  await act(async () => { stream().emit('command', command); });
  await act(async () => {}); // let an async command (play_media) settle
};

describe('liveStateOf', () => {
  it('describes a playing track', () => {
    expect(liveStateOf({
      current: TRACKS[1], index: 1, playing: true, currentTime: 12.34, duration: 200,
      volume: 0.5, muted: false, shuffle: true, repeat: 'all',
    })).toEqual({
      playback_state: 'playing', track_id: 2, current_index: 1, position_sec: 12.3, duration_sec: 200,
      volume: 50, muted: false, shuffle: true, repeat: 'all',
    });
  });

  it('is idle without a track', () => {
    expect(liveStateOf({ current: null, index: -1, playing: false, currentTime: 0, duration: NaN, volume: 1, repeat: 'off' }))
      .toMatchObject({ playback_state: 'idle', current_index: -1, duration_sec: 0 });
  });
});

describe('createLiveReporter', () => {
  const live = (changes = {}) => ({
    playback_state: 'playing', track_id: 1, current_index: 0, position_sec: 10, duration_sec: 200,
    volume: 100, muted: false, shuffle: false, repeat: 'off', ...changes,
  });

  it('reports the first state, then changes only', () => {
    const reporter = createLiveReporter();
    expect(reporter.update(live(), 0)).toBe(true);
    expect(reporter.update(live({ position_sec: 11 }), 1000)).toBe(false);
    expect(reporter.update(live({ position_sec: 11, playback_state: 'paused' }), 1100)).toBe(true);
    expect(reporter.update(live({ position_sec: 11, playback_state: 'paused', volume: 30 }), 1200)).toBe(true);
  });

  it('reports a seek and a heartbeat while playing', () => {
    const reporter = createLiveReporter();
    reporter.update(live({ position_sec: 0 }), 0);
    expect(reporter.update(live({ position_sec: 50 }), 1000)).toBe(true);
    expect(reporter.update(live({ position_sec: 50 + HEARTBEAT_MS / 1000 - 1 }), HEARTBEAT_MS - 1000 + 1000)).toBe(false);
    expect(reporter.update(live({ position_sec: 50 + HEARTBEAT_MS / 1000 }), HEARTBEAT_MS + 1000)).toBe(true);
  });

  it('reports again after forget', () => {
    const reporter = createLiveReporter();
    reporter.update(live(), 0);
    reporter.forget();
    expect(reporter.update(live(), 1)).toBe(true);
  });
});

describe('remote control setting', () => {
  it('is on by default and can be turned off', () => {
    expect(isRemoteControlEnabled()).toBe(true);
    setRemoteControlEnabled(false);
    expect(isRemoteControlEnabled()).toBe(false);
  });

  it('names the device and its capabilities in the stream url', () => {
    const url = new URL(remoteEventsUrl(), 'http://x');
    expect(url.pathname).toBe('/api/player/remote/events');
    expect(url.searchParams.get('device_id')).toBeTruthy();
    expect(url.searchParams.get('capabilities').split(',')).toContain('play_media');
  });
});

describe('PlayerContext remote control', () => {
  it('opens the stream, and closes it when the setting is turned off', async () => {
    harness();
    await act(async () => {});
    expect(stream().url).toMatch(/\/api\/player\/remote\/events\?device_id=/);
    await act(async () => { setRemoteControlEnabled(false); });
    expect(stream().closed).toBe(true);
    await act(async () => { setRemoteControlEnabled(true); });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(stream().closed).toBe(false);
  });

  it('does not open the stream when the setting is off', async () => {
    localStorage.setItem('jewelbox-remote-control', '0');
    harness();
    await act(async () => {});
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('runs the transport commands', async () => {
    const ref = harness();
    await act(async () => { ref.player.playTracks(TRACKS, 0); });
    expect(fakeAudio.paused).toBe(false);

    await send({ command: 'pause' });
    expect(fakeAudio.paused).toBe(true);
    await send({ command: 'play' });
    expect(fakeAudio.paused).toBe(false);
    await send({ command: 'next' });
    expect(fakeAudio.src).toContain('/tracks/2/stream');
    await send({ command: 'seek', position_sec: 42 });
    expect(fakeAudio.currentTime).toBe(42);
    await send({ command: 'volume', volume: 25 });
    expect(fakeAudio.volume).toBe(0.25);
    await send({ command: 'mute', muted: true });
    expect(fakeAudio.muted).toBe(true);
    await send({ command: 'repeat', repeat: 'one' });
    expect(ref.player.repeat).toBe('one');
    await send({ command: 'shuffle', shuffle: true });
    expect(ref.player.shuffle).toBe(true);
    await send({ command: 'shuffle', shuffle: true });
    expect(ref.player.shuffle).toBe(true);
  });

  it('plays the current queue index without restarting it', async () => {
    const ref = harness();
    await act(async () => { ref.player.playTracks(TRACKS, 0); });
    await act(async () => { fakeAudio.pause(); fakeAudio.currentTime = 30; });
    await send({ command: 'play_index', index: 0 });
    expect(fakeAudio.paused).toBe(false);
    expect(fakeAudio.currentTime).toBe(30);
    await send({ command: 'play_index', index: 1 });
    expect(fakeAudio.src).toContain('/tracks/2/stream');
  });

  it('plays an album, or queues it behind the current track', async () => {
    api.getAlbum.mockResolvedValue({
      id: 9, title: 'B', cover_url: null, artist: { name: 'Y' },
      tracks: [{ id: 21, title: 'Bee', has_file: true }, { id: 22, title: 'Bop', has_file: true }],
    });
    const ref = harness();
    await act(async () => {});
    // nothing loaded: "next" starts the album
    await send({ command: 'play_media', media: { type: 'album', id: 9 }, mode: 'next' });
    expect(fakeAudio.src).toContain('/tracks/21/stream');

    await act(async () => { ref.player.playTracks(TRACKS, 0); });
    await send({ command: 'play_media', media: { type: 'album', id: 9 }, mode: 'next' });
    expect(ref.player.queue.map(t => t.id)).toEqual([1, 21, 22, 2]);
    await send({ command: 'play_media', media: { type: 'album', id: 9 }, mode: 'append' });
    expect(ref.player.queue.map(t => t.id)).toEqual([1, 21, 22, 2, 21, 22]);
    expect(fakeAudio.src).toContain('/tracks/1/stream');
  });

  it('plays a track, a playlist and a radio', async () => {
    api.getTrack.mockResolvedValue({ ...TRACKS[1] });
    api.getPlaylist.mockResolvedValue({ id: 3, name: 'P', tracks: [TRACKS[0]] });
    api.getRadio.mockResolvedValue({ seed: {}, tracks: [TRACKS[1], TRACKS[0]] });
    harness();
    await act(async () => {});
    await send({ command: 'play_media', media: { type: 'track', id: 2 }, mode: 'replace' });
    expect(api.getTrack).toHaveBeenCalledWith(2);
    expect(fakeAudio.src).toContain('/tracks/2/stream');
    await send({ command: 'play_media', media: { type: 'playlist', id: 3 }, mode: 'replace' });
    expect(fakeAudio.src).toContain('/tracks/1/stream');
    await send({ command: 'play_media', media: { type: 'artist_radio', id: 5 }, mode: 'replace' });
    expect(api.getRadio).toHaveBeenCalledWith({ artist_id: 5 });
    expect(fakeAudio.src).toContain('/tracks/2/stream');
  });

  it('reports the live state on changes, and again when the stream opens', async () => {
    const ref = harness();
    await act(async () => { ref.player.playTracks(TRACKS, 0); });
    const last = () => api.reportLiveState.mock.calls.at(-1)[0];
    expect(last()).toMatchObject({ playback_state: 'playing', track_id: 1, current_index: 0 });

    await act(async () => { fakeAudio.pause(); });
    expect(last()).toMatchObject({ playback_state: 'paused' });
    const count = api.reportLiveState.mock.calls.length;
    await act(async () => { stream().emit('hello', { device_id: 'x' }); });
    expect(api.reportLiveState.mock.calls.length).toBe(count + 1);
    expect(last().device_label).toBeTruthy();
  });
});
