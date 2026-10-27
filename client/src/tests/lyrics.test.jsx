import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('../config/i18n/index.jsx', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('../api/client.js', () => ({ api: { getLyrics: vi.fn() } }));

import { api } from '../api/client.js';
import { currentLineIndex } from '../utils/lyrics.js';
import { LyricsPanel } from '../components/LyricsPanel.jsx';

const LINES = [{ time: 10, text: 'One' }, { time: 20, text: 'Two' }, { time: 30, text: '' }];

beforeEach(() => {
  api.getLyrics.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('currentLineIndex', () => {
  it('finds the line being sung, a little ahead', () => {
    expect(currentLineIndex(LINES, 0)).toBe(-1);
    expect(currentLineIndex(LINES, 9.8)).toBe(0);
    expect(currentLineIndex(LINES, 25)).toBe(1);
    expect(currentLineIndex(LINES, 300)).toBe(2);
    expect(currentLineIndex(null, 5)).toBe(-1);
    expect(currentLineIndex(LINES, NaN)).toBe(-1);
  });
});

describe('LyricsPanel', () => {
  it('highlights the current line, seeks on a tap, and asks each track once', async () => {
    api.getLyrics.mockResolvedValue({ synced: true, lines: LINES, plain: 'One\nTwo', source: 'lrclib' });
    const onSeek = vi.fn();
    const { rerender } = render(<LyricsPanel trackId={1} currentTime={21} onSeek={onSeek} />);
    await screen.findByText('Two');
    expect(screen.getByText('Two').className).toContain('active');
    expect(screen.getByText('One').className).toContain('past');
    expect(screen.getByText('♪')).toBeTruthy();
    expect(screen.getByText('lyrics.credit')).toBeTruthy();
    fireEvent.click(screen.getByText('One'));
    expect(onSeek).toHaveBeenCalledWith(10);
    rerender(<LyricsPanel trackId={1} currentTime={31} onSeek={onSeek} />);
    expect(screen.getByText('♪').className).toContain('active');
    expect(api.getLyrics).toHaveBeenCalledTimes(1);
  });

  it('shows plain lyrics, nothing found, or an older server', async () => {
    api.getLyrics.mockResolvedValueOnce({ synced: false, lines: null, plain: 'Just words', source: 'lrclib' });
    render(<LyricsPanel trackId={2} currentTime={0} onSeek={() => {}} />);
    await screen.findByText('Just words');

    api.getLyrics.mockResolvedValueOnce({ synced: false, lines: null, plain: null, source: null });
    render(<LyricsPanel trackId={3} currentTime={0} onSeek={() => {}} />);
    await screen.findByText('lyrics.none');

    api.getLyrics.mockRejectedValueOnce(new Error('HTTP 404'));
    render(<LyricsPanel trackId={4} currentTime={0} onSeek={() => {}} />);
    await waitFor(() => expect(screen.getByText('lyrics.unavailable')).toBeTruthy());
  });
});
