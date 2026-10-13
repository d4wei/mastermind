import { build } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { scanThemes } from '../../src/node/themes'

const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'src-tauri/reviewer-ui')
await build({
  configFile: false,
  root: path.join(root, 'src/ui'),
  plugins: [react()],
  publicDir: false,
  build: { target: 'esnext', outDir, emptyOutDir: true,
    rolldownOptions: { input: path.join(root, 'src/ui/native.html') } },
})
await fs.cp(path.join(root, 'themes'), path.join(outDir, 'themes'), { recursive: true })
await fs.writeFile(path.join(outDir, 'themes.json'), JSON.stringify(await scanThemes(path.join(root, 'themes'))))
