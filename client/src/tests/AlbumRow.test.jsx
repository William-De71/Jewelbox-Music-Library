import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { AlbumRow } from '../components/AlbumRow.jsx';
import { I18nProvider } from '../config/i18n/index.jsx';
import { PlayerProvider } from '../components/PlayerContext.jsx';

const wrap = (ui) =>
  render(
    <I18nProvider>
      <PlayerProvider>
        <table><tbody>{ui}</tbody></table>
      </PlayerProvider>
    </I18nProvider>
  );

const baseAlbum = {
  id: 2,
  title: 'The Bends',
  artist: { name: 'Radiohead' },
  year: 1995,
  genre: 'Alternative Rock',
  rating: 5,
  cover_url: null,
  label: { name: 'Parlophone' },
};

describe('AlbumRow', () => {
  it('renders the album title and artist', () => {
    wrap(<AlbumRow album={baseAlbum} onClick={vi.fn()} />);
    expect(screen.getByText('The Bends')).toBeTruthy();
    expect(screen.getByText('Radiohead')).toBeTruthy();
  });

  it('renders the year', () => {
    wrap(<AlbumRow album={baseAlbum} onClick={vi.fn()} />);
    expect(screen.getByText('1995')).toBeTruthy();
  });

  it('shows "—" when year is missing', () => {
    const album = { ...baseAlbum, year: null };
    wrap(<AlbumRow album={album} onClick={vi.fn()} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows genre badge when genre is provided', () => {
    wrap(<AlbumRow album={baseAlbum} onClick={vi.fn()} />);
    expect(screen.getByText('Alternative Rock')).toBeTruthy();
  });

  it('shows "—" when genre is missing', () => {
    const album = { ...baseAlbum, genre: null };
    wrap(<AlbumRow album={album} onClick={vi.fn()} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders the label name', () => {
    wrap(<AlbumRow album={baseAlbum} onClick={vi.fn()} />);
    expect(screen.getByText('Parlophone')).toBeTruthy();
  });

  it('calls onClick when the row is clicked', () => {
    const onClick = vi.fn();
    wrap(<AlbumRow album={baseAlbum} onClick={onClick} />);
    fireEvent.click(screen.getByText('The Bends').closest('tr'));
    expect(onClick).toHaveBeenCalledWith(baseAlbum);
  });

  it('renders a cover image when cover_url is provided', () => {
    const album = { ...baseAlbum, cover_url: '/covers/the-bends.jpg' };
    wrap(<AlbumRow album={album} onClick={vi.fn()} />);
    const img = screen.getByAltText('The Bends');
    expect(img.getAttribute('src')).toBe('/covers/the-bends.jpg');
  });
});
