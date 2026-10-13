import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

async function run(file: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, stdout, stderr }))
  })
}

it('reports missing native builds and rejects retired commands', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-launch-'))
  try {
    await fs.mkdir(path.join(dir, 'bin'))
    const wrapper = path.join(dir, 'bin/mastermind.mjs')
    await fs.copyFile('bin/mastermind.js', wrapper)
    const missing = await run(wrapper, ['open', '--', 'document.md'])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('native build missing')
    for (const command of ['status', 'stop', 'workspace', 'new', 'config', 'install-agents']) {
      expect((await run(wrapper, [command])).code).toBe(2)
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('forwards open/setup arguments and waits for the native exit code', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-launch-'))
  try {
    await fs.mkdir(path.join(dir, 'bin'))
    const wrapper = path.join(dir, 'bin/mastermind.mjs')
    await fs.copyFile('bin/mastermind.js', wrapper)
    const native = path.join(dir, 'src-tauri/target/debug/mastermind-launch-check')
    await fs.mkdir(path.dirname(native), { recursive: true })
    await fs.writeFile(native, `#!${process.execPath}\nsetTimeout(() => { console.log(JSON.stringify(process.argv.slice(2))); process.exit(7) }, 30)\n`, { mode: 0o755 })
    for (const args of [['open', '--', 'a file.md'], ['setup', '--suggest', '{"theme":"grid"}']]) {
      const result = await run(wrapper, args)
      expect(result.code).toBe(7)
      expect(JSON.parse(result.stdout)).toEqual(args)
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

it('dispatches translation preparation to the built Node helper and keeps its exit code', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-translate-launch-'))
  try {
    await fs.mkdir(path.join(dir, 'bin'))
    const wrapper = path.join(dir, 'bin/mastermind.mjs')
    await fs.copyFile('bin/mastermind.js', wrapper)
    expect((await run(wrapper, ['translate-blocks', 'file.md'])).stderr).toContain('translation build missing')
    await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}')
    await fs.mkdir(path.join(dir, 'dist/node'), { recursive: true })
    await fs.writeFile(path.join(dir, 'dist/node/translation-cli.js'), 'setTimeout(() => { console.log(JSON.stringify(process.argv.slice(2))); process.exit(6) }, 30)')
    const args = ['file.md', '--source-lang', 'en', '--target-lang', 'zh-CN', '--save']
    const result = await run(wrapper, ['translate-blocks', ...args])
    expect(result.code).toBe(6)
    expect(JSON.parse(result.stdout)).toEqual(args)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'darwin')('prefers the macOS bundle executable over a debug build', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-bundle-launch-'))
  try {
    await fs.mkdir(path.join(dir, 'bin'))
    const wrapper = path.join(dir, 'bin/mastermind.mjs')
    await fs.copyFile('bin/mastermind.js', wrapper)
    for (const [location, label] of [
      ['release/bundle/macos/mastermind.app/Contents/MacOS', 'bundle'], ['debug', 'debug'],
    ]) {
      const binary = path.join(dir, 'src-tauri/target', location!, 'mastermind-launch-check')
      await fs.mkdir(path.dirname(binary), { recursive: true })
      await fs.writeFile(binary, `#!${process.execPath}\nconsole.log('${label}')\n`, { mode: 0o755 })
    }
    expect((await run(wrapper, ['setup'])).stdout.trim()).toBe('bundle')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
