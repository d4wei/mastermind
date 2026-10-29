import type { Parent } from 'mdast'
import type { Node } from 'unist'
import { describe, expect, it } from 'vitest'
import golden from './critic-reading-trees.golden.json'
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

function textPieces(tree: Node): { value: string; from: number; to: number }[] {
  return (collect(tree, 'text') as unknown as { value: string; position?: Node['position'] }[]).map((t) => ({
    value: t.value,
    from: t.position!.start.offset!,
    to: t.position!.end.offset!,
  }))
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

  it('retains exact original atom positions with CRLF input', () => {
    const source = '> {++**新增**++} {~~旧~>新~~} {>>line one\r\n> line two<<} tail'
    const { tree } = analyzeMarkdown(source)
    const expected: Record<string, string> = {
      criticInsert: '{++**新增**++}',
      criticSub: '{~~旧~>新~~}',
      criticComment: '{>>line one\r\n> line two<<}',
    }
    for (const [type, bytes] of Object.entries(expected)) {
      const node = collect(tree, type)[0]!
      expect(source.slice(node.position!.start.offset!, node.position!.end.offset!)).toBe(bytes)
    }
    expect(collect(collect(tree, 'criticInsert')[0]!, 'strong')).toHaveLength(1)
    const comment = collect(tree, 'criticComment')[0] as CriticCommentNode
    expect(comment.data.content).toBe('line one\r\nline two')
  })

  it('positions the text pieces around each mark kind at their exact source offsets', () => {
    const source = 'A {++ins++} B {--del--} C {>>note<<} D {~~old~>new~~} E'
    const { tree } = analyzeMarkdown(source)
    const pieces = textPieces(tree)
    expect(pieces).toEqual([
      { value: 'A ', from: 0, to: 2 },
      { value: 'ins', from: 5, to: 8 },
      { value: ' B ', from: 11, to: 14 },
      { value: 'del', from: 17, to: 20 },
      { value: ' C ', from: 23, to: 26 },
      { value: ' D ', from: 36, to: 39 },
      { value: ' E', from: 53, to: 55 },
    ])
    for (const piece of pieces) expect(source.slice(piece.from, piece.to)).toBe(piece.value)
  })

  it('positions a piece after a mark inside emphasis', () => {
    const source = 'x *lead {++mid++} tail* y'
    const { tree } = analyzeMarkdown(source)
    const emphasis = collect(tree, 'emphasis')[0]!
    expect(textPieces(emphasis)).toEqual([
      { value: 'lead ', from: 3, to: 8 },
      { value: 'mid', from: 11, to: 14 },
      { value: ' tail', from: 17, to: 22 },
    ])
  })

  it('positions literal delimiters of a mark split across formatting depths', () => {
    const source = '*a {++b* c++}'
    const { tree, spans } = analyzeMarkdown(source)
    expect(spans).toHaveLength(1)
    expect(collect(tree, 'criticInsert')).toHaveLength(0)
    const pieces = textPieces(tree)
    expect(pieces.map((p) => p.value).join('')).toBe('a {++b c++}')
    for (const piece of pieces) expect(source.slice(piece.from, piece.to)).toBe(piece.value)
    expect(pieces).toContainEqual({ value: '{++', from: 3, to: 6 })
    expect(pieces).toContainEqual({ value: '++}', from: 10, to: 13 })
  })

  it('positions pieces of decoded or prefixed text from their provenance', () => {
    expect(textPieces(analyzeMarkdown('AT&amp;T {++ins++} after').tree)).toEqual([
      { value: 'AT&T ', from: 0, to: 9 }, { value: 'ins', from: 12, to: 15 }, { value: ' after', from: 18, to: 24 },
    ])
    expect(textPieces(analyzeMarkdown('> first {++one\n> two++}').tree)).toEqual([
      { value: 'first ', from: 2, to: 8 }, { value: 'one\ntwo', from: 11, to: 20 },
    ])
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

// The golden records the reading trees for this file's inputs; the pipeline must reproduce them exactly.
it.each(golden)('reproduces the reading tree recorded for %#', ({ source, tree }) => {
  expect(JSON.parse(JSON.stringify(analyzeMarkdown(source).tree))).toEqual(tree)
})

it('reuses the plain parse as the reading tree when there are no marks', () => {
  const { plain, tree } = analyzeMarkdown('# Plain\n\nA mark only in code: `{++code++}`.')
  expect(tree).toBe(plain)
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

  it.each([
    ['x {==p*q==}{>>c<<} {==r*s==}{>>d<<}', 'x {==pq==} {==rs==}', ['{>>c<<}', '{>>d<<}']],
    ['{++d*c++}{++c*b++}', '{++dc++}{++cb++}', []],
  ])('leaves a closer literal when the open frame belongs to another span: %j', (source, text, comments) => {
    const { tree } = analyzeMarkdown(source)
    for (const type of ['criticInsert', 'criticHighlight']) expect(collect(tree, type)).toEqual([])
    expect(textOf(tree)).toBe(text)
    expect(spanSources(source, 'criticComment')).toEqual(comments)
  })

  it('keeps later wrappers paired after closers that matched no frame', () => {
    const source = '{++d*c++}{++c*b++} {++e++} *{++f++}*'
    expect(spanSources(source, 'criticInsert')).toEqual(['{++e++}', '{++f++}'])
  })
})

describe('autolink attributes', () => {
  it.each([
    ['see https://x.com/a{>>note<<}', 'https://x.com/a{>>note<<}', 'criticComment', '{>>note<<}'],
    ['see <http://x.y/{++a++}> z', 'http://x.y/{++a++}', 'criticInsert', '{++a++}'],
    ['see http://x.y/{++a++} z', 'http://x.y/{++a++}', 'criticInsert', '{++a++}'],
    ['Visit www.example.com{++/docs++} now', 'http://www.example.com{++/docs++}', 'criticInsert', '{++/docs++}'],
    ['see https://x.com/\u{1F600}{++a++} z', 'https://x.com/\u{1F600}{++a++}', 'criticInsert', '{++a++}'],
  ])('restores the source URL and keeps the mark in the link text: %j', (source, url, type, mark) => {
    const { tree, spans } = analyzeMarkdown(source)
    const link = collect(tree, 'link')[0] as unknown as { url: string; title: string | null }
    expect(link.url).toBe(url)
    const wrappers = collect(link as unknown as Node, type) as (CriticWrapNode | CriticCommentNode)[]
    expect(wrappers.map((node) => { const span = spans[node.data.spanIndex]!; return source.slice(span.start, span.end) })).toEqual([mark])
  })

  it('restores a URL whose mark opens outside the link as literal source', () => {
    const { tree } = analyzeMarkdown('{++http://x.y/++} z')
    expect((collect(tree, 'link')[0] as unknown as { url: string }).url).toBe('http://x.y/++}')
    expect(JSON.stringify(tree)).not.toMatch(/[\ue000-\ue0ff]/)
  })

  it('restores an unpositioned literal autolink from its nearest positioned ancestor, stripping when ambiguous', () => {
    const urls = (source: string) => collect(analyzeMarkdown(source).tree, 'link').map((node) => (node as unknown as { url: string }).url)
    expect(urls('~>www.ex.com/{++a++} y')).toEqual(['http://www.ex.com/{++a++}'])
    expect(urls('~>www.ex.com/{>>aa<<} ~>www.ex.com/{>>bb<<} ~>www.ex.com/{>>cc<<}'))
      .toEqual(['http://www.ex.com/', 'http://www.ex.com/{>>bb<<}', 'http://www.ex.com/'])
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
