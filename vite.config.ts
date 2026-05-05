import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/sistema-turnazione/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
