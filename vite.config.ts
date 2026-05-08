import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'

export default defineConfig({
  base: '/sistema-turnazione/',
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
