import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'JewelBox Music Library',
        short_name: 'JewelBox',
        description: "Parce que vos albums méritent mieux qu'une simple étagère.",
        theme_color: '#206bc4',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Never serve the SPA shell for API/file URLs (audio streams, covers)
        navigateFallbackDenylist: [/^\/api\//, /^\/covers\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/albums/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-albums', expiration: { maxEntries: 200 } },
          },
          {
            urlPattern: /^https:\/\/coverartarchive\.org/,
            handler: 'CacheFirst',
            options: { cacheName: 'covers', expiration: { maxEntries: 500, maxAgeSeconds: 604800 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
      '/covers': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.js'],
  },
});
