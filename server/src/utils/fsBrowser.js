import path from 'path';
import fs from 'fs';
import os from 'os';
import { isAudioFile } from './audioScanner.js';

// Browsing happens on the *server* filesystem: the library path is read by the
// server, not the browser, so a native file picker would return paths from the
// wrong machine. Listing is confined to these roots — the app has no auth, so
// the rest of the filesystem must stay invisible.
// JEWELBOX_BROWSE_ROOTS (colon-separated) overrides the defaults.
export function getBrowseRoots() {
  const configured = process.env.JEWELBOX_BROWSE_ROOTS;
  const candidates = configured
    ? configured.split(':').filter(Boolean)
    : [os.homedir(), '/media', '/mnt', '/music'];

  const roots = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch {
      continue; // missing root (e.g. /music outside Docker): just skip it
    }
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return roots;
}

// Guards against traversal the same way routes/player.js resolveInLibrary does,
// but across several roots: an absolute path is allowed only when it is a root
// or lives under one. Symlinks are resolved first so a link cannot escape.
export function resolveInRoots(dir, roots = getBrowseRoots()) {
  const abs = path.resolve(dir);
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }

  // Dotfile directories (~/.ssh, ~/.config, ~/.gnupg…) are never browsable:
  // the listing hides them, but hiding is not access control and the app has
  // no auth. Checked against the resolved path so a symlink cannot smuggle one in.
  const relevantRoot = roots.find(root => {
    try {
      const realRoot = fs.realpathSync(root);
      return real === realRoot || real.startsWith(realRoot + path.sep);
    } catch {
      return false;
    }
  });
  if (relevantRoot) {
    const suffix = path.relative(fs.realpathSync(relevantRoot), real);
    if (suffix.split(path.sep).some(part => part.startsWith('.'))) return null;
  }

  const allowed = roots.some(root => {
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      return false;
    }
    return real === realRoot || real.startsWith(realRoot + path.sep);
  });
  return allowed ? real : null;
}

// Lists sub-directories of `abs` with their audio file count, mirroring the
// shape of GET /player/browse so the same modal can render either source.
export async function listDirectory(abs) {
  const entries = await fs.promises.readdir(abs, { withFileTypes: true });
  const folders = [];
  let audioFiles = 0;
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      let count = 0;
      try {
        const subEntries = await fs.promises.readdir(path.join(abs, entry.name), { withFileTypes: true });
        count = subEntries.filter(e => e.isFile() && isAudioFile(e.name)).length;
      } catch { /* unreadable folder: keep it listed with 0 files */ }
      folders.push({ name: entry.name, path: path.join(abs, entry.name), audio_files: count });
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      audioFiles++;
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { folders, audioFiles };
}

// Parent directory, or null when `abs` is itself a browse root.
export function parentWithinRoots(abs, roots = getBrowseRoots()) {
  if (roots.includes(abs)) return null;
  const parent = path.dirname(abs);
  return parent !== abs && resolveInRoots(parent, roots) ? parent : null;
}
