import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

/**
 * The portal is its own app for reasons that show up here.
 *
 * `@erp/web` ships ~292 eagerly-imported routes in one 6 MB chunk and a PWA
 * manifest that calls itself "POS Cafe" in landscape. That is the right shape for
 * a back-office terminal on the school's own network and the wrong shape for a
 * guardian opening a fee balance on a phone over mobile data. Same API, same
 * tokens, different front door.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'School Portal',
        short_name: 'Portal',
        description: 'Results, attendance, fees and coursework for pupils, guardians and teachers.',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        // Portrait: the overwhelming majority of portal traffic is a phone held
        // upright, which is also the case the admin app never has to serve.
        orientation: 'portrait',
        // `/` is the public school website; someone who installed this to their
        // home screen did so to reach their own child, not to read the
        // admissions page. `/home` is the landing redirect — it sends a signed-in
        // account to its own workspace and everyone else to the login screen.
        start_url: '/home',
        // Scope stays at the root so the installed app can still navigate to the
        // public pages (term dates, the school's phone number) without kicking
        // the visitor out to a browser tab.
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Never serve a stale API response for money or marks. The shell is
        // cached; the data is not.
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5175,
    // Bind all interfaces so a phone on the school wifi can reach the dev server.
    host: true,
    proxy: {
      '/api/v1': { target: 'http://localhost:3003', changeOrigin: true },
    },
  },
  build: {
    // Named chunks per audience: a guardian should not download the teacher's
    // marking screens, and vice versa.
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
