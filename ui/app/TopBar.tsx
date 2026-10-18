import { useLayoutEffect, useRef } from 'react'
import { DropdownMenu } from 'radix-ui'
import { useT } from '../i18n'
import { ChatIcon, SearchIcon, CodeIcon, EyeIcon, GearIcon, HistoryIcon, LanguageIcon, MoreIcon } from '../icons'
import { requestFind } from '../find/events'
import { useDoc } from '../documents/store'

interface TopBarProps {
  settings?: { open: boolean; onToggle: () => void }
  resolved?: { count: number; open: boolean; onToggle: () => void }
  railOpen?: boolean
  onToggleRail?: () => void
  commentsAvailable?: boolean
  translation?: {
    label: string
    active: boolean
    loading: boolean
    onToggle: () => void
  }
}

export function TopBar({ railOpen, onToggleRail, commentsAvailable, translation, resolved, settings }: TopBarProps) {
  const t = useT()
  const openingPanel = useRef(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const mode = useDoc((s) => s.mode)
  const setMode = useDoc((s) => s.setMode)
  const destination = mode === 'reading' ? 'source' : 'reading'
  const ModeIcon = mode === 'reading' ? CodeIcon : EyeIcon

  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--bar-h', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--bar-h')
    }
  }, [])

  return (
    <header className="topbar" ref={headerRef}>
      <button type="button" className="btn-ghost btn-icon topbar-icon-btn topbar-find" onClick={requestFind}
        aria-label={t('find')} title={`${t('find')} (${navigator.platform.startsWith('Mac') ? '⌘F' : 'Ctrl+F'})`}><SearchIcon /></button>
      <button type="button" className="btn-ghost btn-icon topbar-icon-btn" onClick={() => setMode(destination)}
        aria-label={t(destination)} title={t(destination)}><ModeIcon /></button>
      {translation && mode === 'reading' && (
        <button type="button" className={`btn-ghost btn-icon topbar-icon-btn${translation.active ? ' active' : ''}`}
          onClick={translation.onToggle} disabled={translation.loading} aria-pressed={translation.active}
          aria-label={translation.loading ? t('translating') : translation.label} title={t('toggleLang')}>
          <LanguageIcon />
        </button>
      )}
      {onToggleRail && mode === 'reading' && commentsAvailable && (
        <button type="button" className={`btn-ghost btn-icon topbar-icon-btn topbar-comments${railOpen ? ' active' : ''}`}
          onClick={onToggleRail} aria-label={railOpen ? t('hideComments') : t('showComments')}
          aria-pressed={railOpen} title={t('toggleRail')}><ChatIcon /></button>
      )}
      {(settings || resolved) && <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={`btn-ghost btn-icon topbar-icon-btn topbar-overflow${settings?.open || resolved?.open ? ' active' : ''}`}
            aria-label={t('moreActions')}
            title={t('moreActions')}><MoreIcon /></button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="reader-menu" align="end" sideOffset={8}
            onCloseAutoFocus={(event) => {
              if (openingPanel.current) event.preventDefault()
              openingPanel.current = false
            }}>
            {resolved && <DropdownMenu.Item className="reader-menu-item" onSelect={() => { openingPanel.current = true; resolved.onToggle() }}>
              <HistoryIcon />{t('resolved')} ({resolved.count})
            </DropdownMenu.Item>}
            {settings && <DropdownMenu.Item className="reader-menu-item" onSelect={() => { openingPanel.current = true; settings.onToggle() }}>
              <GearIcon />{t('settings')}
            </DropdownMenu.Item>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>}
    </header>
  )
}
