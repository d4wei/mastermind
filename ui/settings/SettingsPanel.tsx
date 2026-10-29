import { useConfig, type ConfigPatch } from '../app/configStore'
import { useEffect, useRef, useState } from 'react'
import { usableAuthorName } from '../../document/author'
import { ToggleGroup } from 'radix-ui'
import { SlideOver } from '../app/SlideOver'
import { useT, type MsgKey } from '../i18n'
import { FONT_PRESETS, MONO_FONTS, displayStack, monoStack } from '../theme/fonts'
import { CODE_THEMES, type CodeTheme, type CodeThemeId } from '../theme/codeThemes'
import type { ThemeInfo } from '../../themes/types'

const CODE_COLOR_LABEL: Record<CodeThemeId, MsgKey> = {
  none: 'codeColorNone', soft: 'codeColorSoft', vivid: 'codeColorVivid', warm: 'codeColorWarm',
}

const FONT_OPTS = [
  { v: 14, a: 10 },
  { v: 16, a: 12.5 },
  { v: 18, a: 15 },
  { v: 20, a: 18 },
]
const LINE_OPTS = [
  { v: 1.45, gap: 2 },
  { v: 1.6, gap: 3.3 },
  { v: 1.8, gap: 4.6 },
]
const WIDTH_OPTS = [
  { v: 640, w: 6 },
  { v: 736, w: 9.5 },
  { v: 860, w: 13 },
]

function nearest(value: number, opts: number[]): number {
  return opts.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a))
}

function LineGapGlyph({ gap }: { gap: number }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden focusable={false}>
      {[8 - gap, 8, 8 + gap].map((y, i) => (
        <rect key={i} x={3} y={y - 0.6} width={10} height={1.2} rx={0.6} fill="currentColor" />
      ))}
    </svg>
  )
}

function CodeSwatch({ theme, appearance }: { theme: CodeTheme; appearance: 'light' | 'dark' }) {
  const pal = theme.palettes?.[appearance]
  const cols = pal
    ? [pal.keyword, pal.function, pal.string]
    : ['var(--color-text-faint)', 'var(--color-text-muted)', 'var(--color-text-faint)']
  const widths = [10, 7, 9]
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden focusable={false} style={{ flex: 'none' }}>
      {cols.map((c, i) => (
        <rect key={i} x={2} y={3 + i * 3} width={widths[i]} height={1.6} rx={0.8} fill={c} />
      ))}
    </svg>
  )
}

function ThemeSwatch({ s }: { s: ThemeInfo['swatch'] }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden focusable={false} style={{ flex: 'none' }}>
      <rect x={1} y={1} width={14} height={14} rx={2.5} fill={s.bg} stroke="var(--color-border-hover)" strokeWidth={1} />
      <rect x={4} y={5} width={5} height={1.4} rx={0.7} fill={s.ink} />
      <rect x={4} y={8.5} width={8} height={1.2} rx={0.6} fill={s.ink} opacity={0.55} />
      <circle cx={11.5} cy={5.7} r={1.6} fill={s.accent} />
    </svg>
  )
}

function WidthGlyph({ w }: { w: number }) {
  const x = (16 - w) / 2
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden focusable={false}>
      {[5, 8, 11].map((y, i) => (
        <rect key={i} x={x} y={y - 0.6} width={w} height={1.2} rx={0.6} fill="currentColor" />
      ))}
    </svg>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const config = useConfig((s) => s.config)
  const themes = useConfig((s) => s.themes)
  const update = useConfig((s) => s.update)
  const [invalidName, setInvalidName] = useState(false)
  // Escape and outside clicks unmount the panel without blurring the field, so commit on unmount too.
  const pendingName = useRef<string | null>(null)
  const commitName = useRef(() => {})
  commitName.current = () => {
    const name = pendingName.current === null ? null : usableAuthorName(pendingName.current)
    pendingName.current = null
    if (name && config && name !== config.authorTag) void update({ authorTag: name })
  }
  useEffect(() => () => commitName.current(), [])

  const t = useT()

  if (!config) return null

  const patch = (p: ConfigPatch): void => void update(p)
  const activeTheme = themes.find((th) => th.id === config.theme)

  return (
    <SlideOver title={t('settings')} onClose={onClose} ignoreSelector=".reader-menu" returnFocus=".topbar-overflow">
      <div className="settings-body">
        <section>
          <h4>{t('generalSection')}</h4>
          <label className="settings-row">
            <span>{t('authorTag')}</span>
            <input
              type="text"
              className="settings-input"
              defaultValue={config.authorTag}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              maxLength={64}
              aria-invalid={invalidName}
              title={t('authorTagHint')}
              onBlur={(e) => {
                setInvalidName(usableAuthorName(e.target.value) === null)
                pendingName.current = e.target.value
                commitName.current()
              }}
              onChange={(event) => {
                pendingName.current = event.target.value
                setInvalidName(usableAuthorName(event.target.value) === null)
              }}
            />
            {invalidName && <small role="alert">{t('authorTagInvalid')}</small>}
          </label>
          <div className="settings-row">
            <span>{t('uiLanguage')}</span>
            {/* Interface languages are bundled; translation targets accept arbitrary language codes. */}
            <div className="settings-theme-row">
              {(['en', 'zh-CN'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`theme-chip${config.uiLang === code ? ' active' : ''}`}
                  aria-pressed={config.uiLang === code}
                  onClick={() => patch({ uiLang: code })}
                >
                  {code === 'en' ? 'English' : '简体中文'}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h4>{t('appearanceSection')}</h4>
          <div className="settings-row">
            <span>{t('theme')}</span>
            <div className="settings-theme-row">
              {themes.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  className={`theme-chip code-chip${config.theme === th.id ? ' active' : ''}`}
                  aria-pressed={config.theme === th.id}
                  onClick={() => patch({ theme: th.id })}
                >
                  <ThemeSwatch s={th.swatch} />
                  {th.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h4>{t('readingSection')}</h4>
          <div className="settings-row">
            <span>{t('typeface')}</span>
            <div className="settings-theme-row">
              {FONT_PRESETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`theme-chip${config.fontPreset === s.id ? ' active' : ''}`}
                  aria-pressed={config.fontPreset === s.id}
                  style={{ fontFamily: displayStack(s) }}
                  onClick={() => patch({ fontPreset: s.id })}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <span>
              {t('fontSize')} <span className="settings-val">{config.fontSize}px</span>
            </span>
            <ToggleGroup.Root
              className="seg preset-seg"
              type="single"
              value={String(nearest(config.fontSize, FONT_OPTS.map((o) => o.v)))}
              onValueChange={(v) => v && patch({ fontSize: Number(v) })}
              aria-label={t('fontSize')}
            >
              {FONT_OPTS.map((o) => (
                <ToggleGroup.Item key={o.v} value={String(o.v)} className="seg-btn" aria-label={`${o.v}px`}>
                  <span className="preset-A" style={{ fontSize: `${o.a}px` }}>
                    A
                  </span>
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>
          <div className="settings-row">
            <span>
              {t('lineHeight')} <span className="settings-val">{config.lineHeight.toFixed(2)}</span>
            </span>
            <ToggleGroup.Root
              className="seg preset-seg"
              type="single"
              value={String(nearest(config.lineHeight, LINE_OPTS.map((o) => o.v)))}
              onValueChange={(v) => v && patch({ lineHeight: Number(v) })}
              aria-label={t('lineHeight')}
            >
              {LINE_OPTS.map((o) => (
                <ToggleGroup.Item key={o.v} value={String(o.v)} className="seg-btn" aria-label={o.v.toFixed(2)}>
                  <LineGapGlyph gap={o.gap} />
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>
          <div className="settings-row">
            <span>
              {t('contentWidth')} <span className="settings-val">{config.contentWidth}px</span>
            </span>
            <ToggleGroup.Root
              className="seg preset-seg"
              type="single"
              value={String(nearest(config.contentWidth, WIDTH_OPTS.map((o) => o.v)))}
              onValueChange={(v) => v && patch({ contentWidth: Number(v) })}
              aria-label={t('contentWidth')}
            >
              {WIDTH_OPTS.map((o) => (
                <ToggleGroup.Item key={o.v} value={String(o.v)} className="seg-btn" aria-label={`${o.v}px`}>
                  <WidthGlyph w={o.w} />
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>
        </section>

        <section>
          <h4>{t('codeSection')}</h4>
          <div className="settings-row">
            <span>{t('codeFont')}</span>
            <div className="settings-theme-row">
              {MONO_FONTS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`theme-chip${config.monoFont === m.id ? ' active' : ''}`}
                  aria-pressed={config.monoFont === m.id}
                  style={{ fontFamily: monoStack(m) }}
                  onClick={() => patch({ monoFont: m.id })}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <span>{t('codeColor')}</span>
            <div className="settings-theme-row">
              {CODE_THEMES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`theme-chip code-chip${config.codeTheme === c.id ? ' active' : ''}`}
                  aria-pressed={config.codeTheme === c.id}
                  onClick={() => patch({ codeTheme: c.id })}
                >
                  <CodeSwatch theme={c} appearance={activeTheme?.appearance ?? 'light'} />
                  {t(CODE_COLOR_LABEL[c.id])}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </SlideOver>
  )
}
