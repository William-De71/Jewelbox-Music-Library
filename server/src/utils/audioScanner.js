import fs from 'fs';
import path from 'path';
import { parseFile } from 'music-metadata';
import {
  parsePathFallback,
  buildAlbumIndex,
  matchAlbum,
  matchTrack,
  matchFolderTracks,
} from './audioMatch.js';
import {
  getAlbumsForMatching,
  setTrackFilePaths,
  clearAllFilePaths,
} from '../db/queries.js';
import { getDb } from '../db/database.js';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wav']);
const UNMATCHED_LIMIT = 500;

// One scan at a time; state is kept in module memory (results are persisted in DB).
const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  progress: { files_scanned: 0, files_total: 0 },
  result: null,
};

export function isAudioFile(name) {
  return AUDIO_EXTS.has(path.extname(name).toLowerCase());
}

export async function walkAudioFiles(rootDir, subDir = '') {
  const files = [];
  const absDir = path.join(rootDir, subDir);
  let entries;
  try {
    entries = await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relPath = subDir ? `${subDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walkAudioFiles(rootDir, relPath));
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      files.push(relPath);
    }
  }
  return files;
}

// music-metadata gives each ReplayGain tag as { dB, ratio }: gains are kept in
// dB, peaks as the linear sample peak (what the tags themselves store).
function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function replayGainOf(common) {
  return {
    trackGain: finiteOrNull(common?.replaygain_track_gain?.dB),
    trackPeak: finiteOrNull(common?.replaygain_track_peak?.ratio),
    albumGain: finiteOrNull(common?.replaygain_album_gain?.dB),
    albumPeak: finiteOrNull(common?.replaygain_album_peak?.ratio),
  };
}

export async function readFileTags(absPath) {
  try {
    const { common } = await parseFile(absPath, { duration: false, skipCovers: true });
    return {
      artist: common.albumartist || common.artist || null,
      album: common.album || null,
      discNo: common.disk?.no ?? null,
      trackNo: common.track?.no ?? null,
      title: common.title || null,
      replayGain: replayGainOf(common),
    };
  } catch {
    return null;
  }
}

// Lists audio files directly in a folder (plus one sublevel for CD1/CD2 layouts).
async function listFolderAudioFiles(libraryPath, relFolder) {
  const absFolder = path.join(libraryPath, relFolder);
  const files = [];
  const entries = await fs.promises.readdir(absFolder, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relPath = relFolder ? `${relFolder}/${entry.name}` : entry.name;
    if (entry.isFile() && isAudioFile(entry.name)) {
      files.push(relPath);
    } else if (entry.isDirectory()) {
      const subEntries = await fs.promises.readdir(path.join(absFolder, entry.name), { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && isAudioFile(sub.name)) files.push(`${relPath}/${sub.name}`);
      }
    }
  }
  return files;
}

// Matches every audio file of relFolder against the album's tracks.
// Returns entries [{ trackId, filePath, replayGain }] (filePath relative to the library root).
export async function matchManualFolder(libraryPath, relFolder, album) {
  const relPaths = await listFolderAudioFiles(libraryPath, relFolder);
  const files = [];
  const replayGains = new Map();
  for (const relPath of relPaths) {
    const tags = await readFileTags(path.join(libraryPath, relPath));
    const fallback = parsePathFallback(relPath);
    files.push({
      relPath,
      discNo: tags?.discNo ?? fallback.discNo,
      trackNo: tags?.trackNo ?? fallback.trackNo,
      title: tags?.title ?? fallback.title,
    });
    if (tags?.replayGain) replayGains.set(relPath, tags.replayGain);
  }
  return matchFolderTracks(album.tracks, files)
    .map(entry => ({ ...entry, replayGain: replayGains.get(entry.filePath) ?? null }));
}

async function runScan(libraryPath) {
  const result = {
    matched_tracks: 0,
    matched_albums: 0,
    unmatched_count: 0,
    unmatched_files: [],
    errors: [],
  };

  const allFiles = await walkAudioFiles(libraryPath);
  state.progress.files_total = allFiles.length;

  // The collection being scanned: the results must not land in another one.
  const scannedDb = getDb();
  const albums = getAlbumsForMatching();
  const autoAlbums = albums.filter(a => !a.audio_folder);
  const manualAlbums = albums.filter(a => a.audio_folder);
  const index = buildAlbumIndex(autoAlbums);

  const entries = [];
  const matchedAlbumIds = new Set();
  const usedTrackIds = new Set();

  for (const relPath of allFiles) {
    state.progress.files_scanned++;
    const tags = await readFileTags(path.join(libraryPath, relPath));
    const fallback = parsePathFallback(relPath);
    const artist = tags?.artist ?? fallback.artist;
    const albumTitle = tags?.album ?? fallback.album;
    const trackNo = tags?.trackNo ?? fallback.trackNo;
    const title = tags?.title ?? fallback.title;
    const discNo = tags?.discNo ?? fallback.discNo;

    const album = matchAlbum(index, artist, albumTitle);
    // Tracks already taken are left out, so that two CDs without any disc
    // information do not fight over the same track numbers.
    const track = album
      ? matchTrack({ tracks: album.tracks.filter(t => !usedTrackIds.has(t.id)) }, trackNo, title, discNo)
      : null;
    if (track) {
      usedTrackIds.add(track.id);
      matchedAlbumIds.add(album.id);
      entries.push({ trackId: track.id, filePath: relPath, replayGain: tags?.replayGain ?? null });
    } else {
      result.unmatched_count++;
      if (result.unmatched_files.length < UNMATCHED_LIMIT) result.unmatched_files.push(relPath);
    }
  }

  // Re-match manually associated folders (files may have changed since association).
  // Albums whose folder disappeared keep their previous file paths untouched.
  for (const album of manualAlbums) {
    try {
      const stat = fs.statSync(path.join(libraryPath, album.audio_folder));
      if (!stat.isDirectory()) throw new Error('not a directory');
      const manualEntries = await matchManualFolder(libraryPath, album.audio_folder, album);
      if (manualEntries.length > 0) matchedAlbumIds.add(album.id);
      entries.push(...manualEntries);
    } catch {
      result.errors.push(`Dossier associé introuvable : ${album.audio_folder} (album #${album.id})`);
    }
  }

  // Reading the tags takes a while: if the active collection changed (or was
  // restored) meanwhile, these track ids belong to the previous one.
  if (getDb() !== scannedDb) {
    throw new Error("La collection active a changé pendant l'analyse : relancez-la.");
  }

  clearAllFilePaths({ keepManual: true });
  setTrackFilePaths(entries);

  result.matched_tracks = entries.length;
  result.matched_albums = matchedAlbumIds.size;
  return result;
}

export function startScan(libraryPath) {
  if (state.running) {
    const err = new Error('Scan already running');
    err.code = 'SCAN_RUNNING';
    throw err;
  }
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.progress = { files_scanned: 0, files_total: 0 };
  state.result = null;

  runScan(libraryPath)
    .then(result => { state.result = result; })
    .catch(err => {
      state.result = {
        matched_tracks: 0, matched_albums: 0, unmatched_count: 0,
        unmatched_files: [], errors: [String(err?.message || err)],
      };
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });
}

export function getScanStatus() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    progress: { ...state.progress },
    result: state.result ? { ...state.result } : null,
  };
}
