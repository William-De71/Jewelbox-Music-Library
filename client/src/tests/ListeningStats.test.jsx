import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

const playAlbumById = vi.fn();
vi.mock('../components/PlayerContext.jsx', () => ({ usePlayer: () => ({ playAlbumById }) }));
vi.mock('../config/i18n/index.jsx', () => ({
  useI18n: () => ({ t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));
vi.mock('../api/client.js', () => ({ api: { getListeningStats: vi.fn() } }));

import { api } from '../api/client.js';
import { ListeningStats, formatMinutes, monthLabel } from '../components/ListeningStats.jsx';

const STATS = (overrides = {}) => ({
  period: 'month',
  tracking_since: '2026-10-01T08:00:00.000Z',
  counters: { plays_today: 2, plays_month: 31, plays_year: 200, plays_all: 1234 },
  summary: { plays: 31, listening_minutes: 125, tracks: 20, albums: 4 },
  by_month: [{ month: '2025-11', plays: 0 }, { month: '2026-01', plays: 5 }, { month: '2026-10', plays: 31 }],
  top: {
    albums: [{ album_id: 7, title: 'OK Computer', artist_name: 'Radiohead', cover_url: '/covers/a.jpg', plays: 12 }],
    artists: [{ artist_id: 1, name: 'Radiohead', plays: 12 }],
    tracks: [{ id: 3, title: 'Airbag', artist_name: 'Radiohead', album_title: 'OK Computer', plays: 1 }],
  },
  never_played: { count: 1, albums: [{ album_id: 9, title: 'Kid A', artist_name: 'Radiohead', cover_url: null }] },
  ...overrides,
});

beforeEach(() => {
  api.getListeningStats.mockReset();
  playAlbumById.mockReset();
});

describe('helpers', () => {
  it('formats minutes and months', () => {
    expect(formatMinutes(42)).toBe('42 min');
    expect(formatMinutes(125)).toBe('2 h 05');
    expect(monthLabel('2026-03')).toMatch(/^mars/);
    expect(monthLabel('2026-01')).toMatch(/26$/);
  });
});

describe('ListeningStats', () => {
  it('shows the counters, the tops and the albums never played', async () => {
    api.getListeningStats.mockResolvedValue(STATS());
    const navigate = vi.fn();
    render(<ListeningStats navigate={navigate} />);
    await screen.findByText('OK Computer');
    expect(api.getListeningStats).toHaveBeenCalledWith('month');
    expect(screen.getByText('1234')).toBeTruthy();
    expect(screen.getByText('2 h 05')).toBeTruthy();
    expect(screen.getByText('Airbag')).toBeTruthy();

    fireEvent.click(screen.getByText('OK Computer'));
    expect(navigate).toHaveBeenCalledWith('detail', { id: 7 });
    fireEvent.click(screen.getByLabelText('player.play'));
    expect(playAlbumById).toHaveBeenCalledWith(9);
  });

  it('loads another period on demand', async () => {
    api.getListeningStats.mockResolvedValue(STATS());
    render(<ListeningStats />);
    await screen.findByText('OK Computer');
    api.getListeningStats.mockResolvedValue(STATS({
      period: 'all',
      summary: { plays: 0, listening_minutes: 0, tracks: 0, albums: 0 },
      never_played: { count: 0, albums: [] },
    }));
    fireEvent.click(screen.getByText('stats.listening.periods.all'));
    await waitFor(() => expect(screen.getByText('stats.listening.empty')).toBeTruthy());
    expect(api.getListeningStats).toHaveBeenLastCalledWith('all');
    expect(screen.getByText('stats.listening.neverPlayedNone')).toBeTruthy();
  });

  it('says when the dated log starts with the next play', async () => {
    api.getListeningStats.mockResolvedValue(STATS({ tracking_since: null }));
    render(<ListeningStats />);
    await screen.findByText(/stats.listening.trackingNone/);
  });

  it('shows an error when the server fails', async () => {
    api.getListeningStats.mockRejectedValue(new Error('boom'));
    render(<ListeningStats />);
    await screen.findByText('stats.error.loadFailed');
  });
});
