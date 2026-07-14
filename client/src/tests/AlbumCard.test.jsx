import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { AlbumCard } from '../components/AlbumCard.jsx';
import { I18nProvider } from '../config/i18n/index.jsx';
import { PlayerProvider } from '../components/PlayerContext.jsx';

const wrap = (ui) => render(<I18nProvider><PlayerProvider>{ui}</PlayerProvider></I18nProvider>);

const baseAlbum = {
  id: 1,
  title: 'OK Computer',
  artist: { name: 'Radiohead' },
  year: 1997,
  genre: 'Alternative Rock',
  rating: 4,
  cover_url: null,
  is_lent: false,
  lent_to: null,
};

describe('AlbumCard', () => {
  it('renders the album title and artist', () => {
    wrap(<AlbumCard album={baseAlbum} onClick={vi.fn()} />);
    expect(screen.getByText('OK Computer')).toBeTruthy();
    expect(screen.getByText('Radiohead')).toBeTruthy();
  });

  it('renders a cover image when cover_url is provided', () => {
    const album = { ...baseAlbum, cover_url: '/covers/ok-computer.jpg' };
    wrap(<AlbumCard album={album} onClick={vi.fn()} />);
    const img = screen.getByAltText('OK Computer');
    expect(img.getAttribute('src')).toBe('/covers/ok-computer.jpg');
  });

  it('does not render an img when cover_url is null', () => {
    wrap(<AlbumCard album={baseAlbum} onClick={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the lent badge when album is lent', () => {
    const album = { ...baseAlbum, is_lent: true, lent_to: 'Alice' };
    wrap(<AlbumCard album={album} onClick={vi.fn()} />);
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it('does not show the lent badge when album is not lent', () => {
    wrap(<AlbumCard album={baseAlbum} onClick={vi.fn()} />);
    expect(screen.queryByText(/Alice/)).toBeNull();
  });

  it('calls onClick when the card header area is clicked', () => {
    const onClick = vi.fn();
    wrap(<AlbumCard album={baseAlbum} onClick={onClick} />);
    fireEvent.click(screen.getByText('OK Computer').closest('.card-footer'));
    expect(onClick).toHaveBeenCalledWith(baseAlbum);
  });

  it('calls onRate with the selected star value', () => {
    const onRate = vi.fn();
    wrap(<AlbumCard album={baseAlbum} onClick={vi.fn()} onRate={onRate} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]);
    expect(onRate).toHaveBeenCalledWith(baseAlbum, 3);
  });
});
