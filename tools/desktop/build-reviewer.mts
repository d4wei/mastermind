import { build } from 'vite'
import path from 'node:path'

await build({ configFile: path.resolve(import.meta.dirname, '../../vite.config.ts') })
