import { describe, it, expect } from 'vitest';
import { coverSource } from '../utils/coverSource.js';

describe('coverSource', () => {
  it('recognises Discogs and its image hosts', () => {
    expect(coverSource('https://www.discogs.com/release/1')).toBe('Discogs');
    expect(coverSource('https://i.discogs.com/cover.jpg')).toBe('Discogs');
    expect(coverSource('https://DISCOGS.com/x')).toBe('Discogs');
  });

  it('recognises Cover Art Archive', () => {
    expect(coverSource('https://coverartarchive.org/release/123/front')).toBe('MusicBrainz');
  });

  it('ignores a URL that only mentions these names', () => {
    expect(coverSource('http://192.168.1.1/?discogs.com')).toBeNull();
    expect(coverSource('https://evil.example/discogs.com/cover.jpg')).toBeNull();
    expect(coverSource('https://discogs.com.evil.example/cover.jpg')).toBeNull();
    expect(coverSource('https://notdiscogs.com/cover.jpg')).toBeNull();
  });

  it('ignores local paths, other schemes and empty values', () => {
    expect(coverSource('/covers/abc.jpg')).toBeNull();
    expect(coverSource('ftp://discogs.com/cover.jpg')).toBeNull();
    expect(coverSource('')).toBeNull();
    expect(coverSource(null)).toBeNull();
  });
});
