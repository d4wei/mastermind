import { useT } from '../i18n'
import { SlideOver } from './SlideOver'
import { useDoc, type createDocStore } from '../documents/store'
import './ConflictPanel.css'

interface Props {
  store?: ReturnType<typeof createDocStore>
}

export function ConflictPanel({ store = useDoc }: Props) {
  const state = store()
  const t = useT()
  const draft = state.conflictDraft
  if (!state.conflict) return null
  const missing = state.diskChange?.deleted ?? false
  const stale = !!draft && (draft.localRevision !== state.revision ||
    (state.diskChange !== null && state.diskChange.version !== draft.diskVersion))
  const unavailable = !draft?.diskVersion || missing || draft.refreshing || stale || state.saving
  const disk = state.diskChange?.content ?? draft?.diskContent
  return (
    <div className="conflict-host">
      <div className="conflict-notice" role="status">
        <span>{t(missing ? 'conflictMissing' : 'conflictNotice')}</span>
        <button type="button" className="btn-ghost conflict-compare" disabled={state.saving}
          onClick={() => void state.openConflict()}>{t('conflictCompare')}</button>
      </div>
      {draft?.open && (
        <SlideOver title={t('conflictTitle')} onClose={state.closeConflict} ignoreSelector=".conflict-compare">
          <div className="conflict-comparison">
            <div className="conflict-versions">
              <section><h3 title={t('conflictBaseHint')}>{t('conflictBase')}</h3><pre>{draft.base}</pre></section>
              <section><h3>{t('conflictLocal')}</h3><pre>{draft.local}</pre></section>
              <section><h3>{t('conflictDisk')}</h3><pre>{missing ? t('conflictMissing') : disk ?? t('conflictReadFailed')}</pre></section>
            </div>
            <label className="conflict-result">
              <span>{t('conflictResult')}</span>
              <textarea title={t('conflictResultHint')} value={draft.result} disabled={state.saving}
                onChange={(event) => state.setConflictResult(event.target.value)} />
            </label>
            {missing && <p role="alert">{t('conflictMissing')}</p>}
            {stale && !missing && <p role="alert">{t('conflictStale')}</p>}
            {draft.error && <p role="alert">{t(draft.error === 'read' ? 'conflictReadFailed' : 'conflictSaveFailed')}</p>}
            <div className="conflict-actions">
              <button type="button" className="btn-ghost" disabled={state.saving || draft.refreshing}
                onClick={() => void state.refreshConflict()}>{t(draft.refreshing ? 'conflictRefreshing' : 'conflictRefresh')}</button>
              <button type="button" className="btn-ghost" disabled={unavailable}
                onClick={() => void state.useConflictDisk()}>{t('conflictUseDisk')}</button>
              <button type="button" className="btn-cta" disabled={unavailable}
                onClick={() => void state.saveConflictResult()}>{t('conflictSaveResult')}</button>
              <button type="button" className="btn-ghost" onClick={state.closeConflict}>{t('close')}</button>
            </div>
          </div>
        </SlideOver>
      )}
    </div>
  )
}
