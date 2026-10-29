import { describe, expect, it } from 'vitest'
import { acceptEdit } from '../document/critic/resolve'
import { applyTextEdits } from '../document/edits'
import { parseMarkdown } from '../document/markdown/processor'
import { scanMarkdown } from '../document/markdown/scan'
import { toggleTaskEdit } from '../document/markdown/tasklist'
import { prepareTranslation, translatedCommentEdit } from '../document/translation'

const BOM = '﻿'

describe('a leading byte order mark', () => {
  it('counts in every tree position', () => {
    const source = `${BOM}---\ntitle: x\n---\n\nHi there.\n`
    expect(parseMarkdown(source).children.map((node) => source.slice(node.position!.start.offset, node.position!.end.offset)))
      .toEqual(['---\ntitle: x\n---', 'Hi there.'])
  })

  it('leaves a mark that ends its block visible', () => {
    const source = `${BOM}The plan.{>>@a: x<<}\n`
    expect(scanMarkdown(source).map((span) => source.slice(span.start, span.end))).toEqual(['{>>@a: x<<}'])
  })

  it('toggles a top-level task', () => {
    const source = `${BOM}- [ ] ship\n`
    const list = parseMarkdown(source).children[0]!
    if (list.type !== 'list') throw new Error('not a list')
    const edit = toggleTaskEdit(source, list.children[0]!.position!.start.offset!)
    expect(edit && applyTextEdits(source, [edit])).toBe(`${BOM}- [x] ship\n`)
  })

  it('places a translated comment after the last character', async () => {
    const source = `${BOM}Hello world.\n`
    const projection = await prepareTranslation(source)
    const edit = await translatedCommentEdit(source, { blockId: 'b1', sourceHash: projection.sourceHash,
      quote: 'Bonjour', language: 'fr', author: 'me', body: 'hi' })
    expect(edit?.from).toBe(source.indexOf('\n'))
  })

  it('survives accepting a mark byte for byte', () => {
    const source = `${BOM}Hello {++big ++}world.\r\n`
    const [span] = scanMarkdown(source)
    expect(applyTextEdits(source, [acceptEdit(source, span!)])).toBe(`${BOM}Hello big world.\r\n`)
  })
})
