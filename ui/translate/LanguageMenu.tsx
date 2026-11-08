import { DropdownMenu } from 'radix-ui'
import { LanguageIcon, ChevronDownIcon } from '../icons'
import { useT } from '../i18n'
import { pendingDrafts, discardDrafts, focusDraft } from '../review/drafts'
import { askToClose } from '../desktop/CloseDialog'
import { useDoc } from '../documents/store'
import { useOverlayControl } from '../app/overlayStore'
import { useTranslation } from './translationStore'
import { languageName } from './languages'

export function LanguageMenu() {
  const t = useT()
  const { available, targetLang, select, sessionId } = useTranslation()
  const currentId = useDoc((s) => s.sessionId)
  // The control unmounts with Markdown mode and the document view, closing its menu.
  const [open, setOpen] = useOverlayControl('language', currentId)
  const change = async (language: string | null) => {
    if (language === targetLang) return
    const drafts = pendingDrafts(sessionId ? [sessionId] : [])
    if (drafts.length) {
      const result = await askToClose({ kind: 'draft', names: drafts.map((draft) => draft.label) })
      if (useDoc.getState().sessionId !== sessionId) return
      if (result === 'cancel') { focusDraft(drafts[0]!); return }
      discardDrafts(drafts)
    }
    if (useDoc.getState().sessionId === sessionId) await select(language)
  }
  if (!available.length || currentId !== sessionId) return null
  const label = targetLang ? languageName(targetLang) : t('original')
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="btn-ghost topbar-language" title={label} aria-label={`${t('readingLanguage')}: ${label}`}>
        <LanguageIcon /><span>{label}</span><ChevronDownIcon />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content data-keeps-discussion="" className="reader-menu" align="end" sideOffset={8}>
      <DropdownMenu.RadioGroup value={targetLang ?? ''} onValueChange={(value) => { void change(value || null) }}>
        {[{ code: '', label: t('original') }, ...available.map((item) => ({ code: item.targetLang, label: languageName(item.targetLang) }))]
          .map((item) => <DropdownMenu.RadioItem className="reader-menu-item" key={item.code} value={item.code}>
            {item.label}
          </DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}
