import { useState } from 'react'
import { useT } from '../i18n'
import { Notification } from './Notifications'
import { AlertIcon } from '../icons'
import { useDoc, type createDocStore, type RecoveryError } from '../documents/store'
import { requireReviewerHost } from './host'
import { navigate } from './route'
import { transferDrafts } from '../review/drafts'

interface Props { store?: ReturnType<typeof createDocStore> }
const errorKeys = {
  read: 'conflictReadFailed', save: 'conflictSaveFailed', changed: 'conflictStale',
} as const satisfies Record<RecoveryError, string>

export function ConflictPanel({ store = useDoc }: Props) {
  const state = store()
  const t = useT()
  const [confirmIncoming, setConfirmIncoming] = useState(false)
  if (!state.conflict || state.saving) return null
  if (state.conflictDismissed) return <Notification compact>
    <button type="button" className="btn-ghost btn-icon recovery-warning" aria-label={`${state.meta?.displayName} · ${t('needsAttention')}`}
      title={t('needsAttention')} onClick={() => void state.openConflict()}>
      <AlertIcon />
    </button>
  </Notification>
  const saveCopy = async () => {
    const copyId = await state.saveCopy()
    if (copyId && state.sessionId) transferDrafts(state.sessionId, copyId)
    if (copyId && store.getState().sessionId === copyId) navigate(`/d/${copyId}`)
  }
  const ioFailure = state.diskChange?.deleted || state.recoveryError === 'read' || state.recoveryError === 'save'
  const message = state.diskChange?.deleted ? 'conflictMissing' : state.recoveryError === 'read'
    ? 'conflictReadFailed' : state.recoveryError === 'save' ? 'conflictSaveFailed' : 'conflictNotice'
  return <Notification onDismiss={() => { setConfirmIncoming(false); state.closeConflict() }}>
    <strong>{state.meta?.displayName}</strong>
    <p>{t(message)}</p>
    {state.recoveryError && !ioFailure && <p role="alert">{t(errorKeys[state.recoveryError])}</p>}
    {state.copyError && <p role="alert">{t('conflictCopyFailed')}</p>}
    {confirmIncoming && !ioFailure ? <>
      <p>{t('conflictDiscard')}</p>
      <div className="conflict-actions">
        <button type="button" className="btn-primary" disabled={state.saving}
          onClick={() => { setConfirmIncoming(false); void state.useConflictDisk() }}>{t('conflictUseDisk')}</button>
        <button type="button" className="btn-ghost" onClick={() => setConfirmIncoming(false)}>{t('cancel')}</button>
      </div>
    </> : <div className="conflict-actions">
      {requireReviewerHost().saveCopy && <button type="button" className="btn-primary"
        onClick={() => void saveCopy()}>{t('conflictSaveCopy')}</button>}
      {ioFailure ? <button type="button" className="btn-ghost"
        onClick={() => void state.retryRecovery()}>{t('retry')}</button> :
        <button type="button" className="btn-ghost"
          onClick={() => setConfirmIncoming(true)}>{t('conflictUseDisk')}</button>}
    </div>}
  </Notification>
}
