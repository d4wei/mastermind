import { useMemo } from 'react'
import { isMap, isScalar, parseDocument } from 'yaml'
import './frontmatter.css'

const MAX_PROPERTY_SOURCE_LENGTH = 64 * 1024

interface MetadataProperty { name: string; value: string }

export function metadataProperties(source: string): MetadataProperty[] | null {
  // Large metadata stays literal rather than adding YAML parsing to the rendering path.
  if (source.length > MAX_PROPERTY_SOURCE_LENGTH) return null
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

export function Frontmatter({ source }: { source: string }) {
  const properties = useMemo(() => metadataProperties(source), [source])
  const raw = <pre className="md-code"><code>{source}</code></pre>
  if (!properties) return <div className="md-frontmatter">{raw}</div>
  return <div className="md-frontmatter">
    <dl className="md-properties">
      {properties.map(({ name, value }) => <div className="md-property" key={name}>
        <dt>{name}</dt><dd>{value}</dd>
      </div>)}
    </dl>
  </div>
}
