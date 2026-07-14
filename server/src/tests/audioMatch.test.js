import { describe, it, expect } from 'vitest';
import {
  normalize,
  parsePathFallback,
  buildAlbumIndex,
  matchAlbum,
  matchTrack,
  matchFolderTracks,
} from '../utils/audioMatch.js';

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize('Abbey Road!')).toBe('abbey road');
    expect(normalize("What's Going On")).toBe('what s going on');
  });

  it('removes diacritics', () => {
    expect(normalize('Café Bleu')).toBe('cafe bleu');
    expect(normalize('Mylène Farmer')).toBe('mylene farmer');
  });

  it('strips leading articles', () => {
    expect(normalize('The Wall')).toBe('wall');
    expect(normalize('Les Paradis Perdus')).toBe('paradis perdus');
    expect(normalize("L'Impératrice")).toBe('imperatrice');
  });

  it('strips parenthesized edition suffixes', () => {
    expect(normalize('Abbey Road (Remastered 2019)')).toBe('abbey road');
    expect(normalize('OK Computer [Deluxe Edition]')).toBe('ok computer');
    expect(normalize('Help! (2009 Stereo Remaster)')).toBe('help');
  });

  it('keeps regular parentheses that are part of the title', () => {
    expect(normalize('(What\'s the Story) Morning Glory?')).toBe('what s the story morning glory');
  });

  it('handles empty and nullish input', () => {
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('parsePathFallback', () => {
  it('parses Artist/Album/NN - Title.ext', () => {
    expect(parsePathFallback('The Beatles/Abbey Road/03 - Come Together.flac')).toEqual({
      artist: 'The Beatles',
      album: 'Abbey Road',
      trackNo: 3,
      title: 'Come Together',
    });
  });

  it('parses dot and underscore separators', () => {
    expect(parsePathFallback('Artist/Album/3. Titre.mp3').trackNo).toBe(3);
    expect(parsePathFallback('Artist/Album/03_Titre.mp3')).toMatchObject({ trackNo: 3, title: 'Titre' });
  });

  it('handles files without a track number', () => {
    expect(parsePathFallback('Artist/Album/Interlude.ogg')).toMatchObject({
      trackNo: null,
      title: 'Interlude',
    });
  });

  it('handles shallow paths', () => {
    expect(parsePathFallback('01 - Song.mp3')).toMatchObject({ artist: null, album: null, trackNo: 1 });
    expect(parsePathFallback('Album/01 - Song.mp3')).toMatchObject({ artist: null, album: 'Album' });
  });

  it('handles deeper paths by using the two closest folders', () => {
    expect(parsePathFallback('Rock/The Beatles/Abbey Road/01 - Come Together.mp3')).toMatchObject({
      artist: 'The Beatles',
      album: 'Abbey Road',
    });
  });
});

describe('matchAlbum', () => {
  const albums = [
    { id: 1, title: 'Abbey Road', artist_name: 'The Beatles', tracks: [] },
    { id: 2, title: 'The Wall', artist_name: 'Pink Floyd', tracks: [] },
    { id: 3, title: 'Discovery', artist_name: 'Daft Punk', tracks: [] },
  ];
  const index = buildAlbumIndex(albums);

  it('matches exact normalized artist + title', () => {
    expect(matchAlbum(index, 'the beatles', 'ABBEY ROAD')?.id).toBe(1);
    expect(matchAlbum(index, 'Pink Floyd', 'Wall')?.id).toBe(2);
  });

  it('matches despite edition suffix in file tags', () => {
    expect(matchAlbum(index, 'The Beatles', 'Abbey Road (Remastered 2019)')?.id).toBe(1);
  });

  it('falls back to bidirectional includes on same artist', () => {
    expect(matchAlbum(index, 'Daft Punk', 'Discovery (Bonus Track)')?.id).toBe(3);
  });

  it('returns null when artist or album is unknown', () => {
    expect(matchAlbum(index, 'Unknown Artist', 'Abbey Road')).toBeNull();
    expect(matchAlbum(index, 'The Beatles', 'Let It Be')).toBeNull();
    expect(matchAlbum(index, null, 'Abbey Road')).toBeNull();
    expect(matchAlbum(index, 'The Beatles', null)).toBeNull();
  });
});

describe('matchTrack', () => {
  const album = {
    tracks: [
      { id: 11, position: 1, title: 'Come Together' },
      { id: 12, position: 2, title: 'Something' },
      { id: 13, position: 3, title: "Maxwell's Silver Hammer" },
    ],
  };

  it('matches by track number first', () => {
    expect(matchTrack(album, 2, 'Whatever')?.id).toBe(12);
  });

  it('matches by normalized title when number is missing', () => {
    expect(matchTrack(album, null, 'come together')?.id).toBe(11);
    expect(matchTrack(album, null, "Maxwell’s Silver Hammer")?.id).toBe(13);
  });

  it('matches by bidirectional includes as a last resort', () => {
    expect(matchTrack(album, null, 'Something (Live)')?.id).toBe(12);
  });

  it('returns null when nothing matches', () => {
    expect(matchTrack(album, 99, 'Unknown Song')).toBeNull();
    expect(matchTrack(album, null, null)).toBeNull();
    expect(matchTrack({ tracks: [] }, 1, 'Anything')).toBeNull();
  });
});

describe('matchFolderTracks', () => {
  const tracks = [
    { id: 21, position: 1, title: 'Intro' },
    { id: 22, position: 2, title: 'Deuxième Piste' },
    { id: 23, position: 3, title: 'Outro' },
  ];

  it('matches files by track number then title', () => {
    const files = [
      { relPath: 'Album/02 - Deuxieme Piste.mp3', trackNo: 2, title: 'Deuxieme Piste' },
      { relPath: 'Album/01 - Intro.mp3', trackNo: 1, title: 'Intro' },
    ];
    const entries = matchFolderTracks(tracks, files);
    expect(entries).toContainEqual({ trackId: 21, filePath: 'Album/01 - Intro.mp3' });
    expect(entries).toContainEqual({ trackId: 22, filePath: 'Album/02 - Deuxieme Piste.mp3' });
  });

  it('falls back to alphabetical order vs position for unmatched files', () => {
    const files = [
      { relPath: 'Album/b.mp3', trackNo: null, title: 'b' },
      { relPath: 'Album/a.mp3', trackNo: null, title: 'a' },
      { relPath: 'Album/c.mp3', trackNo: null, title: 'c' },
    ];
    const entries = matchFolderTracks(tracks, files);
    expect(entries).toEqual([
      { trackId: 21, filePath: 'Album/a.mp3' },
      { trackId: 22, filePath: 'Album/b.mp3' },
      { trackId: 23, filePath: 'Album/c.mp3' },
    ]);
  });

  it('does not assign the same track twice', () => {
    const files = [
      { relPath: 'Album/01 - Intro.mp3', trackNo: 1, title: 'Intro' },
      { relPath: 'Album/01 - Intro (copy).mp3', trackNo: 1, title: 'Intro' },
    ];
    const entries = matchFolderTracks(tracks, files);
    const trackIds = entries.map(e => e.trackId);
    expect(new Set(trackIds).size).toBe(trackIds.length);
  });

  it('handles more files than tracks', () => {
    const files = [
      { relPath: 'Album/a.mp3', trackNo: null, title: 'a' },
      { relPath: 'Album/b.mp3', trackNo: null, title: 'b' },
      { relPath: 'Album/c.mp3', trackNo: null, title: 'c' },
      { relPath: 'Album/d.mp3', trackNo: null, title: 'd' },
    ];
    const entries = matchFolderTracks(tracks, files);
    expect(entries).toHaveLength(3);
  });
});
