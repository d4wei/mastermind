import { useLayoutEffect, useRef, type ComponentType, type SVGProps } from 'react'
import { ToggleGroup } from 'radix-ui'
import { useT } from '../i18n'
import { ChatIcon, CodeIcon, EyeIcon, LanguageIcon } from '../icons'
import { HandBackButton } from './HandBackButton'
import { SlotLabel } from '../util/SlotLabel'
import { useDoc, type ViewMode } from './store'

interface TopBarProps {
  resolved?: { count: number; open: boolean; onToggle: () => void }
  railOpen?: boolean
  onToggleRail?: () => void
  /** Whether the comment-rail toggle applies in the current view. It collapses
      out (animated) rather than unmounting when false, so the pill morphs. */
  commentsAvailable?: boolean
  /** Reading-language toggle, rendered beside the centered mode switch. */
  translation?: {
    label: string
    active: boolean
    loading: boolean
    onToggle: () => void
  }
}

export function TopBar({ railOpen, onToggleRail, commentsAvailable, translation, resolved }: TopBarProps) {
  const t = useT()
  const headerRef = useRef<HTMLElement | null>(null)
  const meta = useDoc((s) => s.meta)
  const mode = useDoc((s) => s.mode)
  const setMode = useDoc((s) => s.setMode)
  // Retain hidden controls so the floating bar animates between their widths.
  const transVisible = mode === 'reading'
  const commentsVisible = mode === 'reading' && !!commentsAvailable
  const mtimeMs = useDoc((s) => s.mtimeMs)

  const MODES: { id: ViewMode; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
    { id: 'reading', label: t('reading'), Icon: EyeIcon },
    { id: 'source', label: t('source'), Icon: CodeIcon },
  ]

  // Publish the floating bar's measured height so overlays/content can reserve
  // clearance above it (--bar-h drives --bar-clear in app.css).
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--bar-h', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <header className="topbar" ref={headerRef}>
      <div className="topbar-lead">
        <ToggleGroup.Root
          className="seg"
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as ViewMode)}
          aria-label={t('viewMode')}
          title={`⌘E ${t('viewMode')}`}
        >
          {MODES.map(({ id, label, Icon }) => (
            <ToggleGroup.Item key={id} value={id} className="seg-btn" aria-label={label} title={label}>
              <Icon />
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
        <span className="topbar-divider" aria-hidden="true" />
        <SlotLabel
          className="topbar-filename"
          text={meta?.displayName ?? '…'}
          revealOnMount
          rerollKey={mtimeMs}
          tint="var(--color-accent)"
        />
      </div>
      <div className="topbar-right">
        {translation && (
          <button
            type="button"
            className={`topbar-trans topbar-collapsible${transVisible ? '' : ' is-collapsed'}${translation.active ? ' active' : ''}${translation.loading ? ' loading' : ''}`}
            onClick={translation.onToggle}
            disabled={translation.loading}
            inert={!transVisible}
            aria-pressed={translation.active}
            aria-label={translation.loading ? t('translating') : translation.label}
            title={t('toggleLang')}
          >
            <LanguageIcon />
          </button>
        )}
        {onToggleRail && (
          <button
            type="button"
            className={`btn-ghost topbar-icon-btn topbar-collapsible${commentsVisible ? '' : ' is-collapsed'}${railOpen ? ' active' : ''}`}
            onClick={onToggleRail}
            inert={!commentsVisible}
            aria-label={railOpen ? t('hideComments') : t('showComments')}
            aria-pressed={railOpen}
            title={t('toggleRail')}
          >
            <ChatIcon />
          </button>
        )}
        {resolved && (
          <button type="button" className={`btn-ghost topbar-resolved${resolved.open ? ' active' : ''}`}
            aria-pressed={resolved.open} onClick={resolved.onToggle}>
            {t('resolved')} ({resolved.count})
          </button>
        )}
        <HandBackButton />
      </div>
    </header>
  )
}
