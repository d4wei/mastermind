import { spawnSync } from 'node:child_process'
import path from 'node:path'

const result = spawnSync(process.execPath,
  [path.join(import.meta.dirname, 'node_modules/@tauri-apps/cli/tauri.js'), ...process.argv.slice(2)],
  { cwd: path.resolve(import.meta.dirname, '../..'), stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
