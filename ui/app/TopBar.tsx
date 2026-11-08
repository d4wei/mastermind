import { LanguageMenu } from '../translate/LanguageMenu'
import { useContext, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ToolbarTarget } from './ToolbarTarget'
import { DropdownMenu } from 'radix-ui'
import { useT } from '../i18n'
import { ChatIcon, SearchIcon, CodeIcon, EyeIcon, GearIcon, HistoryIcon, MoreIcon } from '../icons'
import { requestFind, useOverlayControl } from './overlayStore'
import { useDoc } from '../documents/store'

interface TopBarProps {
  settings: { open: boolean; onToggle: () => void }
  resolved: { count: number; open: boolean; onToggle: () => void }
  railOpen: boolean
  onToggleRail: () => void
  commentsAvailable: boolean
}

export function TopBar({ railOpen, onToggleRail, commentsAvailable, resolved, settings }: TopBarProps) {
  const t = useT()
  const target = useContext(ToolbarTarget)
  const openingPanel = useRef(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const mode = useDoc((s) => s.mode)
  const setMode = useDoc((s) => s.setMode)
  const sessionId = useDoc((s) => s.sessionId)
  const [menuOpen, setMenuOpen] = useOverlayControl('menu', sessionId)
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
  }, [target])

  const controls = (
    <header className="topbar" ref={headerRef}>
      {mode === 'reading' && <LanguageMenu />}
      <button type="button" className="btn-ghost btn-icon topbar-icon-btn topbar-find" data-find-trigger="" onClick={requestFind}
        aria-label={t('find')} title={`${t('find')} (${navigator.platform.startsWith('Mac') ? '⌘F' : 'Ctrl+F'})`}><SearchIcon /></button>
      {mode === 'reading' && commentsAvailable && (
        <button type="button" className={`btn-ghost btn-icon topbar-icon-btn topbar-comments${railOpen ? ' active' : ''}`}
          onClick={onToggleRail} aria-label={railOpen ? t('hideComments') : t('showComments')}
          aria-pressed={railOpen} title={t('toggleRail')}><ChatIcon /></button>
      )}
      <button type="button" className="btn-ghost btn-icon topbar-icon-btn" onClick={() => setMode(destination)}
        aria-label={t(destination)} title={t(destination)}><ModeIcon /></button>
      <DropdownMenu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={`btn-ghost btn-icon topbar-icon-btn topbar-overflow${settings.open || resolved.open ? ' active' : ''}`}
            aria-label={t('moreActions')}
            title={t('moreActions')}><MoreIcon /></button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content data-keeps-discussion="" className="reader-menu" align="end" sideOffset={8}
            onCloseAutoFocus={(event) => {
              if (openingPanel.current) event.preventDefault()
              openingPanel.current = false
            }}>
            <DropdownMenu.Item className="reader-menu-item" onSelect={() => { openingPanel.current = true; resolved.onToggle() }}>
              <HistoryIcon />{t('resolved')} ({resolved.count})
            </DropdownMenu.Item>
            <DropdownMenu.Item className="reader-menu-item" onSelect={() => { openingPanel.current = true; settings.onToggle() }}>
              <GearIcon />{t('settings')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  )
  return target ? createPortal(controls, target) : controls
}
