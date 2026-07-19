import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const publish = vi.fn();
const unpublishAll = vi.fn();
const destroy = vi.fn();
const BonjourCtor = vi.fn();

vi.mock('bonjour-service', () => ({
  Bonjour: class {
    constructor() {
      BonjourCtor();
      this.publish = publish;
      this.unpublishAll = unpublishAll;
      this.destroy = destroy;
    }
  },
}));

const { advertise, stopAdvertising, isMdnsEnabled, serviceName, SERVICE_TYPE } =
  await import('../utils/mdns.js');

describe('mdns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publish.mockReturnValue({ name: 'stub' });
    unpublishAll.mockImplementation((cb) => cb());
    delete process.env.MDNS_ENABLED;
    delete process.env.MDNS_NAME;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await stopAdvertising();
    vi.restoreAllMocks();
  });

  it('publishes the service with the port, version and server id in TXT', () => {
    advertise({ port: 3001, version: '1.11.0', serverId: 'abc-123' });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: SERVICE_TYPE,
      port: 3001,
      txt: { app: 'jewelbox', version: '1.11.0', api: '/api', id: 'abc-123' },
    }));
  });

  it('skips advertising when MDNS_ENABLED=false', () => {
    process.env.MDNS_ENABLED = 'false';
    const result = advertise({ port: 3001, version: '1.11.0', serverId: 'abc' });

    expect(result).toBeNull();
    expect(BonjourCtor).not.toHaveBeenCalled();
    expect(isMdnsEnabled()).toBe(false);
  });

  it('is enabled by default and honours MDNS_NAME', () => {
    expect(isMdnsEnabled()).toBe(true);
    process.env.MDNS_NAME = 'Salon';
    expect(serviceName()).toBe('Salon');
  });

  // A LAN without multicast must not take the HTTP server down with it.
  it('survives a publish failure without throwing', () => {
    publish.mockImplementation(() => { throw new Error('no multicast'); });

    expect(() => advertise({ port: 3001, version: '1.11.0', serverId: 'abc' })).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Advertisement failed'),
      'no multicast',
    );
  });

  it('unpublishes and destroys on shutdown', async () => {
    advertise({ port: 3001, version: '1.11.0', serverId: 'abc' });
    await stopAdvertising();

    expect(unpublishAll).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('resolves harmlessly when nothing was advertised', async () => {
    await expect(stopAdvertising()).resolves.toBeUndefined();
    expect(unpublishAll).not.toHaveBeenCalled();
  });
});
