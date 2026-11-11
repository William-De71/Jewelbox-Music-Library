import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { AlbumForm } from '../pages/AlbumForm.jsx';
import { I18nProvider } from '../config/i18n/index.jsx';
import { api } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  api: {
    getArtists: vi.fn().mockResolvedValue([]),
    getLabels: vi.fn().mockResolvedValue([]),
    getGenres: vi.fn().mockResolvedValue([]),
    createAlbum: vi.fn().mockResolvedValue({ id: 1 }),
  },
}));

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>);

const fillRequiredFields = () => {
  fireEvent.input(screen.getByPlaceholderText('ex: OK Computer'), { target: { value: 'OK Computer' } });
  fireEvent.input(screen.getByPlaceholderText('ex: Radiohead'), { target: { value: 'Radiohead' } });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getArtists.mockResolvedValue([]);
  api.getLabels.mockResolvedValue([]);
  api.getGenres.mockResolvedValue([]);
  api.createAlbum.mockResolvedValue({ id: 1 });
});

describe('AlbumForm - boutons Enregistrer / Enregistrer et ajouter', () => {
  it('Collections: "Enregistrer" navigue vers collections', async () => {
    const navigate = vi.fn();
    wrap(<AlbumForm navigate={navigate} params={{ returnPage: 2 }} />);

    fillRequiredFields();
    fireEvent.click(screen.getByText('Enregistrer'));

    await waitFor(() => expect(api.createAlbum).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('collections', expect.objectContaining({ page: 2 }));
  });

  it('Collections: "Enregistrer et ajouter" réinitialise le formulaire sans naviguer', async () => {
    const navigate = vi.fn();
    wrap(<AlbumForm navigate={navigate} params={{ returnPage: 2 }} />);

    fillRequiredFields();
    fireEvent.click(screen.getByText('Enregistrer et ajouter'));

    await waitFor(() => expect(api.createAlbum).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('ex: OK Computer').value).toBe('');
  });

  it('Liste de souhaits: "Enregistrer" navigue vers wantlist', async () => {
    const navigate = vi.fn();
    wrap(<AlbumForm navigate={navigate} params={{ fromWantList: true, returnPage: 3 }} />);

    fillRequiredFields();
    fireEvent.click(screen.getByText('Enregistrer'));

    await waitFor(() => expect(api.createAlbum).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('wantlist', expect.objectContaining({ page: 3 }));
  });

  it('Liste de souhaits: "Enregistrer et ajouter" réinitialise le formulaire sans naviguer', async () => {
    const navigate = vi.fn();
    wrap(<AlbumForm navigate={navigate} params={{ fromWantList: true, returnPage: 3 }} />);

    fillRequiredFields();
    fireEvent.click(screen.getByText('Enregistrer et ajouter'));

    await waitFor(() => expect(api.createAlbum).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('ex: OK Computer').value).toBe('');
  });
});

describe('AlbumForm - plusieurs CD', () => {
  it('le titre de la page est "Ajouter un album"', () => {
    wrap(<AlbumForm navigate={vi.fn()} />);
    expect(screen.getByText('Ajouter un album')).toBeTruthy();
  });

  it('"Ajouter un CD" crée un CD avec ses propres pistes', async () => {
    wrap(<AlbumForm navigate={vi.fn()} />);
    fillRequiredFields();

    fireEvent.click(screen.getByText('Ajouter une piste'));
    fireEvent.click(screen.getByText('Ajouter un CD'));
    expect(screen.getByText('CD 2 — Pistes')).toBeTruthy();

    const addTrackButtons = screen.getAllByText('Ajouter une piste');
    expect(addTrackButtons).toHaveLength(2);
    fireEvent.click(addTrackButtons[1]);

    const titles = screen.getAllByPlaceholderText('Titre de la piste');
    fireEvent.input(titles[0], { target: { value: 'In the Flesh?' } });
    fireEvent.input(titles[1], { target: { value: 'Hey You' } });
    fireEvent.click(screen.getByText('Enregistrer'));

    await waitFor(() => expect(api.createAlbum).toHaveBeenCalled());
    const payload = api.createAlbum.mock.calls[0][0];
    expect(payload.discs).toBeUndefined();
    expect(payload.tracks).toEqual([
      expect.objectContaining({ disc: 1, position: 1, title: 'In the Flesh?' }),
      expect.objectContaining({ disc: 2, position: 1, title: 'Hey You' }),
    ]);
  });
});
