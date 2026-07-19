import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getDeviceId caches at module level: re-import a fresh copy for each test.
async function freshGetDeviceId() {
  vi.resetModules();
  const mod = await import('../utils/deviceId.js');
  return mod.getDeviceId;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('getDeviceId', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('generates a uuid, persists it and returns the same id on every call', async () => {
    const getDeviceId = await freshGetDeviceId();
    const id = getDeviceId();

    expect(id).toMatch(UUID_V4);
    expect(getDeviceId()).toBe(id);
    expect(localStorage.getItem('jewelbox-device-id')).toBe(id);
  });

  // Regression: production is served over http://<lan-ip>, an insecure context
  // where crypto.randomUUID does not exist. This once threw from every API
  // request and took the whole app down (albums, playlists, stats, version).
  it('does not throw when crypto.randomUUID is unavailable (insecure context)', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i * 17 % 256;
        return arr;
      },
    });

    const getDeviceId = await freshGetDeviceId();
    const id = getDeviceId();

    // Still a well-formed v4 UUID, built from getRandomValues.
    expect(id).toMatch(UUID_V4);
  });

  it('still returns an id when crypto is entirely absent', async () => {
    vi.stubGlobal('crypto', undefined);

    const getDeviceId = await freshGetDeviceId();
    expect(getDeviceId()).toMatch(/^dev-/);
  });

  it('falls back to a per-session id when storage is denied', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const getDeviceId = await freshGetDeviceId();
    const id = getDeviceId();
    expect(id).toBeTruthy();
    expect(getDeviceId()).toBe(id); // cached in memory for the session

    getItem.mockRestore();
  });
});
