import { useEffect, useMemo, useState } from 'react'
import './frontmatter.css'

const MAX_PROPERTY_SOURCE_LENGTH = 64 * 1024
const SIMPLE_PROPERTY = /^[^\s#:-][^:]*:(?:[ \t]+(.*))?$/

type YamlParser = typeof import('yaml')

interface MetadataProperty { name: string; value: string }

// The parser loads only once a document has metadata to display; a failed load leaves it literal.
let parser: YamlParser | null | undefined
let parserLoad: Promise<void> | null = null

export function loadMetadataParser(): Promise<void> {
  return parserLoad ??= import('yaml').then((module) => { parser = module }, () => { parser = null })
}

/** Property rows for simple metadata, null for literal display, undefined until the parser loads. */
export function metadataProperties(source: string, yaml = parser): MetadataProperty[] | null | undefined {
  // Large metadata stays literal rather than adding YAML parsing to the rendering path.
  if (source.length > MAX_PROPERTY_SOURCE_LENGTH) return null
  if (yaml === undefined) return undefined
  if (yaml === null) return null
  const { isMap, isScalar, parseDocument } = yaml
  try {
    const doc = parseDocument(source, { version: '1.2', intAsBigInt: true })
    if (doc.errors.length || doc.warnings.length || doc.directives?.yaml.explicit ||
        doc.directives?.docStart || doc.directives?.docEnd ||
        Object.keys(doc.directives?.tags ?? {}).some((tag) => tag !== '!!') ||
        !isMap(doc.contents) || doc.contents.anchor || doc.contents.tag ||
        !doc.contents.items.length) return null
    const properties: MetadataProperty[] = []
    for (const { key, value } of doc.contents.items) {
      if (!isScalar(key) || typeof key.value !== 'string' || !key.value || key.value === '<<' ||
          key.anchor || key.tag || !isScalar(value) || value.anchor || value.tag) return null
      properties.push({ name: key.value,
        value: typeof value.value === 'string' ? value.value : value.source ?? '' })
    }
    return properties
  } catch {
    return null
  }
}

const unquote = (text: string) => /^(["'])(.*)\1$/.exec(text)?.[2] ?? text

/** Unparsed rows that approximate the display's space while the parser loads. */
function placeholderRows(source: string): MetadataProperty[] | null {
  const rows: MetadataProperty[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim() || line.startsWith('#')) continue
    const match = SIMPLE_PROPERTY.exec(line)
    let value = match?.[1] ?? ''
    // Collections, anchors, and tags are likely to stay literal.
    if (!match || /^[[{&*!]/.test(value)) return null
    if (/^[|>]/.test(value)) {
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) block.push(lines[++i]!.trim())
      value = block.join(value.startsWith('|') ? '\n' : ' ')
    }
    rows.push({ name: unquote(line.slice(0, line.indexOf(':'))), value: unquote(value) })
  }
  return rows.length ? rows : null
}

function PropertyList({ properties }: { properties: MetadataProperty[] }) {
  return <dl className="md-properties">
    {properties.map(({ name, value }, index) => <div className="md-property" key={`${index}:${name}`}>
      <dt>{name}</dt><dd>{value}</dd>
    </div>)}
  </dl>
}

export function Frontmatter({ source, lang }: { source: string; lang?: string }) {
  // The loaded parser, as this view saw it; the load completing sets it.
  const [yaml, setYaml] = useState(parser)
  const properties = useMemo(() => metadataProperties(source, yaml), [source, yaml])
  const pending = properties === undefined
  useEffect(() => {
    if (!pending) return
    let current = true
    void loadMetadataParser().then(() => { if (current) setYaml(parser) })
    return () => { current = false }
  }, [pending])
  const raw = <pre className="md-code"><code>{source}</code></pre>
  if (pending) {
    const rows = placeholderRows(source)
    return <div className="md-frontmatter md-frontmatter-pending" lang={lang} aria-hidden="true">
      {rows ? <PropertyList properties={rows} /> : raw}
    </div>
  }
  if (!properties) return <div className="md-frontmatter" lang={lang}>{raw}</div>
  return <div className="md-frontmatter" lang={lang}><PropertyList properties={properties} /></div>
}
