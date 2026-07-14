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

  // Audio player
  playerScan: () => request('POST', '/player/scan'),
  playerScanStatus: () => request('GET', '/player/scan/status'),
  playerBrowse: (dir = '') => request('GET', `/player/browse?dir=${encodeURIComponent(dir)}`),
  setAlbumAudioFolder: (id, folder) => request('PUT', `/player/albums/${id}/folder`, { folder }),
  clearAlbumAudioFolder: (id) => request('DELETE', `/player/albums/${id}/folder`),
  trackStreamUrl: (id) => `${BASE}/player/tracks/${id}/stream`,

  // Version
  getVersion: () => request('GET', '/version'),
};
