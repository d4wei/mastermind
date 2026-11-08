// Writes the performance fixtures into tools/perf/fixtures/ (git-ignored). Output is a pure function
// of the constants below, so every audit measures the same bytes; baselines.json records the SHA-256
// of each fixture it was measured against, and running this file compares them.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// Review documents: prose, tables, code, lists, CJK, comment threads with replies and suggestions.
// `rnd` is shared and stateful: large continues the sequence where mid stopped.
function reviewDocument(rnd, threads, suggestions, targetBytes) {
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const words = ('the review pipeline renders each block with source offsets so that accepting a mark splices exactly the bytes ' +
    'it covers while the rail aligns cards against anchors and find walks text nodes for literal matches across inline ' +
    'formatting boundaries').split(' ')
  const sentence = (n = 12) => {
    const w = []
    for (let i = 0; i < n; i++) w.push(pick(words))
    const s = w.join(' ')
    return s[0].toUpperCase() + s.slice(1) + '.'
  }
  const cjk = '本文档描述了审阅流程中的渲染与选择映射，每个文本节点都保留其源位置，以便接受修改时精确拼接源文本。查找功能遍历显示的文本并绘制高亮。'
  const authors = ['ke', 'agent', 'dawei', 'reviewer']
  const thread = (i, replies) => {
    let s = `{==${sentence(5).slice(0, -1)} ${i}==}{>>@${pick(authors)}: ${sentence(14)} (thread ${i})<<}`
    for (let r = 0; r < replies; r++) s += `{>>@${pick(authors)}: ${sentence(10)} reply ${r}<<}`
    return s
  }
  const suggestion = (i) => {
    const k = i % 3
    if (k === 0) return `{++${sentence(4).slice(0, -1)}++}`
    if (k === 1) return `{--${sentence(4).slice(0, -1)}--}`
    return `{~~${sentence(3).slice(0, -1)}~>${sentence(3).slice(0, -1)}~~}`
  }
  const out = ['---', 'title: Perf fixture', 'tags: [review, perf]', '---', '', '# Performance fixture', '']
  let t = 0, s = 0, section = 0
  while (out.join('\n').length < targetBytes || t < threads || s < suggestions) {
    section++
    out.push(`## Section ${section}`, '')
    for (let p = 0; p < 4; p++) {
      let para = sentence(20) + ' **' + sentence(4) + '** and `inline code` with a [link](https://example.com/' + section + '). ' + sentence(18)
      if (t < threads && rnd() < 0.8) { para += ' ' + thread(t, t % 3 === 0 ? 0 : 1 + (t % 4)); t++ }
      if (s < suggestions && rnd() < 0.6) { para += ' ' + suggestion(s) + ' ' + sentence(8); s++ }
      out.push(para, '')
    }
    if (section % 2 === 0) out.push(cjk + (t < threads ? thread(t++, 1) : '') + cjk, '')
    if (section % 3 === 0) {
      out.push('| Name | Value | Notes |', '|---|---:|---|')
      for (let r = 0; r < 8; r++) out.push(`| row ${r} | ${r * 17} | ${sentence(6)}${r === 2 && s < suggestions ? ' ' + suggestion(s++) : ''} |`)
      out.push('')
    }
    if (section % 4 === 0) out.push('```ts', 'export function f(x: number): number {', '  // {++not a mark++}', '  return x * 2 + ' + section, '}', '```', '')
    if (section % 5 === 0) out.push('- item one ' + sentence(6), '- [ ] task ' + sentence(5), '- item three', '', '> ' + sentence(12), '> ' + sentence(8), '')
  }
  return out.join('\n') + '\n'
}

// Size-exact repeated prose for the host: a heading every 20 blocks, truncated to `bytes` (ASCII).
function repeatedDocument(bytes, paragraph, markEvery = 0) {
  const out = []
  let n = 0
  for (let i = 0; n < bytes; i++) {
    let s = i % 20 === 0 ? `## Section ${i}\n\n` : paragraph
    if (markEvery && i % markEvery === 5) s = s.replace('some `code`', 'some {==marked==}{>>Perf: a comment<<} `code`')
    out.push(s)
    n += s.length
  }
  return out.join('').slice(0, bytes)
}
const MARKED = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, with {==a highlight==}{>>Perf: a comment<<} and some `code` and **bold** text that keeps going for a while so lines wrap.\n\n'
const PLAIN = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, with some `code` and **bold** text that keeps going for a while so lines wrap across the measure of the page.\n\n'
function reviewDocuments() {
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const mid = reviewDocument(rnd, 40, 30, 60_000)
  return { mid, large: reviewDocument(rnd, 300, 220, 600_000) }
}
const KiB = 1024, MiB = 1024 * KiB

// mid/large: renderer and document benches. small: host opens. k600/m15: a comment in every
// paragraph. p600/p15: mostly plain, one comment per 100 blocks.
export const FIXTURES = {
  'mid.md': () => reviewDocuments().mid,
  'large.md': () => reviewDocuments().large,
  'small.md': () => '# Small\n\nHello {++world++}.\n',
  'k600.md': () => repeatedDocument(600 * KiB, MARKED),
  'm15.md': () => repeatedDocument(15 * MiB, MARKED),
  'p600.md': () => repeatedDocument(600 * KiB, PLAIN, 100),
  'p15.md': () => repeatedDocument(15 * MiB, PLAIN, 100),
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** Writes any missing fixture and returns its path. */
export function ensureFixture(name) {
  const path = join(FIXTURE_DIR, name)
  if (!existsSync(path)) {
    mkdirSync(FIXTURE_DIR, { recursive: true })
    writeFileSync(path, FIXTURES[name]())
  }
  return path
}

/** Copies a fixture to `<stem>_<n>.md` so the host sees a distinct, not-yet-open file. */
export function fixtureCopy(name, n) {
  const path = join(FIXTURE_DIR, name.replace(/\.md$/, `_${n}.md`))
  if (!existsSync(path)) copyFileSync(ensureFixture(name), path)
  return path
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baselines = JSON.parse(readFileSync(join(dirname(FIXTURE_DIR), 'baselines.json'), 'utf8'))
  let drift = false
  for (const name of Object.keys(FIXTURES)) {
    const text = readFileSync(ensureFixture(name), 'utf8')
    const expected = baselines.fixtures[name]
    const ok = expected === sha256(text)
    drift ||= !ok
    console.log(`${name.padEnd(10)} ${String(Buffer.byteLength(text)).padStart(9)} bytes  ${ok ? 'matches baselines' : 'DIFFERS from baselines'}`)
  }
  if (drift) process.exitCode = 1
}
