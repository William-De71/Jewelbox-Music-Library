import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('../config/i18n/index.jsx', () => ({
  useI18n: () => ({ t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));
vi.mock('../api/client.js', () => ({
  api: {
    getBackups: vi.fn(),
    saveBackupSettings: vi.fn(() => Promise.resolve({})),
    createBackup: vi.fn(() => Promise.resolve({})),
    restoreBackup: vi.fn(() => Promise.resolve({ restored: ['william'] })),
    deleteBackup: vi.fn(() => Promise.resolve(null)),
  },
}));

import { api } from '../api/client.js';
import { BackupSettings, formatBytes } from '../components/BackupSettings.jsx';

const INFO = {
  settings: { frequency: 'daily', time: '03:00', weekday: 0, keep: 7, dir: '/data/backups' },
  default_dir: '/data/backups',
  next_at: '2026-10-28T02:00:00.000Z',
  running: false,
  backups: [
    { name: 'jewelbox-20261027-030000', created_at: '2026-10-27T02:00:00.000Z', reason: 'scheduled', databases: [{ name: 'william', covers: 3 }], size: 2_500_000 },
    { name: 'jewelbox-20261026-120000', created_at: '2026-10-26T11:00:00.000Z', reason: 'manual', databases: [{ name: 'jazz', covers: 0 }], size: 800 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getBackups.mockResolvedValue(INFO);
});

describe('BackupSettings', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 Ko');
    expect(formatBytes(800)).toBe('1 Ko');
    expect(formatBytes(2_500_000)).toBe('2,4 Mo');
  });

  it('lists the backups and saves the settings, the default folder as empty', async () => {
    render(<BackupSettings />);
    await screen.findByText('william');
    expect(screen.getByText('backup.reasons.manual')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('backup.keep'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('backup.save'));
    await waitFor(() => expect(api.saveBackupSettings).toHaveBeenCalledWith({
      frequency: 'daily', time: '03:00', weekday: 0, keep: 10, dir: '',
    }));
  });

  it('backs up now, and deletes after a confirmation', async () => {
    const notify = vi.fn();
    render(<BackupSettings notify={notify} />);
    await screen.findByText('william');
    fireEvent.click(screen.getByText('backup.now'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('backup.done', 'success'));
    fireEvent.click(screen.getAllByLabelText('backup.delete')[1]);
    expect(api.deleteBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('backup.delete', { selector: 'button.btn-danger' }));
    await waitFor(() => expect(api.deleteBackup).toHaveBeenCalledWith('jewelbox-20261026-120000'));
  });

  it('says when the server is too old', async () => {
    api.getBackups.mockRejectedValue(new Error('HTTP 404'));
    render(<BackupSettings />);
    await screen.findByText('backup.unavailable');
  });
});
