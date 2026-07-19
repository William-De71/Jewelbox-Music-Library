import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read version from package.json
let version = '1.0.0';
try {
  const packageJsonPath = path.resolve(__dirname, '../../../package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  version = packageJson.version;
} catch (err) {
  console.error('[Version] Failed to read version from package.json:', err);
}

export { version as APP_VERSION };

export async function versionRoutes(fastify) {
  fastify.get('/api/version', async (req, reply) => {
    return {
      version,
      name: 'JewelBox Music Library',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    };
  });
}
