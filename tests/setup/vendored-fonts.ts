import path from 'node:path'
import { ensureVendoredFonts } from '../../tools/fonts/vendor-fonts.mjs'

/** Suites read the generated `themes/fonts/`; an install that skipped its scripts has none yet. */
export default async function setup(): Promise<void> {
  await ensureVendoredFonts(path.resolve(import.meta.dirname, '../..'))
}
