import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Temporary viewer for the LMS demo seed: proxies to the parallel API on :3011
// (which runs the LMS-enabled build) instead of the live :3001. This file is a
// throwaway — delete it after verifying the LMS UI. Do NOT commit.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, globPatterns: ['**/*.{js,css,html,woff2}'] },
      manifest: {
        name: 'POS Cafe', short_name: 'POS', description: 'Cafe point of sale — works offline',
        theme_color: '#1B1B1F', background_color: '#FFFBFE', display: 'standalone',
        orientation: 'landscape', start_url: '/pos', scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5174,
    host: true,
    proxy: { '/api/v1': { target: 'http://localhost:3011', changeOrigin: true } },
  },
  preview: { port: 4174, host: true },
});
