import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'
import pkg from './package.json' assert { type: 'json' }

const buildDate = new Date().toLocaleDateString('it-IT', {
  day: '2-digit', month: '2-digit', year: '2-digit',
})

// In CI (GitHub Actions) usa il commit SHA, in locale mostra 'dev'
const buildSha = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'dev'

export default defineConfig({
  base: '/sistema-turnazione/',

  define: {
    __APP_VERSION__: JSON.stringify(buildSha),
    __BUILD_DATE__:  JSON.stringify(buildDate),
  },

  plugins: [
    react(),

    // Genera dist/version.json con il timestamp del build.
    // Lo script in index.html lo controlla ogni 30s e ricarica se cambia.
    {
      name: 'version-json',
      writeBundle() {
        writeFileSync('dist/version.json', JSON.stringify({ ts: Date.now() }))
      },
    },
  ],

  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
