import os from 'os';
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

// Publishes _jewelbox._tcp on the local network. Never throws: a LAN without
// multicast must not stop the server from serving over plain HTTP.
export function advertise({ port, version, serverId }) {
  if (!isMdnsEnabled()) {
    console.log('[mDNS] Disabled via MDNS_ENABLED=false');
    return null;
  }
  try {
    bonjour = new Bonjour();
    service = bonjour.publish({
      name: serviceName(),
      type: SERVICE_TYPE,
      port,
      txt: { app: 'jewelbox', version, api: '/api', id: serverId },
    });
    console.log(`[mDNS] Advertising "${serviceName()}" as _${SERVICE_TYPE}._tcp on port ${port}`);
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
