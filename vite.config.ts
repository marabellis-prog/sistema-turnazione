import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/sistema-turnazione/',
  plugins: [
    react(),

    VitePWA({
      // 'autoUpdate' = quando il browser rileva un nuovo SW lo installa
      // e ricarica la pagina silenziosamente, senza chiedere nulla all'utente.
      registerType: 'autoUpdate',

      // Usiamo il manifest.json già esistente in public/
      manifest: false,

      workbox: {
        // Precache tutti i file generati da Vite (JS/CSS con hash + HTML)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webmanifest}'],

        // SPA fallback: tutte le rotte non trovate → index.html (React Router)
        navigateFallback: '/sistema-turnazione/index.html',

        // Cancella automaticamente i cache delle versioni precedenti
        cleanupOutdatedCaches: true,

        // Nuovo SW prende il controllo subito (senza aspettare che tutte
        // le tab vengano chiuse) → reload immediato
        skipWaiting: true,
        clientsClaim: true,

        // Strategia runtime: HTML sempre dal network (mai dalla cache)
        // per garantire che index.html sia sempre aggiornato
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],

  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
