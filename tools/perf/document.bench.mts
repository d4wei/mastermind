// Times document/ and pure ui/ functions on the mid and large review fixtures in Node, as the
// reading surface calls them per keystroke, hover, accept or external change. Prints medians in ms.
import { readFileSync } from 'node:fs'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { parseMarkdown } from '../../document/markdown/processor'
import { scanMarkdownTree } from '../../document/markdown/scan'
import { maskSource, pickSentinels } from '../../document/critic/mask'
import { criticTransform } from '../../document/markdown/critic-mdast'
import { TextProvenance, recordProvenance } from '../../document/markdown/provenance'
import { group, threadCards, parseAuthor } from '../../document/critic/scanner'
import { acceptEdit } from '../../document/critic/resolve'
import { applyTextEdits } from '../../document/edits'
import { parseResolvedThreads, resolveThreadEdits } from '../../document/review-archive'
import { readingShape } from '../../document/markdown/structure'
import { extractOutline, plainText } from '../../ui/modes/reading/outline'
import { replyEdits, commentVerdict, commentBodyFits } from '../../ui/modes/reading/marks'
import { threadRef, locateThread, refreshReplies } from '../../ui/review/thread-identity'
import { textMatches } from '../../ui/find/matches'
import { calloutSections, calloutKind } from '../../ui/modes/reading/callouts'
import { commentSearchText } from '../../ui/review/CommentBody'
// @ts-expect-error -- plain ESM helper without declarations
import { ensureFixture } from './fixtures.mjs'

function median(fn: () => unknown, runs: number, warm = 3) {
  for (let i = 0; i < warm; i++) fn()
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[Math.floor(t.length / 2)]!
}

const rows: Record<string, Record<string, string>> = {}
for (const fixture of ['mid', 'large']) {
  const src = readFileSync(ensureFixture(`${fixture}.md`), 'utf8')
  const runs = fixture === 'large' ? 7 : 15
  const put = (label: string, ms: number) => { (rows[label] ??= {})[fixture] = ms.toFixed(2) }
  const time = (label: string, fn: () => unknown) => { const ms = median(fn, runs); put(label, ms); return ms }

  const a = analyzeMarkdown(src)
  time('analyzeMarkdown (total)', () => analyzeMarkdown(src))
  time('  parseMarkdown plain', () => parseMarkdown(src))
  const plain = parseMarkdown(src)
  time('  scanMarkdownTree', () => scanMarkdownTree(src, plain))
  const spans = scanMarkdownTree(src, plain)
  time('  pickSentinels+maskSource', () => maskSource(src, spans, pickSentinels(src)!))
  const mask = maskSource(src, spans, pickSentinels(src)!)
  const maskedParse = time('  parseMarkdown masked', () => parseMarkdown(mask.masked))
  put('  recordProvenance+criticTransform', median(() => {
    const tree = parseMarkdown(mask.masked)
    const provenance = new TextProvenance()
    recordProvenance(tree, mask.masked, provenance)
    criticTransform(tree, src, spans, mask, provenance)
  }, runs) - maskedParse)
  time('  group+threadCards', () => threadCards(group(spans, src), new Map(spans.map((s, i) => [s, i])), src))
  time('parseResolvedThreads (per source change)', () => parseResolvedThreads(src))
  time('extractOutline(analysis.tree)', () => extractOutline(a.tree))
  time('commentFootnotes parseAuthor', () =>
    a.spans.filter((s) => s.kind === 'comment').map((s) => parseAuthor(src.slice(s.innerStart, s.innerEnd))))
  time('calloutSections+plainText (per MarkdownView render)', () =>
    calloutSections(a.tree.children, (n) => n.type === 'heading' ? n.depth : null, (n) => calloutKind(plainText(n))))

  const ins = a.spans.find((s) => s.kind === 'ins')!
  time('accept one mark: splice only', () => applyTextEdits(src, [acceptEdit(src, ins)]))
  time('accept one mark: splice + analyzeMarkdown', () => analyzeMarkdown(applyTextEdits(src, [acceptEdit(src, ins)])))

  const card = a.threads[Math.floor(a.threads.length / 2)]!
  time('replyEdits verify (per composer keystroke)', () => replyEdits(src, card.thread.end, 'ke', 'I agree with this change', a))
  time('  of which readingShape(original)', () => readingShape(a.tree, a.provenance, { ranges: [] }))
  time('commentBodyFits (per render)', () => commentBodyFits('ke', 'I agree with this change'))
  const leaf = src.indexOf('Section 3')
  time('commentVerdict new comment (per keystroke)', () =>
    commentVerdict(src, [{ from: leaf, to: leaf + 7, text: 'Section' }], 'ke', 'hello', a))
  time('resolveThreadEdits', () => resolveThreadEdits(src, card.thread))
  const reply = replyEdits(src, card.thread.end, 'ke', 'I agree', a)!
  time('post reply: splice + analyzeMarkdown', () => analyzeMarkdown(applyTextEdits(src, reply)))

  // Thread identity after an external change above every thread.
  const ext = src.replace('# Performance fixture', '# Performance fixture changed')
  const ea = analyzeMarkdown(ext)
  const refs = a.threads.slice(0, 5).map((c) => threadRef(c, src, a.threads))
  time('locateThread x3 (active/hover/focus) after external change', () => { for (const r of refs.slice(0, 3)) locateThread(r, ext, ea.threads) })
  const drafts = refs.map((thread, id) => ({ id, thread, text: 'draft' }))
  time('refreshReplies 5 drafts after external change', () => refreshReplies(drafts, ext, ea.threads))
  time('locateThread unchanged source (per render x3)', () => { for (const r of refs.slice(0, 3)) locateThread(r, src, a.threads) })

  time('Find comment-body matches "review" (per keystroke)', () => {
    for (const c of a.threads) for (const m of c.thread.comments) textMatches(commentSearchText(m.body), 'review', false)
  })
  time('Find textMatches over whole source "review"', () => textMatches(src, 'review', false))
}
console.table(rows)
