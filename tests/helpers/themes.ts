import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { convert } from '@asamuzakjp/css-color'
import { scanThemes } from '../../themes/discovery'

export const themesRoot = path.resolve('themes')
export const themeIds = readdirSync(themesRoot)
  .filter((id) => existsSync(path.join(themesRoot, id, 'theme.json')))

export function declarations(css: string, print = false): Record<string, string> {
  const result: Record<string, string> = {}
  postcss.parse(css).walkDecls((decl) => {
    let node: postcss.AnyNode | undefined = decl.parent
    let inPrint = false
    while (node) {
      if (node.type === 'atrule' && node.name === 'media' && node.params === 'print') inPrint = true
      node = node.parent
    }
    if (inPrint === print && decl.prop.startsWith('--')) result[decl.prop] = decl.value
  })
  return result
}

const common = readFileSync(path.join(themesRoot, 'common.css'), 'utf8')
export const printTokens = declarations(common, true)
const metadata = await scanThemes(themesRoot)
export function themeTokens(id: string): Record<string, string> {
  return { ...declarations(common),
    ...declarations(readFileSync(path.join(themesRoot, id, 'tokens.css'), 'utf8')) }
}
export function themeAppearance(id: string): 'light' | 'dark' {
  return metadata.find((theme) => theme.id === id)!.appearance
}

export function rgb(value: string, tokens: Record<string, string>): number[] {
  return convert.colorToRgb(value.startsWith('--') ? `var(${value})` : value,
    { customProperty: tokens })
}
export function composite(foreground: number[], background: number[]): number[] {
  const alpha = foreground[3] ?? 1
  return foreground.slice(0, 3).map((channel, index) => channel * alpha + background[index]! * (1 - alpha))
}
function luminance(color: number[]): number {
  return color.slice(0, 3).map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
}
export function contrast(a: number[], b: number[]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter! + 0.05) / (darker! + 0.05)
}
