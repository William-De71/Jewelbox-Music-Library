import { describe, it, expect } from 'vitest';
import { sleepTimerFrom, sleepFadeFactor, sleepTimerLive, SLEEP_FADE_MS } from '../utils/sleepTimer.js';

describe('sleepTimerFrom', () => {
  it('reads the remote command shape', () => {
    expect(sleepTimerFrom({ minutes: 30 }, 1000)).toEqual({ endsAt: 1000 + 30 * 60000 });
    expect(sleepTimerFrom({ end_of_track: true }, 1000)).toEqual({ endOfTrack: true });
    expect(sleepTimerFrom({ minutes: 0 }, 1000)).toBeNull();
    expect(sleepTimerFrom(null, 1000)).toBeNull();
  });
});

describe('sleepFadeFactor', () => {
  const timer = { endsAt: 100000 };
  it('stays at 1 until the fade, then goes down to 0', () => {
    expect(sleepFadeFactor(timer, 100000 - SLEEP_FADE_MS - 1)).toBe(1);
    expect(sleepFadeFactor(timer, 100000 - SLEEP_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(sleepFadeFactor(timer, 100001)).toBe(0);
  });
  it('never fades for no timer or end of track', () => {
    expect(sleepFadeFactor(null, 0)).toBe(1);
    expect(sleepFadeFactor({ endOfTrack: true }, 0)).toBe(1);
  });
});

describe('sleepTimerLive', () => {
  it('gives the reported shape', () => {
    expect(sleepTimerLive(null)).toBeNull();
    expect(sleepTimerLive({ endOfTrack: true })).toEqual({ end_of_track: true });
    expect(sleepTimerLive({ endsAt: 0 })).toEqual({ ends_at: '1970-01-01T00:00:00.000Z' });
  });
});
