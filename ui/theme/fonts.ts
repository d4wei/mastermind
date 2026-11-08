import { CJK_STACKS, type FontPreset } from './fontRegistry'

export * from './fontRegistry'

/** The generated `@font-face` sheet for every bundled face, served beside the themes. */
export const FONT_FACES_HREF = '/themes/fonts/faces.css'

/** System monospace faces carry Latin code if the bundled face cannot load; they hold no CJK, so
 * CJK characters fall through them to the sans CJK faces. */
const SYSTEM_MONO = ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas']

/** Quoted named families, then an unquoted fallback list ending in a generic family. */
function stack(families: readonly string[], fallback: string): string {
  return [...families.map((family) => `'${family}'`), fallback].join(', ')
}

function cjkStack(preset: FontPreset, family: string): string {
  return stack([family, ...CJK_STACKS[preset.style]], preset.style === 'serif' ? 'serif' : 'sans-serif')
}

export function displayStack(preset: FontPreset): string {
  return cjkStack(preset, preset.displayFamily)
}
export function bodyStack(preset: FontPreset): string {
  return cjkStack(preset, preset.bodyFamily)
}
/** Code takes the sans CJK faces in every preset; CJK text in code keeps one even stroke. */
export function monoStack(preset: FontPreset): string {
  return [`'${preset.codeFamily}'`, ...SYSTEM_MONO, ...CJK_STACKS.sans.map((family) => `'${family}'`), 'monospace'].join(', ')
}
