import os from 'os';
import dgram from 'dgram';
import { Bonjour } from 'bonjour-service';

// Zeroconf advertisement so the mobile app finds the server without being told
// an IP address — the LAN one changes on every DHCP lease.
//
// Multicast does not cross Docker's default bridge NAT: in a container the
// advertisement is invisible from the LAN unless the compose file uses
// network_mode: host. Set MDNS_ENABLED=false there to skip it cleanly.

export const SERVICE_TYPE = 'jewelbox';

let bonjour = null;
let service = null;

export function isMdnsEnabled() {
  return String(process.env.MDNS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function serviceName() {
  return process.env.MDNS_NAME || `JewelBox (${os.hostname()})`;
}

// Asks the kernel which source address the default route would use. A UDP
// connect() sends no packet: it only binds the socket to the routed interface.
// Docker bridges never carry the default route, so this reliably skips them.
function defaultRouteAddress() {
  return new Promise((resolve) => {
    let socket;
    const finish = (addr) => {
      try { socket?.close(); } catch { /* already closed */ }
      resolve(addr);
    };
    try {
      socket = dgram.createSocket('udp4');
      socket.on('error', () => finish(null));
      socket.connect(53, '8.8.8.8', () => {
        try {
          finish(socket.address().address);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

// The IPv4 the A record should carry: MDNS_ADDRESS wins, then the default
// route's address, then null — meaning "advertise everything" as before.
export async function pickAdvertisedAddress() {
  const forced = String(process.env.MDNS_ADDRESS || '').trim();
  if (forced) return forced;
  return defaultRouteAddress();
}

// bonjour-service advertises one A/AAAA record per non-internal interface —
// Docker bridges included. On a host running containers that meant clients
// resolved 172.x.0.1 and could never connect. Keep only the chosen address,
// unless that would strip every address record (a wrong MDNS_ADDRESS must
// degrade to the old behavior, not to an unreachable service).
export function filterAddressRecords(records, address) {
  if (!address) return records;
  const isAddress = (r) => r.type === 'A' || r.type === 'AAAA';
  const filtered = records.filter(r => !isAddress(r) || r.data === address);
  return filtered.some(isAddress) ? filtered : records;
}

// Publishes _jewelbox._tcp on the local network. Never throws: a LAN without
// multicast must not stop the server from serving over plain HTTP.
export async function advertise({ port, version, serverId }) {
  if (!isMdnsEnabled()) {
    console.log('[mDNS] Disabled via MDNS_ENABLED=false');
    return null;
  }
  try {
    // Resolved before publish so the records patch below lands synchronously,
    // before the first announcement can fire.
    const address = await pickAdvertisedAddress();
    bonjour = new Bonjour();
    service = bonjour.publish({
      name: serviceName(),
      type: SERVICE_TYPE,
      port,
      txt: { app: 'jewelbox', version, api: '/api', id: serverId },
    });
    const originalRecords = service.records.bind(service);
    service.records = () => filterAddressRecords(originalRecords(), address);
    console.log(
      `[mDNS] Advertising "${serviceName()}" as _${SERVICE_TYPE}._tcp on port ${port}` +
      (address ? ` (address ${address})` : ''),
    );
    return service;
  } catch (err) {
    console.warn('[mDNS] Advertisement failed, discovery unavailable:', err.message);
    bonjour = null;
    service = null;
    return null;
  }
}

// Withdraws the service so it does not linger in client caches after shutdown.
export function stopAdvertising() {
  return new Promise((resolve) => {
    if (!bonjour) return resolve();
    const done = () => {
      try {
        bonjour.destroy();
      } catch { /* already torn down */ }
      bonjour = null;
      service = null;
      resolve();
    };
    try {
      bonjour.unpublishAll(done);
    } catch {
      done();
    }
  });
}
