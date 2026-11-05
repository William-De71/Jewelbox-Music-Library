import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('../api/client.js', () => ({
  api: { getUpdate: vi.fn(), getVersion: vi.fn(() => Promise.resolve({ version: '1.23.0' })) },
}));

import { api } from '../api/client.js';
import { I18nProvider } from '../config/i18n/index.jsx';
import { About } from '../pages/About.jsx';

const check = () => {
  render(<I18nProvider><About /></I18nProvider>);
  fireEvent.click(screen.getByText('Rechercher une mise à jour'));
};

beforeEach(() => vi.clearAllMocks());

describe('About: looking for an update', () => {
  it('says when the server is up to date', async () => {
    api.getUpdate.mockResolvedValue({ current: '1.23.0', available: false, latest: { version: '1.23.0' } });
    check();
    expect(await screen.findByText('JewelBox est à jour (v1.23.0).')).toBeTruthy();
    expect(api.getUpdate).toHaveBeenCalledWith(true);
  });

  it('does not claim to be up to date when GitHub could not be asked', async () => {
    api.getUpdate.mockResolvedValue({ current: '1.23.0', available: false, latest: null, error: 'HTTP 403' });
    check();
    expect(await screen.findByText('Vérification impossible : HTTP 403')).toBeTruthy();
  });

  it('says when the server cannot be reached', async () => {
    api.getUpdate.mockRejectedValue(new Error('Failed to fetch'));
    check();
    expect(await screen.findByText('Vérification impossible : Failed to fetch')).toBeTruthy();
  });

  it('adds no message when an update exists: the dialog answers', async () => {
    api.getUpdate.mockResolvedValue({ current: '1.23.0', available: true, latest: { version: '1.24.0' } });
    check();
    await vi.waitFor(() => expect(screen.getByRole('button').disabled).toBe(false));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
