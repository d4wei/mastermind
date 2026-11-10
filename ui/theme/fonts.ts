import { CJK_LANGUAGES, CJK_STACKS, DEFAULT_CJK_LANGUAGE, type CjkLanguage, type FontPreset } from './fontRegistry'

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
 * Every font-family token a preset sets: the default-language `--font-display`, `--font-body`, and
 * `--font-mono`, and one of each per CJK language (`--font-body-ja`, `--font-body-zh-tw`, …), which
 * the document stylesheet's `:lang()` rules swap in.
 */
export function fontFamilyTokens(preset: FontPreset): Record<string, string> {
  const tokens: Record<string, string> = {
    '--font-display': displayStack(preset),
    '--font-body': bodyStack(preset),
    '--font-mono': monoStack(preset),
  }
  for (const language of CJK_LANGUAGES) {
    const suffix = language.toLowerCase()
    tokens[`--font-display-${suffix}`] = displayStack(preset, language)
    tokens[`--font-body-${suffix}`] = bodyStack(preset, language)
    tokens[`--font-mono-${suffix}`] = monoStack(preset, language)
  }
  return tokens
}
