#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (!['open', 'close', 'setup', 'translate-blocks'].includes(args[0])) {
  console.error('Usage: mastermind open [--language CODE] -- FILE... | mastermind close -- FILE... | mastermind setup --suggest JSON | mastermind translate-blocks FILE --source-lang CODE --target-lang CODE [--save]')
  process.exit(2)
}
let command
let forwarded
let env = process.env
if (args[0] === 'translate-blocks') {
  // Resolved against the repo, not the cwd: agents invoke this wrapper from arbitrary directories.
  let tsx
  try {
    tsx = createRequire(path.join(root, 'package.json')).resolve('tsx')
  } catch {
    console.error('mastermind: dependencies missing. Run `npm install` in the mastermind repo.')
    process.exit(1)
  }
  command = process.execPath
  forwarded = ['--import', pathToFileURL(tsx).href, path.join(root, 'tools', 'translation', 'translation-cli.ts'), ...args.slice(1)]
} else {
  const name = process.platform === 'win32' ? 'mastermind-launch-console.exe' : 'mastermind-launch-check'
  const candidates = process.platform === 'darwin'
    ? [path.join(root, 'desktop', 'target', 'release', 'bundle', 'macos', 'mastermind.app', 'Contents', 'MacOS', name)]
    : [path.join(root, 'desktop', 'target', 'release', name)]
  const debug = path.join(root, 'desktop', 'target', 'debug', name)
  candidates.push(debug)
  command = candidates.find(existsSync)
  if (!command) {
    console.error('mastermind: native build missing. Run `npm run desktop:build` in the mastermind repo.')
    process.exit(1)
  }
  // A debug host trusts whatever page answers on the development server's port, so the fallback
  // only hands files to the host `npm run dev` already started and never starts one itself.
  if (command === debug) env = { ...env, MM_LAUNCH_CHECK_ATTACH_ONLY: '1' }
  forwarded = args
}
const child = spawn(command, forwarded, { stdio: 'inherit', env })
child.on('error', (error) => { console.error(`mastermind: ${error.message}`); process.exitCode = 1 })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
