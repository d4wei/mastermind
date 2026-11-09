/**
 * The bundled interface languages in the order the language choices show them, each named in its
 * own language. Reading languages are a separate, open set (`ui/translate/languages.ts`).
 */
export const UI_LANGUAGES = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  fr: 'Français',
} as const

export type UiLang = keyof typeof UI_LANGUAGES

export const UI_LANGUAGE_CODES = Object.keys(UI_LANGUAGES) as UiLang[]

export function isUiLang(value: unknown): value is UiLang {
  return typeof value === 'string' && Object.hasOwn(UI_LANGUAGES, value)
}
