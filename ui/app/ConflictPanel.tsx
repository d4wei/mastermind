import { useState } from 'react'
import { useT, type MsgKey } from '../i18n'
import { Notification, NotificationRecall } from './Notifications'
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
  const saveCopyButton = <button type="button" className="btn-primary btn-compact"
    onClick={() => void saveCopy()}>{t('conflictSaveCopy')}</button>
  // Lossiness persists until the file is read back as UTF-8, so its notice has no dismissal.
  if (!state.recovery) return <Notification tier="persistent">
    <strong>{state.meta?.displayName}</strong>
    <p>{t('lossyNotice')}</p>
    {state.copyError && <p role="alert">{t('conflictCopyFailed')}</p>}
    <div className="notification-actions">{saveCopyButton}</div>
  </Notification>
  if (state.conflictDismissed) return <NotificationRecall label={`${state.meta?.displayName} · ${t('needsAttention')}`}
    title={t('needsAttention')} onOpen={() => state.openConflict()} />
  // Only an external change can be adopted; failures and a missing path offer Retry instead.
  const ioFailure = state.recovery !== 'changed'
  return <Notification tier="persistent" onDismiss={() => { setConfirmIncoming(false); state.closeConflict() }}>
    <strong>{state.meta?.displayName}</strong>
    <p>{t(RECOVERY_MESSAGE[state.recovery])}</p>
    {state.copyError && <p role="alert">{t('conflictCopyFailed')}</p>}
    {confirmIncoming && !ioFailure ? <>
      <p>{t('conflictDiscard')}</p>
      <div className="notification-actions">
        <button type="button" className="btn-primary btn-compact" disabled={state.saving}
          onClick={() => { setConfirmIncoming(false); void state.useConflictDisk() }}>{t('conflictUseDisk')}</button>
        <button type="button" className="btn-ghost btn-compact" onClick={() => setConfirmIncoming(false)}>{t('cancel')}</button>
      </div>
    </> : <div className="notification-actions">
      {saveCopyButton}
      {ioFailure ? <button type="button" className="btn-ghost btn-compact"
        onClick={() => void state.retryRecovery()}>{t('retry')}</button> :
        <button type="button" className="btn-ghost btn-compact"
          onClick={() => setConfirmIncoming(true)}>{t('conflictUseDisk')}</button>}
    </div>}
  </Notification>
}
