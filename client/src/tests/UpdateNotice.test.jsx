import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('../api/client.js', () => ({
  api: { getUpdate: vi.fn(), applyUpdate: vi.fn(), getVersion: vi.fn() },
}));

import { api } from '../api/client.js';
import { I18nProvider } from '../config/i18n/index.jsx';
import { UpdateNotice } from '../components/UpdateNotice.jsx';

const status = (extra = {}) => ({
  current: '1.18.1',
  available: true,
  can_update: false,
  image_tag: 'latest',
  latest: { version: '1.19.0', url: 'https://gh/v1.19.0', notes: '- du neuf' },
  ...extra,
});

const show = () => render(<I18nProvider><ul><UpdateNotice /></ul></I18nProvider>);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('UpdateNotice', () => {
  it('shows nothing when the server is up to date', async () => {
    api.getUpdate.mockResolvedValue(status({ available: false }));
    const { container } = show();
    await waitFor(() => expect(api.getUpdate).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('tells once per version, then the link opens the notes and the command', async () => {
    api.getUpdate.mockResolvedValue(status());
    show();
    expect(await screen.findByText('JewelBox v1.19.0 est disponible')).toBeTruthy();
    expect(localStorage.getItem('jewelbox-update-notified')).toBe('1.19.0');

    fireEvent.click(screen.getByText('v1.19.0 disponible'));
    expect(screen.getByText('- du neuf')).toBeTruthy();
    expect(screen.getByText('docker compose pull && docker compose up -d')).toBeTruthy();
    expect(screen.queryByText('Mettre à jour maintenant')).toBeNull();
  });

  it('does not toast a version already told', async () => {
    localStorage.setItem('jewelbox-update-notified', '1.19.0');
    api.getUpdate.mockResolvedValue(status());
    show();
    await screen.findByText('v1.19.0 disponible');
    expect(screen.queryByText('JewelBox v1.19.0 est disponible')).toBeNull();
  });

  it('asks Watchtower and reloads once the new version answers', async () => {
    api.getUpdate.mockResolvedValue(status({ can_update: true }));
    api.applyUpdate.mockResolvedValue({ ok: true });
    api.getVersion.mockResolvedValue({ version: '1.19.0' });
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show();
      fireEvent.click(await screen.findByText('v1.19.0 disponible'));
      fireEvent.click(screen.getByText('Mettre à jour maintenant'));
      await vi.advanceTimersByTimeAsync(3000);
      await waitFor(() => expect(reload).toHaveBeenCalled());
      expect(api.applyUpdate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
