import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatMark, inventoryMarks } from '../tools/marks/inventory'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-marks-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('bin/mastermind.js'), 'marks', ...args],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    const timer = setTimeout(() => { child.kill(); reject(new Error('marks CLI did not exit')) }, 10_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}
async function write(name: string, source: string) {
  await fs.writeFile(path.join(dir, name), source)
  return name
}
const problems = (source: string) => inventoryMarks(source).problems.map(({ line, column, message }) =>
  `L${line}:${column}: ${message}`)

describe('mastermind marks', () => {
  it('prints one line per mark in file order', async () => {
    const file = await write('doc.md', [
      'Add {++new text++}, drop {--old--}, and {~~this~>that~~}.',
      '',
      'Keep {==the limit==}{>>@alice: Why this',
      '  number?<<}{>>@claude: It matches the server.<<} here.',
      '',
      '{>>Untagged note<<}',
      '',
      'A {==plain highlight==} and a quote: {>>@bo: say "hi"<<}',
      '',
    ].join('\n'))
    const result = await run([file])
    expect(result).toEqual({ code: 0, stderr: '', stdout: [
      'L1:5 insert @? "new text"',
      'L1:26 delete @? "old"',
      'L1:41 substitute @? "this" -> "that"',
      'L3:21 comment @alice "Why this number?" on "the limit" #1',
      'L4:13 comment @claude "It matches the server." on "the limit" #1',
      'L6:1 comment @? "Untagged note" #2',
      'L8:3 highlight @? "plain highlight"',
      'L8:38 comment @bo "say \\"hi\\"" #3',
      '',
    ].join('\n') })
  })

  it('starts a new discussion when anything separates two comments', () => {
    const { marks } = inventoryMarks('{==a==}{>>@x: q<<} {>>@y: r<<}\n')
    expect(marks.map(({ thread, anchor }) => [thread, anchor])).toEqual([[1, 'a'], [2, undefined]])
  })

  it('prints the structured form with --json', async () => {
    const file = await write('doc.md', '> Quote {~~a~>b~~} and {==x==}{>>@alice: one\n> two<<}\n')
    const result = await run(['--json', file])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([{ file, problems: [], marks: [
      { line: 1, column: 9, offset: 8, end: 18, kind: 'substitute', author: null, old: 'a', new: 'b' },
      { line: 1, column: 31, offset: 30, end: 53, kind: 'comment', author: 'alice', text: 'one\ntwo', anchor: 'x',
        thread: 1 },
    ] }])
  })

  it('prefixes each line with its file when given several', async () => {
    const a = await write('a.md', '{++one++}\n')
    const b = await write('b.md', 'x {--two--}\n')
    expect((await run([a, b])).stdout).toBe('a.md:L1:1 insert @? "one"\nb.md:L1:3 delete @? "two"\n')
  })

  it('counts columns in code points past a byte order mark, and lines across CRLF', () => {
    expect(inventoryMarks('\ufeff😀 {++a++}\n').marks[0]).toMatchObject({ line: 1, column: 3 })
    expect(formatMark(inventoryMarks('a\r\n{++b\r\n  c++}\r\n').marks[0]!)).toBe('L2:1 insert @? "b c"')
  })

  it('leaves delimiters in code, frontmatter, raw HTML, and link destinations inert', () => {
    const source = [
      '---',
      'title: "{++not a mark++}"',
      '---',
      '',
      'Inline `{++code++}` and [text](https://x.test/{--path--}) and <span title="{==raw==}">x</span>.',
      '',
      '```',
      '{>>fenced<<} --}',
      '```',
      '',
      '<div>{++html block',
      '',
      '</div>',
      '',
      'Escaped \\{++literal++} stays text. [{++link text++}](https://x.test)',
      '',
    ].join('\n')
    const { marks, problems } = inventoryMarks(source)
    expect(problems).toEqual([])
    expect(marks.map((mark) => mark.text)).toEqual(['link text'])
  })

  it('does not list resolved-thread records as marks', () => {
    const record = JSON.stringify({ context: 'ctx', thread: '\\u007b>>@alice: done<<\\u007d' })
    const source = `Text {>>@bo: open<<}\n\n<!-- mastermind:resolved-thread v1\n${record}\n-->\n`
    expect(inventoryMarks(source)).toEqual({ problems: [], marks: [
      expect.objectContaining({ kind: 'comment', author: 'bo', text: 'open', thread: 1 }),
    ] })
  })

  it('reports each delimiter the app leaves as literal text', () => {
    expect(problems('One {++unclosed\n\nnext block++} here\n')).toEqual([
      'L1:5: unclosed "{++": no "++}" in the same block',
      'L3:11: stray "++}" with no matching opener in its block',
    ])
    expect(problems('A {~~missing separator~~} and {--fine--}\n')).toEqual([
      'L1:3: substitution "{~~" has no "~>" before its "~~}"',
    ])
    expect(problems('Stray <<} closer\n')).toEqual(['L1:7: stray "<<}" with no matching opener in its block'])
    expect(problems('{++ outer {-- inner --} ++}\n')).toEqual([
      'L1:11: "{--" inside an insertion is literal text; marks do not nest',
    ])
    expect(problems('{== a {>> b ==} <<}\n')).toEqual([
      'L1:7: "{>>" inside a highlight is literal text; marks do not nest',
      'L1:17: stray "<<}" with no matching opener in its block',
    ])
  })

  it('reports marks the app cannot mask', () => {
    let crowded = ''
    for (let code = 0xe000; code <= 0xf8ff; code++) crowded += String.fromCharCode(code)
    expect(problems(`${crowded}\n\n{++a++}\n`)).toEqual([
      'L1:1: the file uses nearly every Private Use Area character, so the app shows none of its marks',
    ])
  })

  it('still lists the valid marks beside a malformed one', () => {
    const { marks, problems } = inventoryMarks('{++open {--gone--}\n')
    expect(marks.map((mark) => mark.kind)).toEqual(['delete'])
    expect(problems).toHaveLength(1)
  })

  it('exits 1 and names each malformed mark on stderr', async () => {
    const file = await write('bad.md', 'Fine {++yes++}.\n\nBroken {>>@alice: no closer\n')
    const result = await run([file])
    expect(result).toEqual({ code: 1, stdout: 'L1:6 insert @? "yes"\n',
      stderr: 'bad.md:L3:8: unclosed "{>>": no "<<}" in the same block\n' })
  })

  it('exits 2 on invalid invocation', async () => {
    for (const args of [[], ['--yaml', 'x.md'], ['missing.md']]) {
      const result = await run(args)
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage: mastermind marks [--json] FILE...')
    }
  })

  it('parses the skill demo clean', async () => {
    const result = await run([path.resolve('.claude/skills/mastermind/reference/demo.md')])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toBe('')
  })
})
