import { useState } from 'react'
import { useT } from '../i18n'
import { Notification } from './Notifications'
import { useDoc, type createDocStore, type RecoveryError } from '../documents/store'
import { requireReviewerHost } from './host'
import { navigate } from './route'

interface Props { store?: ReturnType<typeof createDocStore> }
const errorKeys = {
  read: 'conflictReadFailed', save: 'conflictSaveFailed', overlap: 'conflictOverlap',
  limit: 'conflictLimit', copy: 'conflictCopyFailed', changed: 'conflictStale',
} as const satisfies Record<RecoveryError, string>

export function ConflictPanel({ store = useDoc }: Props) {
  const state = store()
  const t = useT()
  const [confirmIncoming, setConfirmIncoming] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  if (!state.conflict) return null
  if (state.conflictDismissed) return <Notification>
    <button type="button" className="btn-ghost" onClick={() => void state.openConflict()}>
      {state.meta?.displayName} · {t('needsAttention')}
    </button>
  </Notification>
  const saveCopy = async () => {
    const copyId = await state.saveCopy()
    if (copyId && store.getState().sessionId === copyId) navigate(`/d/${copyId}`)
  }
  return <Notification onDismiss={state.closeConflict}>
    <strong>{state.meta?.displayName}</strong>
    <p>{t(state.diskChange?.deleted ? 'conflictMissing' : 'conflictNotice')}</p>
    {state.recoveryError && <p role="alert">{t(errorKeys[state.recoveryError])}</p>}
    {confirmIncoming ? <>
      <p>{t('conflictDiscard')}</p>
      <div className="conflict-actions">
        <button type="button" className="btn-cta" disabled={state.saving}
          onClick={() => { setConfirmIncoming(false); void state.useConflictDisk() }}>{t('conflictUseDisk')}</button>
        <button type="button" className="btn-ghost" onClick={() => setConfirmIncoming(false)}>{t('cancel')}</button>
      </div>
    </> : <div className="conflict-actions">
      <button type="button" className="btn-cta" disabled={state.saving}
        onClick={() => void state.tryMerge()}>{t('conflictTryMerge')}</button>
      <button type="button" className="btn-ghost" disabled={state.saving}
        onClick={() => setConfirmIncoming(true)}>{t('conflictUseDisk')}</button>
      {requireReviewerHost().saveCopy && <button type="button" className="btn-ghost" disabled={state.saving}
        onClick={() => void saveCopy()}>{t('conflictSaveCopy')}</button>}
      <button type="button" className="btn-ghost" onClick={async () => {
        try { await navigator.clipboard.writeText(state.source); setCopyFailed(false) }
        catch { setCopyFailed(true) }
      }}>{t('conflictCopy')}</button>
    </div>}
    {copyFailed && <p role="alert">{t('conflictClipboardFailed')}</p>}
  </Notification>
}
