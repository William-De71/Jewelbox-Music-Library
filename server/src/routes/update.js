import { APP_VERSION } from './version.js';

// New JewelBox releases, and the "update now" button backed by Watchtower's
// HTTP API (UPDATER_TOKEN, UPDATER_URL): it pulls the image and recreates the
// container. Same mechanism as Projectory.

const REPO = 'William-De71/Jewelbox-Music-Library';
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

// A fixed image tag (1.2.3 / v1.2.3) never moves: pulling it again brings nothing new.
const followsReleases = (tag) => !/^v?\d+\.\d+\.\d+/.test(tag);

const looksLikeVersion = (v) => /^v?\d+(\.\d+)+/.test(String(v));

// Loose semver: "v1.10.0" > "1.9.3", "2.0.0-rc1" < "2.0.0".
export function compareVersions(a, b) {
  const parse = (v) => {
    const [main, pre = ''] = String(v).trim().replace(/^v/i, '').split('-', 2);
    return { nums: main.split('.').map((n) => parseInt(n, 10) || 0), pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const diff = (pa.nums[i] || 0) - (pb.nums[i] || 0);
    if (diff) return Math.sign(diff);
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': `JewelBox/${APP_VERSION}`, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function updateRoutes(fastify, { version = APP_VERSION } = {}) {
  let cache = null;

  const latestRelease = async () => {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.release;
    const res = await call(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    const r = await res.json();
    const release = {
      version: String(r.tag_name).replace(/^v/, ''),
      url: r.html_url,
      notes: r.body || '',
      published_at: r.published_at,
    };
    cache = { at: Date.now(), release };
    return release;
  };

  fastify.get('/api/update', async (req) => {
    if (req.query?.refresh) cache = null;
    const imageTag = process.env.IMAGE_TAG || 'latest';
    const status = {
      current: version,
      can_update: Boolean(process.env.UPDATER_TOKEN) && followsReleases(imageTag),
      image_tag: imageTag,
    };
    try {
      const latest = await latestRelease();
      return {
        ...status,
        latest,
        available: looksLikeVersion(version) && compareVersions(latest.version, version) > 0,
      };
    } catch (err) {
      return { ...status, latest: null, available: false, error: err.message };
    }
  });

  fastify.post('/api/update', async (req, reply) => {
    const token = process.env.UPDATER_TOKEN;
    if (!token) return reply.code(400).send({ error: 'Automatic update not configured (UPDATER_TOKEN)' });
    const base = (process.env.UPDATER_URL || 'http://watchtower:8080').replace(/\/+$/, '');
    try {
      // async: Watchtower answers right away, then replaces this very container.
      await call(`${base}/v1/update?async=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      return reply.code(502).send({ error: `Watchtower unreachable: ${err.message}` });
    }
    return { ok: true };
  });
}
