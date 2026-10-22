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
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('translation CLI did not exit'))
    }, 10_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    child.stdin.end(input)
  })
}

interface Plan {
  sourceHash: string
  blocks: Array<{ id: string; text: string; translatable: boolean }>
  artifactPath: string
}
function argumentsForFile() {
  return [file, '--source-lang', 'en', '--target-lang', 'zh-CN']
}
async function prepareArtifact() {
  const prepared = await run(argumentsForFile())
  expect(prepared.code).toBe(0)
  expect(prepared.stderr).toBe('')
  const plan = JSON.parse(prepared.stdout) as Plan
  const artifact = { version: 1, sourceHash: plan.sourceHash, sourceLang: 'en', targetLang: 'zh-CN',
    blocks: plan.blocks.filter((block) => block.translatable).map((block) => ({ id: block.id, text: block.text })) }
  return { plan, artifact }
}

it.each([
  ['source-lang', ['--target-lang', 'zh-CN']], ['target-lang', ['--source-lang', 'en']],
])('requires the explicit %s option', async (missing, options) => {
  const result = await run([file, ...options])
  expect(result.code).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain(`--${missing}`)
  expect(await fs.readdir(dir)).toEqual(['doc.md'])
})

it('saves a complete artifact and emits every block on the next preparation', async () => {
  const { plan, artifact } = await prepareArtifact()
  const saved = await run([...argumentsForFile(), '--save'], JSON.stringify(artifact))
  expect(saved.code).toBe(0)
  expect(saved.stderr).toBe('')
  expect(JSON.parse(saved.stdout)).toEqual({ artifactPath: plan.artifactPath, written: artifact.blocks.length })
  expect(JSON.parse(await fs.readFile(plan.artifactPath, 'utf8'))).toEqual(artifact)
  const fresh = await run(argumentsForFile())
  expect(fresh.code).toBe(0)
  expect(JSON.parse(fresh.stdout).blocks).toEqual(plan.blocks)
}, 15_000)

it('rejects an incomplete saved artifact without changing the previous artifact', async () => {
  const { plan, artifact } = await prepareArtifact()
  expect((await run([...argumentsForFile(), '--save'], JSON.stringify(artifact))).code).toBe(0)
  const previous = await fs.readFile(plan.artifactPath)
  const rejected = await run([...argumentsForFile(), '--save'], JSON.stringify({ ...artifact, blocks: [] }))
  expect(rejected.code).toBe(2)
  expect(rejected.stdout).toBe('')
  expect(rejected.stderr).toContain('complete block structure')
  expect(await fs.readFile(plan.artifactPath)).toEqual(previous)
}, 15_000)

it('reports a directory argument as a directory rather than a missing file', async () => {
  const folder = path.join(dir, 'chapter.md')
  await fs.mkdir(folder)
  const result = await run([folder, '--source-lang', 'en', '--target-lang', 'zh-CN'])
  expect(result.code).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain(`not a file: ${folder} is a directory`)
})

it('rejects a path that is not Markdown, including a Markdown-named link to one', async () => {
  const text = path.join(dir, 'notes.txt')
  await fs.writeFile(text, '# Title\n')
  const targets = [text]
  if (process.platform !== 'win32') {
    targets.push(path.join(dir, 'alias.md'))
    await fs.symlink(text, targets[1]!)
  }
  for (const target of targets) {
    const result = await run([target, '--source-lang', 'en', '--target-lang', 'zh-CN'])
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Choose a Markdown file (.md or .markdown)')
  }
})

it('reports a missing file as not found', async () => {
  const missing = path.join(dir, 'missing.md')
  const result = await run([missing, '--source-lang', 'en', '--target-lang', 'zh-CN'])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain(`file not found: ${missing}`)
})
