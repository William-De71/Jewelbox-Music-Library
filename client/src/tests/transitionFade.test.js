import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  followsOnAlbum, getTransitionFade, setTransitionFade, transitionFadeFactor,
} from '../utils/transitionFade.js';

beforeEach(() => localStorage.clear());

describe('transitionFadeFactor', () => {
  it('rises at the start and falls at the end of a track', () => {
    const base = { duration: 200, fade: 4 };
    expect(transitionFadeFactor({ ...base, time: 0 })).toBe(0);
    expect(transitionFadeFactor({ ...base, time: 2 })).toBe(0.5);
    expect(transitionFadeFactor({ ...base, time: 100 })).toBe(1);
    expect(transitionFadeFactor({ ...base, time: 199 })).toBe(0.25);
    expect(transitionFadeFactor({ ...base, time: 205 })).toBe(0);
  });

  it('only on the allowed side, never when off or on a very short track', () => {
    expect(transitionFadeFactor({ time: 0, duration: 200, fade: 4, fadeIn: false })).toBe(1);
    expect(transitionFadeFactor({ time: 199, duration: 200, fade: 4, fadeOut: false })).toBe(1);
    expect(transitionFadeFactor({ time: 0, duration: 200, fade: 0 })).toBe(1);
    expect(transitionFadeFactor({ time: 6, duration: 7, fade: 4 })).toBe(1);
    expect(transitionFadeFactor({ time: 50, duration: NaN, fade: 4 })).toBe(1);
  });
});

describe('followsOnAlbum', () => {
  it('is true for consecutive tracks of the same album only', () => {
    expect(followsOnAlbum({ album_id: 1, position: 3 }, { album_id: 1, position: 4 })).toBe(true);
    expect(followsOnAlbum({ album_id: 1, position: 3 }, { album_id: 1, position: 5 })).toBe(false);
    expect(followsOnAlbum({ album_id: 1, position: 3 }, { album_id: 2, position: 4 })).toBe(false);
    expect(followsOnAlbum(null, { album_id: 1, position: 1 })).toBe(false);
  });
});

describe('setting', () => {
  it('is off by default, saved and announced', () => {
    expect(getTransitionFade()).toBe(0);
    const listener = vi.fn();
    window.addEventListener('jewelbox-transition-fade', listener);
    setTransitionFade(6);
    setTransitionFade(5);
    expect(getTransitionFade()).toBe(6);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('jewelbox-transition-fade', listener);
  });
});
