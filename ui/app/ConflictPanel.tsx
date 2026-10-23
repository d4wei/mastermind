import { useState } from 'react'
import { useT, type MsgKey } from '../i18n'
import { Notification } from './Notifications'
import { AlertIcon } from '../icons'
import { useDoc, type createDocStore, type Recovery } from '../documents/store'
import { navigate } from './route'
import { transferDrafts } from '../review/drafts'

interface Props { store?: ReturnType<typeof createDocStore> }

const RECOVERY_MESSAGE = {
  changed: 'conflictNotice', missing: 'conflictMissing', readFailed: 'conflictReadFailed', saveFailed: 'conflictSaveFailed',
} as const satisfies Record<Recovery, MsgKey>

export function ConflictPanel({ store = useDoc }: Props) {
  const state = store()
  const t = useT()
  const [confirmIncoming, setConfirmIncoming] = useState(false)
  if (state.saving || !state.recovery && !state.lossy) return null
  const saveCopy = async () => {
    const copyId = await state.saveCopy()
    if (copyId && state.sessionId) transferDrafts(state.sessionId, copyId)
    if (copyId && store.getState().sessionId === copyId) navigate(`/d/${copyId}`)
  }
  const saveCopyButton = <button type="button" className="btn-primary"
    onClick={() => void saveCopy()}>{t('conflictSaveCopy')}</button>
  // Lossiness persists until the file is read back as UTF-8, so its notice has no dismissal.
  if (!state.recovery) return <Notification>
    <strong>{state.meta?.displayName}</strong>
    <p>{t('lossyNotice')}</p>
    {state.copyError && <p role="alert">{t('conflictCopyFailed')}</p>}
    <div className="conflict-actions">{saveCopyButton}</div>
  </Notification>
  if (state.conflictDismissed) return <Notification compact>
    <button type="button" className="btn-ghost btn-icon recovery-warning" aria-label={`${state.meta?.displayName} · ${t('needsAttention')}`}
      title={t('needsAttention')} onClick={() => state.openConflict()}>
      <AlertIcon />
    </button>
  </Notification>
  // Only an external change can be adopted; failures and a missing path offer Retry instead.
  const ioFailure = state.recovery !== 'changed'
  return <Notification onDismiss={() => { setConfirmIncoming(false); state.closeConflict() }}>
    <strong>{state.meta?.displayName}</strong>
    <p>{t(RECOVERY_MESSAGE[state.recovery])}</p>
    {state.copyError && <p role="alert">{t('conflictCopyFailed')}</p>}
    {confirmIncoming && !ioFailure ? <>
      <p>{t('conflictDiscard')}</p>
      <div className="conflict-actions">
        <button type="button" className="btn-primary" disabled={state.saving}
          onClick={() => { setConfirmIncoming(false); void state.useConflictDisk() }}>{t('conflictUseDisk')}</button>
        <button type="button" className="btn-ghost" onClick={() => setConfirmIncoming(false)}>{t('cancel')}</button>
      </div>
    </> : <div className="conflict-actions">
      {saveCopyButton}
      {ioFailure ? <button type="button" className="btn-ghost"
        onClick={() => void state.retryRecovery()}>{t('retry')}</button> :
        <button type="button" className="btn-ghost"
          onClick={() => setConfirmIncoming(true)}>{t('conflictUseDisk')}</button>}
    </div>}
  </Notification>
}
