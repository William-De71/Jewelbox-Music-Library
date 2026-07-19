import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      // Modules the test suite actually drives. Deliberately left out: the
      // external integrations (discogs, downloadCover, searchCache, search
      // routes), the manager/settings DB layer and version.js — they need
      // network or a real filesystem, and would only dilute the number.
      include: [
        'src/db/queries.js',
        'src/db/schema.js',
        'src/db/smartPlaylists.js',
        'src/routes/albums.js',
        'src/routes/player.js',
        'src/routes/playlists.js',
        'src/routes/smartPlaylists.js',
        'src/routes/lastfm.js',
        'src/utils/audioMatch.js',
        'src/utils/fsBrowser.js',
        'src/utils/lastfm.js',
      ],
      exclude: ['src/**/*.test.js'],
      // json-summary feeds the CI's coverage comment (.github/scripts/coverage_summary.py).
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        lines: 90,
        functions: 95,
        branches: 80,
        statements: 90,
      },
    },
  },
});
