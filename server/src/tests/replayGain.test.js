import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { getDb } from '../db/database.js';
import {
  setTrackFilePaths,
  clearAllFilePaths,
  setAlbumAudioFolder,
  getAlbumById,
  getLiveTrack,
} from '../db/queries.js';
import { replayGainOf } from '../utils/audioScanner.js';

let db;
let albumId;
let trackIds;

const RG = { trackGain: -7.5, trackPeak: 0.98, albumGain: -8.1, albumPeak: 1.02 };

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  getDb.mockReturnValue(db);
  const artistId = db.prepare("INSERT INTO artists (name) VALUES ('Radiohead')").run().lastInsertRowid;
  albumId = db.prepare("INSERT INTO albums (title, artist_id) VALUES ('OK Computer', ?)").run(artistId).lastInsertRowid;
  const insert = db.prepare('INSERT INTO tracks (album_id, position, title) VALUES (?, ?, ?)');
  trackIds = [
    insert.run(albumId, 1, 'Airbag').lastInsertRowid,
    insert.run(albumId, 2, 'Paranoid Android').lastInsertRowid,
  ];
});

describe('replayGainOf', () => {
  it('keeps gains in dB and peaks as linear ratios', () => {
    expect(replayGainOf({
      replaygain_track_gain: { dB: -7.5, ratio: 0.42 },
      replaygain_track_peak: { dB: -0.17, ratio: 0.98 },
      replaygain_album_gain: { dB: -8.1, ratio: 0.39 },
      replaygain_album_peak: { dB: 0.17, ratio: 1.02 },
    })).toEqual(RG);
  });

  it('gives nulls for a file without tags', () => {
    expect(replayGainOf({})).toEqual({ trackGain: null, trackPeak: null, albumGain: null, albumPeak: null });
    expect(replayGainOf(undefined).trackGain).toBeNull();
    expect(replayGainOf({ replaygain_track_gain: { dB: NaN } }).trackGain).toBeNull();
  });
});

describe('ReplayGain storage', () => {
  it('stores the gains with the file and exposes them to the players', () => {
    setTrackFilePaths([
      { trackId: trackIds[0], filePath: 'Radiohead/OK Computer/01.flac', replayGain: RG },
      { trackId: trackIds[1], filePath: 'Radiohead/OK Computer/02.flac', replayGain: null },
    ]);
    const tracks = getAlbumById(albumId).tracks;
    expect(tracks[0].replaygain).toEqual({ track_gain: -7.5, track_peak: 0.98, album_gain: -8.1, album_peak: 1.02 });
    expect(tracks[1].replaygain).toBeNull();
    expect(getLiveTrack(trackIds[0]).replaygain.album_gain).toBe(-8.1);
  });

  it('keeps a lone album gain (track gain missing)', () => {
    setTrackFilePaths([{ trackId: trackIds[0], filePath: 'a.flac', replayGain: { albumGain: -3 } }]);
    expect(getAlbumById(albumId).tracks[0].replaygain)
      .toEqual({ track_gain: null, track_peak: null, album_gain: -3, album_peak: null });
  });

  it('drops the gains when the track loses its file', () => {
    setTrackFilePaths([{ trackId: trackIds[0], filePath: 'a.flac', replayGain: RG }]);
    setTrackFilePaths([{ trackId: trackIds[0], filePath: null, replayGain: RG }]);
    expect(getAlbumById(albumId).tracks[0].replaygain).toBeNull();

    setTrackFilePaths([{ trackId: trackIds[0], filePath: 'a.flac', replayGain: RG }]);
    clearAllFilePaths({ keepManual: true });
    expect(getAlbumById(albumId).tracks[0].replaygain).toBeNull();

    setTrackFilePaths([{ trackId: trackIds[0], filePath: 'a.flac', replayGain: RG }]);
    setAlbumAudioFolder(albumId, null);
    expect(getAlbumById(albumId).tracks[0].replaygain).toBeNull();
  });
});
