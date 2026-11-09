import { expect, it } from 'vitest'
import { DICTIONARIES, UI_LANGUAGE_CODES, UI_LANGUAGES, isUiLang, type MsgKey } from '../ui/i18n'

const english = DICTIONARIES.en
const placeholders = (message: string): string[] => (message.match(/\{\w+\}/g) ?? []).sort()

it('lists the interface languages in display order with native names', () => {
  expect(Object.entries(UI_LANGUAGES)).toEqual([
    ['en', 'English'], ['zh-CN', '简体中文'], ['ja', '日本語'], ['fr', 'Français'],
  ])
  expect(Object.keys(DICTIONARIES).sort()).toEqual([...UI_LANGUAGE_CODES].sort())
  expect(UI_LANGUAGE_CODES.every(isUiLang)).toBe(true)
  for (const unknown of ['de', 'zh', 'ja-JP', '', null, 'toString']) expect(isUiLang(unknown)).toBe(false)
})

it.each(UI_LANGUAGE_CODES)('gives every message in %s the English placeholders without padding', (language) => {
  const dictionary = DICTIONARIES[language]
  expect(Object.keys(dictionary).sort()).toEqual(Object.keys(english).sort())
  for (const key of Object.keys(english) as MsgKey[]) {
    const message = dictionary[key]
    expect(message.length, key).toBeGreaterThan(0)
    expect(message, key).toBe(message.trim())
    expect(placeholders(message), key).toEqual(placeholders(english[key]))
  }
})
