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

const {
  advertise, stopAdvertising, isMdnsEnabled, serviceName, SERVICE_TYPE,
  pickAdvertisedAddress, filterAddressRecords,
} = await import('../utils/mdns.js');

// What bonjour-service's Service.records() produces: one A/AAAA per
// non-internal interface — Docker bridges included, hence the filtering.
const RECORDS = [
  { type: 'PTR', data: 'JewelBox._jewelbox._tcp.local' },
  { type: 'SRV', data: { port: 3001 } },
  { type: 'TXT', data: {} },
  { type: 'A', data: '10.0.20.21' },
  { type: 'A', data: '172.18.0.1' },
  { type: 'AAAA', data: 'fe80::1' },
];

function stubService() {
  return { name: 'stub', records: () => [...RECORDS] };
}

describe('mdns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publish.mockImplementation(() => stubService());
    unpublishAll.mockImplementation((cb) => cb());
    delete process.env.MDNS_ENABLED;
    delete process.env.MDNS_NAME;
    delete process.env.MDNS_ADDRESS;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await stopAdvertising();
    vi.restoreAllMocks();
  });

  it('publishes the service with the port, version and server id in TXT', async () => {
    await advertise({ port: 3001, version: '1.11.0', serverId: 'abc-123' });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: SERVICE_TYPE,
      port: 3001,
      txt: { app: 'jewelbox', version: '1.11.0', api: '/api', id: 'abc-123' },
    }));
  });

  it('skips advertising when MDNS_ENABLED=false', async () => {
    process.env.MDNS_ENABLED = 'false';
    const result = await advertise({ port: 3001, version: '1.11.0', serverId: 'abc' });

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
  it('survives a publish failure without throwing', async () => {
    publish.mockImplementation(() => { throw new Error('no multicast'); });

    await expect(advertise({ port: 3001, version: '1.11.0', serverId: 'abc' }))
      .resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Advertisement failed'),
      'no multicast',
    );
  });

  it('unpublishes and destroys on shutdown', async () => {
    await advertise({ port: 3001, version: '1.11.0', serverId: 'abc' });
    await stopAdvertising();

    expect(unpublishAll).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('resolves harmlessly when nothing was advertised', async () => {
    await expect(stopAdvertising()).resolves.toBeUndefined();
    expect(unpublishAll).not.toHaveBeenCalled();
  });

  // Regression: on a Docker host in network_mode host, every bridge (172.x.0.1)
  // got its own A record and clients resolved an unreachable address.
  it('advertises only MDNS_ADDRESS when set, dropping bridge records', async () => {
    process.env.MDNS_ADDRESS = '10.0.20.21';
    const service = await advertise({ port: 3001, version: '1.12.1', serverId: 'abc' });

    const records = service.records();
    expect(records.filter(r => r.type === 'A')).toEqual([{ type: 'A', data: '10.0.20.21' }]);
    expect(records.some(r => r.type === 'AAAA')).toBe(false);
    // Non-address records pass through untouched.
    expect(records.filter(r => ['PTR', 'SRV', 'TXT'].includes(r.type))).toHaveLength(3);
  });

  describe('pickAdvertisedAddress', () => {
    it('prefers MDNS_ADDRESS over autodetection', async () => {
      process.env.MDNS_ADDRESS = '  10.0.20.21  ';
      expect(await pickAdvertisedAddress()).toBe('10.0.20.21');
    });

    it('autodetects without throwing (string or null)', async () => {
      const addr = await pickAdvertisedAddress();
      expect(addr === null || typeof addr === 'string').toBe(true);
    });
  });

  describe('filterAddressRecords', () => {
    it('returns records untouched when no address was picked', () => {
      expect(filterAddressRecords(RECORDS, null)).toEqual(RECORDS);
    });

    it('keeps only the matching address record', () => {
      const filtered = filterAddressRecords(RECORDS, '10.0.20.21');
      expect(filtered.filter(r => r.type === 'A' || r.type === 'AAAA'))
        .toEqual([{ type: 'A', data: '10.0.20.21' }]);
    });

    // A wrong MDNS_ADDRESS must degrade to the old behavior, never to a
    // service with no address at all.
    it('falls back to all records when nothing matches', () => {
      expect(filterAddressRecords(RECORDS, '192.0.2.99')).toEqual(RECORDS);
    });
  });
});
