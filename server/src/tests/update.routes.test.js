import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { updateRoutes, compareVersions } from '../routes/update.js';

const RELEASE_URL = 'https://api.github.com/repos/William-De71/Jewelbox-Music-Library/releases/latest';

// Fake GitHub release and Watchtower API: the tests never touch the network.
const calls = [];
const fetchMock = vi.fn(async (url, init = {}) => {
  url = String(url);
  calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization });
  if (url === RELEASE_URL) {
    return new Response(JSON.stringify({
      tag_name: 'v99.0.0', html_url: 'https://gh/v99', body: '- tout', published_at: '2026-10-27T00:00:00Z',
    }));
  }
  if (url.startsWith('http://watchtower:8080/v1/update')) return new Response('', { status: 200 });
  return new Response('not found', { status: 404 });
});

let app;
beforeAll(async () => {
  for (const key of ['UPDATER_TOKEN', 'UPDATER_URL', 'IMAGE_TAG']) delete process.env[key];
  vi.stubGlobal('fetch', fetchMock);
  app = Fastify({ logger: false });
  await app.register(updateRoutes, { version: '1.18.1' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
});
afterEach(() => {
  for (const key of ['UPDATER_TOKEN', 'UPDATER_URL', 'IMAGE_TAG']) delete process.env[key];
});

const call = async (method, url) => {
  const res = await app.inject({ method, url });
  return { status: res.statusCode, body: res.json() };
};

describe('GET /api/update', () => {
  it('reports a newer release; the button needs Watchtower', async () => {
    const { body } = await call('GET', '/api/update');
    expect(body).toMatchObject({
      current: '1.18.1', available: true, can_update: false, image_tag: 'latest',
      latest: { version: '99.0.0', url: 'https://gh/v99', notes: '- tout' },
    });
    expect((await call('POST', '/api/update')).status).toBe(400);
  });

  it('caches the release, refresh=1 asks GitHub again', async () => {
    const count = () => calls.filter((c) => c.url === RELEASE_URL).length;
    await call('GET', '/api/update');
    const before = count();
    await call('GET', '/api/update');
    expect(count()).toBe(before);
    await call('GET', '/api/update?refresh=1');
    expect(count()).toBe(before + 1);
  });

  it('says nothing is available when GitHub cannot be reached', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 503 }));
    const { body } = await call('GET', '/api/update?refresh=1');
    expect(body).toMatchObject({ available: false, latest: null, error: 'HTTP 503' });
  });
});

describe('POST /api/update', () => {
  it('calls Watchtower with the token, not for a fixed image tag', async () => {
    process.env.UPDATER_TOKEN = 'secret';
    expect((await call('GET', '/api/update')).body.can_update).toBe(true);
    expect(await call('POST', '/api/update')).toEqual({ status: 200, body: { ok: true } });
    const hit = calls.find((c) => c.url === 'http://watchtower:8080/v1/update?async=true');
    expect(hit).toMatchObject({ method: 'POST', auth: 'Bearer secret' });

    process.env.IMAGE_TAG = 'v1.18.1';
    expect((await call('GET', '/api/update')).body.can_update).toBe(false);
    process.env.IMAGE_TAG = 'v1.18';
    expect((await call('GET', '/api/update')).body.can_update).toBe(true);
  });

  it('answers 502 when Watchtower is unreachable', async () => {
    process.env.UPDATER_TOKEN = 'secret';
    process.env.UPDATER_URL = 'http://nowhere:8080/';
    expect((await call('POST', '/api/update')).status).toBe(502);
  });
});

describe('compareVersions', () => {
  it('orders versions loosely', () => {
    expect(compareVersions('v1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.18.1', '1.18.1')).toBe(0);
    expect(compareVersions('2.0.0-rc1', '2.0.0')).toBe(-1);
    expect(compareVersions('1.18', '1.18.1')).toBe(-1);
  });
});
