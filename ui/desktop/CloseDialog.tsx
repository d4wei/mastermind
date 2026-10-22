import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { useT } from '../i18n'
import { useCompositionGuard } from '../util/composition'
import './CloseDialog.css'

type CloseChoice = 'save' | 'discard' | 'cancel'
interface Prompt { kind: 'draft' | 'save' | 'saving'; names: string[]; copyFailed?: boolean }
export const useClosePrompt = create<{ prompt: Prompt | null; choose: (choice: CloseChoice) => void }>(() => ({
  prompt: null, choose: () => {},
}))
export function askToClose(prompt: Prompt): Promise<CloseChoice> {
  return new Promise((resolve) => useClosePrompt.setState({ prompt, choose: (choice) => {
    useClosePrompt.setState({ prompt: null }); resolve(choice)
  } }))
}

export function CloseDialog() {
  const { prompt, choose } = useClosePrompt()
  const t = useT()
  const ime = useCompositionGuard()
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    if (prompt) dialog.current?.showModal()
    else dialog.current?.close()
  }, [prompt])
  return createPortal(<dialog ref={dialog} className="close-dialog" aria-labelledby="close-title"
    onCancel={(event) => { event.preventDefault(); choose('cancel') }}
    onKeyDown={(event) => { if (ime.isComposing(event.nativeEvent)) event.stopPropagation() }}>
    {prompt && <>
      <h2 id="close-title">{t(prompt.kind === 'draft' ? 'closeDraftTitle' : prompt.kind === 'saving' ? 'closeSavingTitle' : 'closeSaveTitle')}</h2>
      <p>{t(prompt.kind === 'draft' ? 'closeDraftBody' : prompt.kind === 'saving' ? 'closeSavingBody' : 'closeSaveBody')}</p>
      <ul>{prompt.names.map((name, index) => <li key={index}>{name}</li>)}</ul>
      {prompt.copyFailed && <p role="alert">{t('conflictCopyFailed')}</p>}
      <div className="close-actions">
        {prompt.kind !== 'saving' && <button type="button" className="btn-ghost" onClick={() => choose('discard')}>
          {t(prompt.kind === 'draft' ? 'discardDrafts' : 'dontSave')}</button>}
        <button type="button" className={prompt.kind === 'draft' ? 'btn-primary' : 'btn-ghost'}
          autoFocus={prompt.kind !== 'save'} onClick={() => choose('cancel')}>{t('cancel')}</button>
        {prompt.kind === 'save' && <button type="button" className="btn-primary" autoFocus
          onClick={() => choose('save')}>{t('conflictSaveCopy')}</button>}
      </div>
    </>}
  </dialog>, document.body)
}
