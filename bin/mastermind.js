#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (!['open', 'setup', 'translate-blocks'].includes(args[0])) {
  console.error('Usage: mastermind open [--language CODE] -- FILE... | mastermind setup --suggest JSON | mastermind translate-blocks FILE --source-lang CODE --target-lang CODE [--save]')
  process.exit(2)
}
let command
let forwarded
if (args[0] === 'translate-blocks') {
  const helper = path.join(root, 'dist', 'node', 'translation-cli.js')
  if (!existsSync(helper)) {
    console.error('mastermind: translation build missing. Run `npm run build` in the mastermind repo.')
    process.exit(1)
  }
  command = process.execPath
  forwarded = [helper, ...args.slice(1)]
} else {
  const name = process.platform === 'win32' ? 'mastermind-launch-console.exe' : 'mastermind-launch-check'
  const candidates = process.platform === 'darwin'
    ? [path.join(root, 'desktop', 'target', 'release', 'bundle', 'macos', 'mastermind.app', 'Contents', 'MacOS', name)]
    : [path.join(root, 'desktop', 'target', 'release', name)]
  // A debug build is the deliberate source-checkout fallback when no release bundle exists.
  candidates.push(path.join(root, 'desktop', 'target', 'debug', name))
  command = candidates.find(existsSync)
  if (!command) {
    console.error('mastermind: native build missing. Run `npm run desktop:build` in the mastermind repo.')
    process.exit(1)
  }
  forwarded = args
}
const child = spawn(command, forwarded, { stdio: 'inherit' })
child.on('error', (error) => { console.error(`mastermind: ${error.message}`); process.exitCode = 1 })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
