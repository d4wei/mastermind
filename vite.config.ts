import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: path.join(import.meta.dirname, 'ui'),
  plugins: [react()],
  publicDir: false,
})
