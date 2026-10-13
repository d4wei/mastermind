import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/ui'),
    emptyOutDir: true,
  },
})
