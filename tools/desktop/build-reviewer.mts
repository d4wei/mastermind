import { build } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { scanThemes } from '../../themes/discovery'

const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'desktop/reviewer-ui')
await build({
  configFile: false,
  root: path.join(root, 'ui'),
  plugins: [react()],
  publicDir: false,
  build: { target: 'esnext', outDir, emptyOutDir: true,
    rolldownOptions: { input: path.join(root, 'ui/desktop.html') } },
})
await fs.cp(path.join(root, 'themes'), path.join(outDir, 'themes'), { recursive: true,
  filter: (source) => !/\.(?:ts|md)$/.test(source) })
await fs.writeFile(path.join(outDir, 'themes.json'), JSON.stringify(await scanThemes(path.join(root, 'themes'))))

const licenses = path.join(outDir, 'licenses')
await fs.mkdir(licenses, { recursive: true })
await fs.copyFile(path.join(root, 'node_modules/node-diff3/LICENSE.md'), path.join(licenses, 'node-diff3.txt'))
