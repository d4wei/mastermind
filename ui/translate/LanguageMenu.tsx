import { useEffect, useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { LanguageIcon, ChevronDownIcon } from '../icons'
import { useT } from '../i18n'
import { pendingDrafts, discardDrafts, useDraftFocus } from '../review/drafts'
import { askToClose } from '../desktop/CloseDialog'
import { useDoc } from '../documents/store'
import { useTranslation } from './translationStore'
import { languageName } from './languages'

export function LanguageMenu() {
  const t = useT()
  const { available, targetLang, select, sessionId } = useTranslation()
  const currentId = useDoc((s) => s.sessionId)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const close = () => setOpen(false)
    for (const event of ['mastermind-find', 'mastermind-files-open']) window.addEventListener(event, close)
    return () => { for (const event of ['mastermind-find', 'mastermind-files-open']) window.removeEventListener(event, close) }
  }, [])
  const change = async (language: string | null) => {
    if (language === targetLang) return
    const drafts = pendingDrafts(sessionId ? [sessionId] : [])
    if (drafts.length) {
      const result = await askToClose({ kind: 'draft', names: drafts.map((draft) => draft.label) })
      if (useDoc.getState().sessionId !== sessionId) return
      if (result === 'cancel') { useDraftFocus.setState({ target: drafts[0]! }); return }
      discardDrafts(drafts)
    }
    if (useDoc.getState().sessionId === sessionId) await select(language)
  }
  if (!available.length || currentId !== sessionId) return null
  const label = targetLang ? languageName(targetLang) : t('original')
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={(next) => {
    setOpen(next)
    if (next) {
      window.dispatchEvent(new Event('mastermind-find-close'))
      window.dispatchEvent(new Event('mastermind-language-open'))
    }
  }}>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="btn-ghost topbar-language" title={label} aria-label={`${t('readingLanguage')}: ${label}`}>
        <LanguageIcon /><span>{label}</span><ChevronDownIcon />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="reader-menu" align="end" sideOffset={8}>
      <DropdownMenu.RadioGroup value={targetLang ?? ''} onValueChange={(value) => { void change(value || null) }}>
        {[{ code: '', label: t('original') }, ...available.map((item) => ({ code: item.targetLang, label: languageName(item.targetLang) }))]
          .map((item) => <DropdownMenu.RadioItem className="reader-menu-item" key={item.code} value={item.code}>
            {item.label}
          </DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}
