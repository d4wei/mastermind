import { CJK_LANGUAGES, CJK_STACKS, DEFAULT_CJK_LANGUAGE, type CjkLanguage, type CjkStyle, type FontPreset }
  from './fontRegistry'

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

function cjkStack(preset: FontPreset, family: string, language: CjkLanguage): string {
  return stack([family, ...CJK_STACKS[preset.style][language]], preset.style === 'serif' ? 'serif' : 'sans-serif')
}

export function displayStack(preset: FontPreset, language: CjkLanguage = DEFAULT_CJK_LANGUAGE): string {
  return cjkStack(preset, preset.displayFamily, language)
}
export function bodyStack(preset: FontPreset, language: CjkLanguage = DEFAULT_CJK_LANGUAGE): string {
  return cjkStack(preset, preset.bodyFamily, language)
}
/** Code takes the sans CJK faces in every preset; CJK text in code keeps one even stroke. */
export function monoStack(preset: FontPreset, language: CjkLanguage = DEFAULT_CJK_LANGUAGE): string {
  return [`'${preset.codeFamily}'`, ...SYSTEM_MONO, ...CJK_STACKS.sans[language].map((family) => `'${family}'`),
    'monospace'].join(', ')
}

/**
 * The elements whose stacks follow their language: each document view root, and each element
 * inside one that names its own language. The `:lang()` rules in `ui/app/app.css` switch the CJK
 * lists on the same elements.
 */
export const LANGUAGE_SCOPE = ['.md-root', '.trans-view', '.source-host', '.md-root [lang]', '.trans-view [lang]'] as const

/** The token holding one row of `CJK_STACKS`, such as `--font-cjk-serif-zh-tw`. */
export function cjkListToken(style: CjkStyle, language: CjkLanguage): string {
  return `--font-cjk-${style}-${language.toLowerCase()}`
}

/** Every row of `CJK_STACKS` as its token; `themes/common.css` declares these, whatever the preset. */
export function cjkListTokens(): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const style of ['serif', 'sans'] as const) {
    for (const language of CJK_LANGUAGES) {
      tokens[cjkListToken(style, language)] = CJK_STACKS[style][language].map((family) => `'${family}'`).join(', ')
    }
  }
  return tokens
}

/**
 * The stacks a preset sets: its Latin faces around `--font-cjk-serif` or `--font-cjk-sans`, the CJK
 * lists of the language in force. Code takes the sans list in every preset.
 */
export function fontStackTokens(preset: FontPreset): Record<string, string> {
  const cjk = { serif: 'var(--font-cjk-serif)', sans: 'var(--font-cjk-sans)' } as const
  const generic = preset.style === 'serif' ? 'serif' : 'sans-serif'
  return {
    '--font-display': `'${preset.displayFamily}', ${cjk[preset.style]}, ${generic}`,
    '--font-body': `'${preset.bodyFamily}', ${cjk[preset.style]}, ${generic}`,
    '--font-mono': [`'${preset.codeFamily}'`, ...SYSTEM_MONO, cjk.sans, 'monospace'].join(', '),
  }
}

/**
 * The rule declaring a preset's stacks on the root and on every element of `LANGUAGE_SCOPE`. A
 * custom property substitutes its `var()` references where it is declared and descendants inherit
 * the result, so a stack declared only on the root would keep the root's CJK lists inside a block
 * of another language.
 */
export function fontStackRule(preset: FontPreset): string {
  const declarations = Object.entries(fontStackTokens(preset)).map(([name, value]) => `  ${name}: ${value};`)
  return `:root, ${LANGUAGE_SCOPE.join(', ')} {\n${declarations.join('\n')}\n}\n`
}
