// Pure matching helpers between audio files and collection albums/tracks.
// No I/O here: everything is unit-testable.

const LEADING_ARTICLES = /^(the|le|la|les|a|an|los|las|el|die|der|das)\s+|^l'/;
const PARENTHESIZED_SUFFIX = /[([{][^)\]}]*(remaster|deluxe|edition|bonus|reissue|expanded|anniversary|mono|stereo|version)[^)\]}]*[)\]}]/g;

export function normalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, "'")
    .replace(PARENTHESIZED_SUFFIX, ' ')
    .replace(LEADING_ARTICLES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const DISC_FOLDER = /^(?:cd|disc|disk|disque)[\s._-]*(\d{1,2})$/i;

// "Artiste/Album/03 - Titre.flac" -> { artist, album, discNo, trackNo, title }
// Artist/album are null when the path is not deep enough. A "CD2" folder
// around the file gives discNo and is skipped when reading artist/album.
export function parsePathFallback(relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || '';
  const discFolder = parts.length >= 2 ? DISC_FOLDER.exec(parts[parts.length - 2].trim()) : null;
  if (discFolder) parts.splice(parts.length - 2, 1);
  const base = fileName.replace(/\.[^.]+$/, '');
  const m = base.match(/^(\d{1,3})[\s.\-_]*(.*)$/);
  const trackNo = m ? parseInt(m[1], 10) : null;
  const title = m && m[2] ? m[2].trim() : base.trim();
  return {
    artist: parts.length >= 3 ? parts[parts.length - 3] : null,
    album: parts.length >= 2 ? parts[parts.length - 2] : null,
    discNo: discFolder ? parseInt(discFolder[1], 10) : null,
    trackNo: Number.isFinite(trackNo) && trackNo > 0 ? trackNo : null,
    title: title || null,
  };
}

// albums = [{ id, title, artist_name, tracks: [...] }]
export function buildAlbumIndex(albums) {
  const exact = new Map();
  const byArtist = new Map();
  for (const album of albums) {
    const artistKey = normalize(album.artist_name);
    const titleKey = normalize(album.title);
    if (!artistKey || !titleKey) continue;
    exact.set(`${artistKey}|${titleKey}`, album);
    if (!byArtist.has(artistKey)) byArtist.set(artistKey, []);
    byArtist.get(artistKey).push(album);
  }
  return { exact, byArtist };
}

export function matchAlbum(index, artist, albumTitle) {
  const artistKey = normalize(artist);
  const titleKey = normalize(albumTitle);
  if (!artistKey || !titleKey) return null;

  const exact = index.exact.get(`${artistKey}|${titleKey}`);
  if (exact) return exact;

  const candidates = index.byArtist.get(artistKey) || [];
  for (const album of candidates) {
    const candidateKey = normalize(album.title);
    if (candidateKey.includes(titleKey) || titleKey.includes(candidateKey)) return album;
  }
  return null;
}

// discNo: the CD the file says it is on, when known. Track numbers restart on
// each CD, so on a multi-CD album a number alone may point at several tracks:
// the title then decides, the first CD wins by default.
export function matchTrack(album, trackNo, title, discNo = null) {
  const tracks = album.tracks || [];
  const titleKey = normalize(title);
  if (trackNo != null) {
    const sameNumber = tracks.filter(t => t.position === trackNo);
    const onDisc = discNo != null ? sameNumber.filter(t => (t.disc ?? 1) === discNo) : sameNumber;
    if (onDisc.length > 1 && titleKey) {
      const byNumberAndTitle = onDisc.find(t => normalize(t.title) === titleKey);
      if (byNumberAndTitle) return byNumberAndTitle;
    }
    if (onDisc.length) return onDisc[0];
  }
  if (!titleKey) return null;
  const byTitle = tracks.find(t => normalize(t.title) === titleKey);
  if (byTitle) return byTitle;
  return tracks.find(t => {
    const key = normalize(t.title);
    return key && (key.includes(titleKey) || titleKey.includes(key));
  }) || null;
}

// Manual folder association: files = [{ relPath, discNo?, trackNo, title }].
// Matches by track number, then title; falls back to alphabetical order <-> position.
export function matchFolderTracks(albumTracks, files) {
  const entries = [];
  const usedTracks = new Set();
  const unmatchedFiles = [];

  const sorted = [...files].sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true }));

  for (const file of sorted) {
    const album = { tracks: albumTracks.filter(t => !usedTracks.has(t.id)) };
    const track = matchTrack(album, file.trackNo, file.title, file.discNo ?? null);
    if (track) {
      usedTracks.add(track.id);
      entries.push({ trackId: track.id, filePath: file.relPath });
    } else {
      unmatchedFiles.push(file);
    }
  }

  // Fallback: pair remaining files with remaining tracks in order.
  const remainingTracks = albumTracks
    .filter(t => !usedTracks.has(t.id))
    .sort((a, b) => (a.disc ?? 1) - (b.disc ?? 1) || a.position - b.position);
  for (let i = 0; i < unmatchedFiles.length && i < remainingTracks.length; i++) {
    entries.push({ trackId: remainingTracks[i].id, filePath: unmatchedFiles[i].relPath });
  }

  return entries;
}
