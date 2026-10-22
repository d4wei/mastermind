import type { Parent } from 'mdast'
import type { Node } from 'unist'
import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkCritic } from '../document/markdown/remark-critic'
import type { CriticSpan } from '../document/critic/types'
import { applyTextEdits } from '../document/edits'
import { rejectEdit } from '../document/critic/resolve'
import { analyzeMarkdown } from '../document/markdown/analyze'
import type { CriticCommentNode, CriticSubNode, CriticWrapNode } from '../document/markdown/critic-mdast'

function collect(tree: Node, type: string): Node[] {
  const out: Node[] = []
  const walk = (n: Node): void => {
    if (n.type === type) out.push(n)
    const children = (n as Parent).children
    if (children) for (const c of children) walk(c as Node)
  }
  walk(tree)
  return out
}

function textOf(node: Node): string {
  let s = ''
  const walk = (n: Node): void => {
    if (n.type === 'text') s += (n as unknown as { value: string }).value
    const children = (n as Parent).children
    if (children) for (const c of children) walk(c as Node)
  }
  walk(node)
  return s
}

describe('criticTransform via analyzeMarkdown', () => {
  it('wraps the five kinds into typed nodes', () => {
    const { tree } = analyzeMarkdown('A {++ins++} B {--del--} C {~~old~>new~~} D {==hl==} E {>>note<<} F')
    expect(collect(tree, 'criticInsert')).toHaveLength(1)
    expect(collect(tree, 'criticDelete')).toHaveLength(1)
    expect(collect(tree, 'criticHighlight')).toHaveLength(1)
    const subs = collect(tree, 'criticSub') as CriticSubNode[]
    expect(subs).toHaveLength(1)
    expect(subs[0]!.data.old).toBe('old')
    expect(subs[0]!.data.new).toBe('new')
    const comments = collect(tree, 'criticComment') as CriticCommentNode[]
    expect(comments).toHaveLength(1)
    expect(comments[0]!.data.content).toBe('note')
    // no sentinel garbage left anywhere
    expect([...JSON.stringify(tree)].some((ch) => { const c = ch.charCodeAt(0); return c >= 0xe000 && c <= 0xe0ff })).toBe(false)
  })

  it('keeps inline markdown alive inside insertions', () => {
    const { tree } = analyzeMarkdown('x {++has **bold** and `code`++} y')
    const ins = collect(tree, 'criticInsert')[0] as CriticWrapNode
    expect(collect(ins, 'strong')).toHaveLength(1)
    expect(collect(ins, 'inlineCode')).toHaveLength(1)
  })

  it('substitution survives next to real strikethrough', () => {
    const { tree } = analyzeMarkdown('keep ~~struck~~ and {~~a~>b~~} both')
    expect(collect(tree, 'delete')).toHaveLength(1)
    expect(collect(tree, 'criticSub')).toHaveLength(1)
  })

  it('marks work inside list items and blockquotes', () => {
    const md = '- item {++added++}\n\n> quote {--removed--} tail'
    const { tree } = analyzeMarkdown(md)
    expect(collect(tree, 'criticInsert')).toHaveLength(1)
    expect(collect(tree, 'criticDelete')).toHaveLength(1)
  })

  it('adjacent atoms (thread) become two comment nodes in order', () => {
    const { tree, items } = analyzeMarkdown('{==span==}{>>@ke: a<<}{>>@agent: b<<}')
    const comments = collect(tree, 'criticComment') as CriticCommentNode[]
    expect(comments).toHaveLength(2)
    expect(comments[0]!.data.content).toBe('@ke: a')
    expect(comments[1]!.data.content).toBe('@agent: b')
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('thread')
  })

  it('multi-word multi-line marks wrap whole phrases', () => {
    const md = 'start {++one two\nthree++} end'
    const { tree } = analyzeMarkdown(md)
    const ins = collect(tree, 'criticInsert')[0] as CriticWrapNode
    expect(textOf(ins as Node)).toBe('one two\nthree')
  })

  it('decoys in code stay literal', () => {
    const md = 'real {++one++}\n\n```\n{--decoy--}\n```\n\nand `x {==nah==}` inline'
    const { tree } = analyzeMarkdown(md)
    expect(collect(tree, 'criticInsert')).toHaveLength(1)
    expect(collect(tree, 'criticDelete')).toHaveLength(0)
    expect(collect(tree, 'criticHighlight')).toHaveLength(0)
    const code = collect(tree, 'code')[0] as unknown as { value: string }
    expect(code.value).toBe('{--decoy--}')
  })

  it('escaped openers render literally', () => {
    const { tree } = analyzeMarkdown('\\{++literal++}')
    expect(collect(tree, 'criticInsert')).toHaveLength(0)
  })

  it('comment spanning lines in a blockquote keeps the quote intact', () => {
    const md = '> before {>>note line one\n> note line two<<} after'
    const { tree } = analyzeMarkdown(md)
    expect(collect(tree, 'blockquote')).toHaveLength(1)
    const comments = collect(tree, 'criticComment') as CriticCommentNode[]
    expect(comments).toHaveLength(1)
    // The enclosing blockquote owns its container prefixes.
    expect(comments[0]!.data.content).toBe('note line one\nnote line two')
    const quoteText = textOf(collect(tree, 'blockquote')[0]!)
    expect(quoteText).toContain('before')
    expect(quoteText).toContain('after')
  })

  it('CJK content round-trips through the transform', () => {
    const { tree } = analyzeMarkdown('前言 {++插入的文字++} 后记')
    const ins = collect(tree, 'criticInsert')[0] as CriticWrapNode
    expect(textOf(ins as Node)).toBe('插入的文字')
  })

  it('retains exact original positions and raw atom bytes with CRLF input', () => {
    const source = '> {++**新增**++} {~~旧~>新~~} {>>line one\r\n> line two<<} tail'
    const { tree } = analyzeMarkdown(source)
    for (const type of ['criticInsert', 'criticSub', 'criticComment']) {
      const node = collect(tree, type)[0]!
      const start = node.position!.start.offset!
      const end = node.position!.end.offset!
      const slice = source.slice(start, end)
      if (type === 'criticInsert') {
        expect(slice).toBe('{++**新增**++}')
        expect(collect(node, 'strong')).toHaveLength(1)
      } else {
        expect((node as CriticSubNode | CriticCommentNode).data.raw).toBe(slice)
      }
    }
    const comment = collect(tree, 'criticComment')[0] as CriticCommentNode
    expect(comment.data.raw).toBe('{>>line one\r\n> line two<<}')
    expect(comment.data.content).toBe('line one\r\nline two')
  })

  it('plain documents pass through untouched', () => {
    const { tree, spans, items } = analyzeMarkdown('# Hi\n\nplain paragraph')
    expect(spans).toHaveLength(0)
    expect(items).toHaveLength(0)
    expect(collect(tree, 'heading')).toHaveLength(1)
  })
})

it('keeps each analysis tied to its exact source across marked and plain calls', () => {
  const firstSource = '> {++first\r\n> continuation++}'
  const first = analyzeMarkdown(firstSource)
  const plain = analyzeMarkdown('# Plain\n\nBody.')
  const lastSource = 'Last {--removed--}.'
  const last = analyzeMarkdown(lastSource)
  expect(plain.spans).toEqual([])
  expect(plain.items).toEqual([])
  expect(first.spans.map((span) => firstSource.slice(span.start, span.end)))
    .toEqual(['{++first\r\n> continuation++}'])
  expect(last.spans.map((span) => lastSource.slice(span.start, span.end))).toEqual(['{--removed--}'])
  expect(textOf(collect(first.tree, 'criticInsert')[0]!)).toBe('first\r\ncontinuation')
  expect(collect(first.tree, 'criticDelete')).toEqual([])
  expect(collect(last.tree, 'criticInsert')).toEqual([])
})

it('transforms interleaved parser calls using their own file state', () => {
  const processor = unified().use(remarkParse).use(remarkCritic).freeze()
  const first = { value: 'First {++addition++}.', data: { criticSpans: [] as CriticSpan[] } }
  const second = { value: 'Second {--deletion--}.', data: { criticSpans: [] as CriticSpan[] } }
  const firstTree = processor.parse(first)
  const secondTree = processor.parse(second)
  processor.runSync(firstTree, first)
  processor.runSync(secondTree, second)
  expect(textOf(collect(firstTree, 'criticInsert')[0]!)).toBe('addition')
  expect(textOf(collect(secondTree, 'criticDelete')[0]!)).toBe('deletion')
  expect(first.data.criticSpans.map((span) => first.value.slice(span.start, span.end))).toEqual(['{++addition++}'])
  expect(second.data.criticSpans.map((span) => second.value.slice(span.start, span.end))).toEqual(['{--deletion--}'])
})

describe('span association across tree depths', () => {
  function spanSources(source: string, type: string): string[] {
    const { tree, spans } = analyzeMarkdown(source)
    return collect(tree, type).map((node) => {
      const span = spans[(node as CriticWrapNode | CriticCommentNode).data.spanIndex]!
      return source.slice(span.start, span.end)
    })
  }

  it.each([
    ['{++x++} *{++y++}*', 'criticInsert', ['{++x++}', '{++y++}']],
    ['{>>a<<} *{>>b<<}*', 'criticComment', ['{>>a<<}', '{>>b<<}']],
    ['{--x--} [link {--y--}](u)', 'criticDelete', ['{--x--}', '{--y--}']],
    ['*{++y++}* {++x++}', 'criticInsert', ['{++y++}', '{++x++}']],
  ])('pairs each wrapper with its own span: %s', (source, type, expected) => {
    expect(spanSources(source, type)).toEqual(expected)
  })

  it('rejects the clicked deletion rather than a nested sibling', () => {
    const source = '{--x--} [link {--y--}](u)'
    const { tree, spans } = analyzeMarkdown(source)
    const first = collect(tree, 'criticDelete').find((node) => textOf(node) === 'x') as CriticWrapNode
    const span = spans[first.data.spanIndex]!
    expect(applyTextEdits(source, [rejectEdit(source, span)])).toBe('x [link {--y--}](u)')
  })

  it('keeps later wrappers paired after a mark whose closer sits at another depth', () => {
    const source = '{++a *x++}* {++b++}'
    expect(spanSources(source, 'criticInsert')).toEqual(['{++b++}'])
    const { tree } = analyzeMarkdown(source)
    expect(textOf(tree)).toBe('{++a x++} b')
  })
})

describe('opaque link destinations and image text', () => {
  it.each([
    ['[t](http://a/{--b--})', 'http://a/{--b--}'],
    ['![{++new++} alt](x.png)', '{++new++} alt'],
    ['![{++new++} alt][ref]\n\n[ref]: x.png', '{++new++} alt'],
  ])('leaves delimiters literal in %j', (source, literal) => {
    const { tree, spans } = analyzeMarkdown(source)
    expect(spans).toEqual([])
    const values = collect(tree, 'link').map((node) => (node as unknown as { url: string }).url)
      .concat(collect(tree, 'image').concat(collect(tree, 'imageReference')).map((node) => (node as unknown as { alt: string }).alt))
    expect(values).toContain(literal)
  })

  it('still finds marks in link text', () => {
    const source = '[{++new++} text](http://a/{--b--})'
    const { tree, spans } = analyzeMarkdown(source)
    expect(spans.map((span) => source.slice(span.start, span.end))).toEqual(['{++new++}'])
    expect((collect(tree, 'link')[0] as unknown as { url: string }).url).toBe('http://a/{--b--}')
  })
})
