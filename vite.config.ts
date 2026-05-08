import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { writeFileSync } from 'fs'

export default defineConfig({
  base: '/sistema-turnazione/',
  plugins: [
    react(),

    // ── Plugin: genera dist/version.json con il timestamp del build ──
    // Lo script in index.html lo confronta con l'ultimo valore noto in
    // localStorage e ricarica la pagina se il deploy è cambiato.
    {
      name: 'version-json',
      writeBundle() {
        writeFileSync('dist/version.json', JSON.stringify({ ts: Date.now() }))
      },
    },

    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,   // usiamo public/manifest.json

      workbox: {
        // ⚠️ HTML escluso dal precache: viene sempre scaricato dalla rete
        // così non viene mai servita una versione stale di index.html.
        // JS/CSS/assets con hash Vite: precachati (hash cambia → aggiornati automaticamente)
        globPatterns: ['**/*.{js,css,ico,png,svg,webmanifest}'],

        // Niente navigateFallback: GitHub Pages usa 404.html per l'SPA routing
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],

  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
