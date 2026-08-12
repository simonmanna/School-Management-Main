import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    // P3 offline: injectManifest (not generateSW) because the service worker
    // also carries the Web Push handlers — see src/sw.ts.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        // The POS bundle is chunky (charts, icons); the 2MB default would
        // silently drop entries from the precache.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,woff2}'],
      },
      manifest: {
        name: 'POS Cafe',
        short_name: 'POS',
        description: 'Cafe point of sale — works offline',
        theme_color: '#1B1B1F',
        background_color: '#FFFBFE',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/pos',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        // Keep the SW out of the way during development; test it via `preview`.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Bind all interfaces so other devices on the cafe LAN can open the
    // terminal at http://<this-machine-ip>:5173.
    host: true,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
});
