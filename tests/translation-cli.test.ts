import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

let dir: string
let file: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-cli-'))
  file = path.join(dir, 'doc.md')
  await fs.writeFile(file, '# Title\n\nHello\n')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
function run(args: string[], input = ''): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tools/translation/translation-cli.ts'), ...args], {
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
  expect((await run([file])).code).not.toBe(0)
  const args = [file, '--source-lang', 'en', '--target-lang', 'zh-CN']
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
