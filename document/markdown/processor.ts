import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** The frozen GFM + frontmatter pipeline; extend it by calling it for an unfrozen copy. */
export const markdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter).freeze()

/** Parse Markdown (GFM and leading YAML frontmatter) to mdast with position offsets intact. */
export function parseMarkdown(text: string): Root {
  const tree = markdownProcessor.parse(text)
  return markdownProcessor.runSync(tree) as Root
}
