import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getReplayGainMode, setReplayGainMode, replayGainFactor } from '../utils/replayGain.js';

beforeEach(() => localStorage.clear());

describe('replayGainFactor', () => {
  const rg = { track_gain: -6.0206, track_peak: 0.9, album_gain: -12.0412, album_peak: 0.95 };

  it('turns the chosen gain into a volume multiplier', () => {
    expect(replayGainFactor(rg, 'track')).toBeCloseTo(0.5, 3);
    expect(replayGainFactor(rg, 'album')).toBeCloseTo(0.25, 3);
  });

  it('falls back on the other gain when one is missing', () => {
    expect(replayGainFactor({ track_gain: -6.0206, album_gain: null }, 'album')).toBeCloseTo(0.5, 3);
    expect(replayGainFactor({ track_gain: null, album_gain: -6.0206 }, 'track')).toBeCloseTo(0.5, 3);
  });

  it('never goes above full volume', () => {
    expect(replayGainFactor({ track_gain: 4, album_gain: 3 }, 'album')).toBe(1);
  });

  it('is neutral when off or untagged', () => {
    expect(replayGainFactor(rg, 'off')).toBe(1);
    expect(replayGainFactor(null, 'album')).toBe(1);
    expect(replayGainFactor(undefined, 'track')).toBe(1);
    expect(replayGainFactor({ track_gain: null, album_gain: null }, 'album')).toBe(1);
  });
});

describe('ReplayGain setting', () => {
  it('defaults to album', () => {
    expect(getReplayGainMode()).toBe('album');
    localStorage.setItem('jewelbox-replaygain', 'bogus');
    expect(getReplayGainMode()).toBe('album');
  });

  it('saves the mode and tells the player', () => {
    const listener = vi.fn();
    window.addEventListener('jewelbox-replaygain', listener);
    setReplayGainMode('track');
    expect(getReplayGainMode()).toBe('track');
    expect(listener.mock.calls[0][0].detail).toBe('track');
    setReplayGainMode('bogus');
    expect(getReplayGainMode()).toBe('track');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('jewelbox-replaygain', listener);
  });
});
