export function languageName(code: string): string {
  const normalized = code.replaceAll('_', '-')
  if (normalized === 'zh-CN') return '简体中文'
  if (normalized === 'zh-TW') return '繁體中文（台灣）'
  if (normalized === 'zh-HK') return '繁體中文（香港）'
  try { return new Intl.DisplayNames([normalized], { type: 'language' }).of(normalized) ?? code }
  catch { return code }
}
