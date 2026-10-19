import { describe, it, expect } from 'vitest'
import { highlight } from '../ui/modes/reading/highlight'

function typeOf(code: string, needle: string, lang?: string): string | undefined {
  const target = code.indexOf(needle)
  if (target < 0) return undefined
  let position = 0
  for (const token of highlight(code, lang)) {
    const end = position + token.value.length
    if (position <= target && target + needle.length <= end) return token.type
    position = end
  }
  return undefined
}

describe('highlight tokenizer', () => {
  it.each([
    ['ts', 'const x = 1 // hi\n"str"'],
    ['python', 'def f():\n    return None  # done'],
    ['sh', 'git clone https://x.git && cd x # comment'],
    ['json', '{ "a": 1, "b": [true, null] }'],
    ['css', 'body { color: red; /* note */ }'],
    ['rust', 'fn main() { return "value"; }'],
    [undefined, 'no lang here ()[]{}<>'],
    ['js', ''],
    ['js', 'const text = "你好😀";\r\n// comment\r\n'],
    ['js', '/* unfinished 你好😀'],
    ['js', '"unfinished\\'],
    ['python', '\'\'\'unfinished\r\n你好😀'],
    ['sh', 'echo "你好😀"\r\nprintf $HOME'],
  ])('preserves the exact input for %s code %j', (lang, code) => {
    expect(highlight(code, lang).map((token) => token.value).join('')).toBe(code)
  })

  it('classifies JS keywords, strings, numbers, comments', () => {
    const code = 'const n = 42 // note\nconst s = "hi"'
    expect(typeOf(code, 'const', 'js')).toBe('keyword')
    expect(typeOf(code, '42', 'js')).toBe('number')
    expect(typeOf(code, '// note', 'js')).toBe('comment')
    expect(typeOf(code, '"hi"', 'js')).toBe('string')
  })

  it('marks call targets as functions and members as properties', () => {
    const toks = highlight('foo(bar.baz)', 'js')
    expect(toks.find((t) => t.value === 'foo')?.type).toBe('function')
    expect(toks.find((t) => t.value === 'baz')?.type).toBe('property')
  })

  it.each(['true', 'false', 'null'])('treats %s as a constant', (value) => {
    expect(typeOf(`let value = ${value}`, value, 'js')).toBe('constant')
  })

  it('shell: first word is the command, $vars and -flags are distinct', () => {
    const toks = highlight('npm run build --silent $HOME', 'sh')
    expect(toks.find((t) => t.value === 'npm')?.type).toBe('function')
    expect(toks.find((t) => t.value === '--silent')?.type).toBe('property')
    expect(toks.find((t) => t.value === '$HOME')?.type).toBe('constant')
    expect(toks.filter((t) => t.type === 'function').map((t) => t.value)).toEqual(['npm'])
  })

  it.each([' | ', '\n', '\r\n'])('shell: a new command starts after %j', (separator) => {
    const toks = highlight(`cat f${separator}grep x`, 'sh')
    expect(toks.find((t) => t.value === 'cat')?.type).toBe('function')
    expect(toks.find((t) => t.value === 'grep')?.type).toBe('function')
  })

  it('shell: # is a comment, not in JS', () => {
    expect(highlight('echo hi # comment', 'sh').some((t) => t.type === 'comment' && t.value.includes('# comment'))).toBe(true)
    expect(highlight('a # b', 'js').some((t) => t.type === 'comment')).toBe(false)
  })

  it('json: object keys color as properties, scalars by type', () => {
    const toks = highlight('{ "name": "v", "n": 3, "ok": true }', 'json')
    expect(toks.find((t) => t.value === '"name"')?.type).toBe('property')
    expect(toks.find((t) => t.value === '"v"')?.type).toBe('string')
    expect(toks.find((t) => t.value === '3')?.type).toBe('number')
    expect(toks.find((t) => t.value === 'true')?.type).toBe('constant')
  })

  it('python: triple-quoted strings and # comments', () => {
    const toks = highlight('x = """multi\nline""" # tail', 'python')
    expect(toks.some((t) => t.type === 'string' && t.value.includes('multi\nline'))).toBe(true)
    expect(toks.some((t) => t.type === 'comment' && t.value.includes('# tail'))).toBe(true)
  })

  it.each([undefined, 'text', 'plaintext', 'yaml', 'unrecognized-language'])('leaves %s code plain rather than guessing a grammar', (language) => {
    const code = 'return "x"; /* c */\r\nname: value # note\r\n'
    expect(highlight(code, language)).toEqual([{ type: 'text', value: code }])
  })

  it('honors case-insensitive fence aliases', () => {
    expect(highlight('const n = 42', 'TypeScript')).toEqual(highlight('const n = 42', 'ts'))
  })
})

it('classifies the first occurrence rather than a later matching token', () => {
  expect(typeOf('let value = "const"; const next = 1', 'const', 'js')).toBe('string')
  expect(typeOf('/* target */ target()', 'target', 'js')).toBe('comment')
})
