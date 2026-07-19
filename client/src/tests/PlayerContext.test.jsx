import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';

// Mock the API so no real network happens.
//
// Only methods whose return value the player actually reads are spelled out
// here. Everything else — the fire-and-forget writes (scrobbles, queue syncs,
// play counts) — is served by the Proxy below as a resolved promise.
//
// This is deliberate: an exhaustive list breaks every test in this file the
// day PlayerContext calls one more endpoint, with a TypeError that points at
// the mock rather than at whatever the test was checking. The trade-off is
// that a typo'd method name no longer fails here; the build and real usage
// surface those immediately.
vi.mock('../api/client.js', () => {
  const explicit = {
    trackStreamUrl: (id) => `/api/player/tracks/${id}/stream`,
    getAlbum: vi.fn(),
    getSmartPlaylist: vi.fn(() => Promise.resolve({ tracks: [] })),
    dynamicMixPlayed: vi.fn(() => Promise.resolve({ tracks: [] })),
    dynamicMixRemove: vi.fn(() => Promise.resolve({ tracks: [] })),
    dynamicMixRefresh: vi.fn(() => Promise.resolve({ tracks: [] })),
    // Empty queue by default: tests start from a clean player.
    getQueue: vi.fn(() => Promise.resolve({ tracks: [], current_index: -1, position_sec: 0 })),
  };

  return {
    api: new Proxy(explicit, {
      get(target, prop) {
        if (prop in target) return target[prop];
        // Cached so a test can assert on the same spy it just triggered.
        target[prop] = vi.fn(() => Promise.resolve());
        return target[prop];
      },
    }),
  };
});

// Fake Audio element capturing listeners and src
class FakeAudio {
  constructor() {
    this.listeners = {};
    this.src = '';
    this.currentTime = 0;
    this.duration = 200;
    this.paused = true;
    this.volume = 1;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  emit(type) { (this.listeners[type] || []).forEach(fn => fn()); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  removeAttribute() {}
  load() {}
}

let fakeAudio;
beforeEach(() => {
  fakeAudio = new FakeAudio();
  global.Audio = vi.fn(() => fakeAudio);
  localStorage.clear();
});

import { PlayerProvider, usePlayer } from '../components/PlayerContext.jsx';

const TRACKS = [
  { id: 1, title: 'One', has_file: true, album_id: 1, album_title: 'A', artist_name: 'X', cover_url: null },
  { id: 2, title: 'Two', has_file: true, album_id: 1, album_title: 'A', artist_name: 'X', cover_url: null },
  { id: 3, title: 'Three', has_file: true, album_id: 1, album_title: 'A', artist_name: 'X', cover_url: null },
];

function harness(onReady) {
  function Probe() {
    const player = usePlayer();
    useEffect(() => { onReady(player); });
    return null;
  }
  render(<PlayerProvider><Probe /></PlayerProvider>);
}

describe('PlayerContext queue advance', () => {
  it('advances to the next track when the current one ends', async () => {
    let player;
    harness((p) => { player = p; });

    await act(async () => { player.playTracks(TRACKS, 0); });
    expect(fakeAudio.src).toContain('/tracks/1/stream');

    // Simulate the first track finishing
    await act(async () => { fakeAudio.emit('ended'); });
    expect(fakeAudio.src).toContain('/tracks/2/stream');

    await act(async () => { fakeAudio.emit('ended'); });
    expect(fakeAudio.src).toContain('/tracks/3/stream');
  });

  it('advances after a play threshold was reached (timeupdate then ended)', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });

    // Simulate playback progress crossing the scrobble/played threshold
    await act(async () => {
      fakeAudio.duration = 100;
      fakeAudio.currentTime = 60;
      fakeAudio.emit('timeupdate');
    });
    await act(async () => { fakeAudio.emit('ended'); });
    expect(fakeAudio.src).toContain('/tracks/2/stream');
  });

  it('repeats the same track when repeat=one is persisted', async () => {
    localStorage.setItem('jewelbox-repeat', 'one');
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });
    expect(fakeAudio.src).toContain('/tracks/1/stream');
    await act(async () => { fakeAudio.emit('ended'); });
    // stays on track 1
    expect(fakeAudio.src).toContain('/tracks/1/stream');
  });

  it('advances through the whole shuffled queue without stopping early', async () => {
    localStorage.setItem('jewelbox-shuffle', '1');
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });

    const played = [fakeAudio.src.match(/tracks\/(\d)/)[1]];
    // Advance until playback stops
    for (let n = 0; n < 5; n++) {
      const before = fakeAudio.src;
      await act(async () => { fakeAudio.emit('ended'); });
      if (fakeAudio.src === before) break;
      played.push(fakeAudio.src.match(/tracks\/(\d)/)[1]);
    }
    // Must have played all 3 distinct tracks
    expect(new Set(played).size).toBe(3);
  });

  it('keeps advancing after shuffle is toggled ON mid-playback', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); }); // no shuffle yet
    await act(async () => { player.toggleShuffle(); });       // turn shuffle ON while playing
    const played = [fakeAudio.src.match(/tracks\/(\d)/)[1]];
    for (let n = 0; n < 5; n++) {
      const before = fakeAudio.src;
      await act(async () => { fakeAudio.emit('ended'); });
      if (fakeAudio.src === before) break;
      played.push(fakeAudio.src.match(/tracks\/(\d)/)[1]);
    }
    expect(new Set(played).size).toBe(3);
  });

  it('keeps advancing after shuffle toggled ON then OFF mid-playback', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });
    await act(async () => { player.toggleShuffle(); });
    await act(async () => { player.toggleShuffle(); }); // back to original order
    const played = [fakeAudio.src.match(/tracks\/(\d)/)[1]];
    for (let n = 0; n < 5; n++) {
      const before = fakeAudio.src;
      await act(async () => { fakeAudio.emit('ended'); });
      if (fakeAudio.src === before) break;
      played.push(fakeAudio.src.match(/tracks\/(\d)/)[1]);
    }
    expect(new Set(played).size).toBe(3);
  });

  it('stops (no wrap) at the end when repeat is off', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 2); });
    expect(fakeAudio.src).toContain('/tracks/3/stream');
    await act(async () => { fakeAudio.emit('ended'); });
    // still on track 3, playback flagged stopped
    expect(fakeAudio.src).toContain('/tracks/3/stream');
  });
});

describe('PlayerContext queue editing', () => {
  it('appends tracks at the end with addToQueue', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS.slice(0, 2), 0); });

    await act(async () => { player.addToQueue(TRACKS[2]); });
    expect(player.queue.map(t => t.id)).toEqual([1, 2, 3]);
    expect(player.index).toBe(0); // playback untouched
    expect(fakeAudio.src).toContain('/tracks/1/stream');
  });

  it('inserts right behind the current track with playNext', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks([TRACKS[0], TRACKS[1]], 0); });

    await act(async () => { player.playNext(TRACKS[2]); });
    expect(player.queue.map(t => t.id)).toEqual([1, 3, 2]);
    expect(player.index).toBe(0);
  });

  it('removes a track after the current one without disturbing playback', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });

    await act(async () => { player.removeFromQueue(2); });
    expect(player.queue.map(t => t.id)).toEqual([1, 2]);
    expect(player.index).toBe(0);
    expect(fakeAudio.src).toContain('/tracks/1/stream');
  });

  it('shifts the index when removing a track before the current one', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 2); });

    await act(async () => { player.removeFromQueue(0); });
    expect(player.queue.map(t => t.id)).toEqual([2, 3]);
    expect(player.index).toBe(1); // still on track 3
    expect(fakeAudio.src).toContain('/tracks/3/stream');
  });

  it('skips to the replacement when removing the playing track', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });

    await act(async () => { player.removeFromQueue(0); });
    expect(player.queue.map(t => t.id)).toEqual([2, 3]);
    expect(fakeAudio.src).toContain('/tracks/2/stream');
  });

  it('reorders without interrupting the playing track', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });

    await act(async () => { player.moveInQueue(2, 0); });
    expect(player.queue.map(t => t.id)).toEqual([3, 1, 2]);
    expect(player.index).toBe(1); // followed track 1
    expect(fakeAudio.src).toContain('/tracks/1/stream');
  });

  // Regression: the pre-shuffle order must forget removed tracks, otherwise
  // turning shuffle off brings them back from the dead.
  it('does not resurrect a removed track when shuffle is turned off', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });

    await act(async () => { player.toggleShuffle(); });
    await act(async () => {
      const pos = player.queue.findIndex(t => t.id === 3);
      player.removeFromQueue(pos);
    });
    await act(async () => { player.toggleShuffle(); });

    expect(player.queue.map(t => t.id).sort()).toEqual([1, 2]);
  });

  // Same guarantee in the other direction: additions survive a shuffle round-trip.
  it('keeps queued additions when shuffle is toggled off', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks([TRACKS[0]], 0); });

    await act(async () => { player.toggleShuffle(); });
    await act(async () => { player.addToQueue(TRACKS[1]); });
    await act(async () => { player.toggleShuffle(); });

    expect(player.queue.map(t => t.id).sort()).toEqual([1, 2]);
  });

  it('empties the player with clearQueue', async () => {
    let player;
    harness((p) => { player = p; });
    await act(async () => { player.playTracks(TRACKS, 0); });

    await act(async () => { player.clearQueue(); });
    expect(player.queue).toEqual([]);
    expect(player.current).toBeNull();
  });
});
