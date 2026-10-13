import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import pkg from '../package.json'

let dir: string
let file: string
let server: Server | null
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-cli-'))
  file = path.join(dir, 'doc.md')
  await fs.writeFile(file, '# Title\n\nHello\n')
  server = null
})
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await fs.rm(dir, { recursive: true, force: true })
})
function run(args: string[], input = ''): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('src/cli/index.ts'), ...args], {
      env: { ...process.env, MASTERMIND_CONFIG_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

it('requires explicit language codes and saves a complete fresh artifact', async () => {
  expect((await run(['translate-blocks', file])).code).not.toBe(0)
  const args = ['translate-blocks', file, '--source-lang', 'en', '--target-lang', 'zh-CN']
  const prepared = await run(args)
  expect(prepared.code).toBe(0)
  const plan = JSON.parse(prepared.stdout) as { sourceHash: string; blocks: Array<{ id: string; text: string; translatable: boolean }>; artifactPath: string }
  const artifact = { version: 1, sourceHash: plan.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: plan.blocks.filter((b) => b.translatable).map((b) => ({ id: b.id, text: b.text })) }
  expect((await run([...args, '--save'], JSON.stringify(artifact))).code).toBe(0)
  expect(JSON.parse(await fs.readFile(plan.artifactPath, 'utf8'))).toEqual(artifact)
  const fresh = await run(args)
  expect(JSON.parse(fresh.stdout).blocks).toEqual(plan.blocks)
  expect((await run([...args, '--save'], JSON.stringify({ ...artifact, blocks: [] }))).code).toBe(2)
}, 15_000)

it('opens a cold untranslated file and exits without an agent wait protocol', async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/health') {
      res.end(JSON.stringify({ ok: true, version: pkg.version, pid: process.pid, startedAt: 0 }))
    } else if (req.url === '/api/sessions' && req.method === 'POST') {
      res.end(JSON.stringify({ sessionId: 'review', url: 'http://localhost/d/review', created: true, isDraft: false }))
    } else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing server address')
  await fs.writeFile(path.join(dir, 'server.json'), JSON.stringify({ port: address.port, pid: process.pid, version: pkg.version, startedAt: 0 }))
  const opened = await run(['open', file, '--no-browser'])
  expect(opened.code).toBe(0)
  expect(opened.stdout.trim()).toBe('http://localhost/d/review')
  const help = await run(['open', '--help'])
  expect(help.stdout).not.toMatch(/--wait|--serve-assist|--no-assist|--no-translate/)
  expect((await run(['assist', file])).code).not.toBe(0)
}, 10_000)

it('reads earlier settings and writes canonical preference names through the CLI', async () => {
  const configPath = path.join(dir, 'config.json')
  const original = JSON.stringify({ authorTag: 'Alex', comfortLang: 'zh-CN', typeSet: 'lora' })
  await fs.writeFile(configPath, original)
  const read = await run(['config', 'get'])
  expect(read.code).toBe(0)
  expect(JSON.parse(read.stdout)).toMatchObject({ translationLanguage: 'zh-CN', fontPreset: 'lora' })
  expect(await fs.readFile(configPath, 'utf8')).toBe(original)
  const edited = await run(['config', 'set', 'translationLanguage=null', 'fontPreset=geist'])
  expect(edited.code).toBe(0)
  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'))
  expect(saved).toMatchObject({ translationLanguage: null, fontPreset: 'geist' })
  expect(saved).not.toHaveProperty('comfortLang')
  expect(saved).not.toHaveProperty('typeSet')
  const rejected = await run(['config', 'set', 'comfortLang=en'])
  expect(rejected.code).not.toBe(0)
  expect(rejected.stderr).toContain('unknown config key: comfortLang')
})
