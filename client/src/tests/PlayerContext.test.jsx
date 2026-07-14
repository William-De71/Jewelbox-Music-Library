import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';

// Mock the API so no real network happens
vi.mock('../api/client.js', () => ({
  api: {
    trackStreamUrl: (id) => `/api/player/tracks/${id}/stream`,
    lastfmNowPlaying: vi.fn(() => Promise.resolve()),
    lastfmScrobble: vi.fn(() => Promise.resolve()),
    trackPlayed: vi.fn(() => Promise.resolve()),
    setTrackFavorite: vi.fn(() => Promise.resolve()),
    getSmartPlaylist: vi.fn(() => Promise.resolve({ tracks: [] })),
    getAlbum: vi.fn(),
  },
}));

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
