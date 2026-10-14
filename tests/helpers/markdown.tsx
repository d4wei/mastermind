import { renderToStaticMarkup } from 'react-dom/server'
import { analyzeMarkdown } from '../../document/markdown/analyze'
import { MarkdownView } from '../../ui/modes/reading/Renderer'

export function renderMarkdown(source: string) {
  const analysis = analyzeMarkdown(source)
  const host = document.createElement('article')
  host.innerHTML = renderToStaticMarkup(<MarkdownView tree={analysis.tree} ctx={{ source }} />)
  return { host, ...analysis }
}

