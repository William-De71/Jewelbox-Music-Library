import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { I18nProvider } from '../config/i18n/index.jsx';

const playerMock = {
  queue: [
    { id: 1, title: 'Airbag', artist_name: 'Radiohead', duration: '4:44', album_id: 1, album_title: 'OK Computer', cover_url: null },
    { id: 2, title: 'Paranoid Android', artist_name: 'Radiohead', duration: '6:23', album_id: 1, album_title: 'OK Computer', cover_url: null },
  ],
  index: 0,
  current: { id: 1, title: 'Airbag', artist_name: 'Radiohead', album_id: 1, album_title: 'OK Computer', cover_url: null },
  playing: true,
  currentTime: 30,
  duration: 284,
  volume: 1,
  expanded: true,
  toggle: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  close: vi.fn(),
  setExpanded: vi.fn(),
  jumpTo: vi.fn(),
};

vi.mock('../components/PlayerContext.jsx', () => ({
  usePlayer: () => playerMock,
}));

import { PlayerView } from '../components/PlayerView.jsx';

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>);

describe('PlayerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerMock.expanded = true;
  });

  it('renders the current track and the queue', () => {
    wrap(<PlayerView navigate={vi.fn()} />);
    expect(screen.getAllByText('Airbag').length).toBeGreaterThan(0);
    expect(screen.getByText('Paranoid Android')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('renders nothing when collapsed', () => {
    playerMock.expanded = false;
    const { container } = wrap(<PlayerView navigate={vi.fn()} />);
    expect(container.querySelector('.player-view')).toBeNull();
  });

  it('collapses on Escape', () => {
    wrap(<PlayerView navigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(playerMock.setExpanded).toHaveBeenCalledWith(false);
  });

  it('jumps to a queue item on click', () => {
    wrap(<PlayerView navigate={vi.fn()} />);
    fireEvent.click(screen.getByText('Paranoid Android'));
    expect(playerMock.jumpTo).toHaveBeenCalledWith(1);
  });

  it('navigates to the album and collapses', () => {
    const navigate = vi.fn();
    wrap(<PlayerView navigate={navigate} />);
    fireEvent.click(screen.getByTitle('Voir l\'album'));
    expect(playerMock.setExpanded).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith('detail', { id: 1 });
  });
});
