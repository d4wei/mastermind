import type { FontPreset } from './fontRegistry'

export * from './fontRegistry'

/** The generated `@font-face` sheet for every bundled face, served beside the themes. */
export const FONT_FACES_HREF = '/themes/fonts/faces.css'

const quoted = (family: string): string => `'${family}'`
/** The CJK list of each style in force where a stack is declared. */
const CJK_LIST = { serif: 'var(--font-cjk-serif)', sans: 'var(--font-cjk-sans)' } as const

/**
 * The faces a preset sets on the root, from which the rule in `ui/app/app.css` composes the
 * stacks; the root's `data-font-style` picks the CJK lists and generic family that follow them.
 * `themes/common.css` declares the default preset's.
 */
export function fontFaceTokens(preset: FontPreset): Record<string, string> {
  return {
    '--font-display-face': quoted(preset.displayFamily),
    '--font-body-face': quoted(preset.bodyFamily),
    '--font-code-face': quoted(preset.codeFamily),
  }
}

/** A preset's heading stack outside document content, where the CJK lists are the default row. */
export function displayStack(preset: FontPreset): string {
  return `${quoted(preset.displayFamily)}, ${CJK_LIST[preset.style]}, ${preset.style === 'serif' ? 'serif' : 'sans-serif'}`
}
