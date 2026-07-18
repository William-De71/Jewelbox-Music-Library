const BASE = '/api';

async function request(method, path, body) {
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const api = {
  // Albums
  getAlbums: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)
    ).toString();
    return request('GET', `/albums${qs ? `?${qs}` : ''}`);
  },
  getAlbum: (id) => request('GET', `/albums/${id}`),
  createAlbum: (data) => request('POST', '/albums', data),
  updateAlbum: (id, data) => request('PATCH', `/albums/${id}`, data),
  deleteAlbum: (id) => request('DELETE', `/albums/${id}`),
  lendAlbum: (id, is_lent, lent_to) => request('PATCH', `/albums/${id}/lend`, { is_lent, lent_to }),

  // Metadata
  getGenres: () => request('GET', '/albums/genres'),
  getArtists: () => request('GET', '/albums/artists'),
  getLabels: () => request('GET', '/albums/labels'),
  getStats: () => request('GET', '/stats'),
  getBorrowers: () => request('GET', '/albums/borrowers'),

  // Loan history
  getLoanHistory: (id) => request('GET', `/albums/${id}/loans`),

  // Export / Import
  exportCollection: (format = 'csv') => `${BASE}/albums/export?format=${format}`,
  importCSV: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/albums/import`, { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Import failed');
    return json;
  },

  // Duplicate check
  checkDuplicate: (title, artistName) =>
    request('GET', `/albums/duplicate?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artistName)}`),

  // Settings
  getSettings: () => request('GET', '/settings'),
  saveSettings: (data) => request('PUT', '/settings', data),

  // External search
  search: (q, source = 'musicbrainz') => request('GET', `/search?q=${encodeURIComponent(q)}&source=${source}`),
  searchAdvanced: ({ artist, title, year }, source = 'musicbrainz') => {
    const params = new URLSearchParams({ source });
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (year) params.set('year', year);
    return request('GET', `/search?${params.toString()}`);
  },
  searchByEan: (ean, source = 'musicbrainz') => request('GET', `/search?ean=${encodeURIComponent(ean)}&source=${source}`),
  getRelease: (mbid) => request('GET', `/search/${mbid}`),
  getDiscogsRelease: (id) => request('GET', `/search/discogs/${id}`),

  // Cover upload
  uploadCover: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/upload/cover`, { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    return json;
  },

  // Playlists
  getPlaylists: () => request('GET', '/playlists'),
  getPlaylist: (id) => request('GET', `/playlists/${id}`),
  createPlaylist: (name) => request('POST', '/playlists', { name }),
  renamePlaylist: (id, name) => request('PATCH', `/playlists/${id}`, { name }),
  deletePlaylist: (id) => request('DELETE', `/playlists/${id}`),
  addToPlaylist: (id, payload) => request('POST', `/playlists/${id}/tracks`, payload),
  removePlaylistEntry: (id, entryId) => request('DELETE', `/playlists/${id}/tracks/${entryId}`),
  reorderPlaylist: (id, entryIds) => request('PUT', `/playlists/${id}/tracks`, { entry_ids: entryIds }),

  // Audio player
  playerScan: () => request('POST', '/player/scan'),
  playerScanStatus: () => request('GET', '/player/scan/status'),
  playerBrowse: (dir = '') => request('GET', `/player/browse?dir=${encodeURIComponent(dir)}`),
  // Browses the server filesystem (absolute paths) to pick the library root.
  settingsBrowse: (dir = '') => request('GET', `/settings/browse?dir=${encodeURIComponent(dir)}`),
  setAlbumAudioFolder: (id, folder) => request('PUT', `/player/albums/${id}/folder`, { folder }),
  clearAlbumAudioFolder: (id) => request('DELETE', `/player/albums/${id}/folder`),
  trackStreamUrl: (id) => `${BASE}/player/tracks/${id}/stream`,
  trackPlayed: (id) => request('POST', `/player/tracks/${id}/played`),
  setTrackFavorite: (id, is_favorite) => request('PATCH', `/player/tracks/${id}/favorite`, { is_favorite }),

  // Smart playlists
  getSmartPlaylists: () => request('GET', '/smart-playlists'),
  getSmartPlaylist: (key) => request('GET', `/smart-playlists/${key}`),
  dynamicMixPlayed: (track_id) => request('POST', '/smart-playlists/dynamic_mix/played', { track_id }),
  dynamicMixRemove: (track_id) => request('DELETE', `/smart-playlists/dynamic_mix/tracks/${track_id}`),
  dynamicMixRefresh: () => request('POST', '/smart-playlists/dynamic_mix/refresh'),

  // Last.fm
  lastfmConnectUrl: () => request('GET', `/lastfm/connect?origin=${encodeURIComponent(window.location.origin)}`),
  lastfmDisconnect: () => request('DELETE', '/lastfm/session'),
  lastfmNowPlaying: (track_id) => request('POST', '/lastfm/nowplaying', { track_id }),
  lastfmScrobble: (track_id, started_at) => request('POST', '/lastfm/scrobble', { track_id, started_at }),

  // Version
  getVersion: () => request('GET', '/version'),
};
