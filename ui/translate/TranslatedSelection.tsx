import { useDraftGuard, useDraftState } from '../review/drafts'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { matchPreparedTranslation, translatedCommentEdit, type PreparedTranslation } from '../../document/translation'
import { useDoc } from '../documents/store'
import { useConfig } from '../app/configStore'
import { useT } from '../i18n'
import { useCompositionGuard } from '../util/composition'
import { documentViewport } from '../util/scroll'
import { useTranslation } from './translationStore'

interface Props {
  containerRef: RefObject<HTMLElement | null>
  sessionId: string
  artifact: PreparedTranslation
  authorTag: string
  stale?: boolean
  readOnly?: boolean
}
interface Selection { artifact: PreparedTranslation; blockId: string; quote: string; top: number; left: number }
export function TranslatedSelection({ containerRef, sessionId, artifact, authorTag, stale, readOnly = false }: Props) {
  const t = useT()
  const ime = useCompositionGuard()
  const [selection, setSelection] = useDraftState<Selection | null>('translated:selection', null)
  const [composing, setComposing] = useDraftState('translated:composing', false)
  const [body, setBody] = useDraftState('translated:body', '')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const busy = useRef(false)
  const composingRef = useRef(false)
  composingRef.current = composing
  useEffect(() => {
    const change = () => {
      if (composingRef.current) return
      const selected = window.getSelection()
      if (!selected || selected.isCollapsed || selected.rangeCount !== 1) { setSelection(null); return }
      const range = selected.getRangeAt(0)
      const block = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
        ?.closest<HTMLElement>('[data-trans-block-id]')
      const first = block(range.startContainer)
      const last = block(range.endContainer)
      if (!first || first !== last || !containerRef.current?.contains(first)) { setSelection(null); return }
      const quote = selected.toString()
      if (!quote.trim()) { setSelection(null); return }
      const rect = range.getBoundingClientRect()
      setSelection({ artifact, blockId: first.dataset.transBlockId!, quote, top: rect.top, left: rect.left })
      setError(false)
    }
    const scrollTarget = documentViewport().target
    document.addEventListener('selectionchange', change)
    scrollTarget.addEventListener('scroll', change, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', change)
      scrollTarget.removeEventListener('scroll', change)
    }
  }, [containerRef, artifact])
  const close = () => { setSelection(null); setComposing(false); setBody(''); setError(false) }
  const submit = async () => {
    if (readOnly || !selection || !body.trim() || busy.current) return
    const capturedArtifact = selection.artifact
    busy.current = true
    setSubmitting(true)
    try {
      const current = useDoc.getState()
      const translated = useTranslation.getState()
      if (current.sessionId !== sessionId || !translated.active || translated.artifact !== capturedArtifact ||
        translated.targetLang !== capturedArtifact.targetLang || useConfig.getState().config?.translationLanguage !== capturedArtifact.targetLang ||
        !(await matchPreparedTranslation(current.source, capturedArtifact))) {
        setError(true); return
      }
      const edit = await translatedCommentEdit(current.source, { blockId: selection.blockId,
        sourceHash: capturedArtifact.sourceHash, quote: selection.quote, language: capturedArtifact.targetLang, author: authorTag, body })
      const latest = useDoc.getState()
      if (latest.conflict || !edit || latest.sessionId !== sessionId || latest.source !== current.source ||
        useTranslation.getState().artifact !== capturedArtifact || !useTranslation.getState().active ||
        useConfig.getState().config?.translationLanguage !== capturedArtifact.targetLang) { setError(true); return }
      latest.applyEdits([edit])
      window.getSelection()?.removeAllRanges()
      close()
    } finally { busy.current = false; setSubmitting(false) }
  }
  const composer = useRef<HTMLDivElement>(null)
  useDraftGuard('translated', t('comment'), composing && !!body.trim(),
    () => { requestAnimationFrame(() => composer.current?.querySelector('textarea')?.focus()) }, close)
  if (!selection) return null
  return <div ref={composer} className="sel-toolbar" style={{ top: Math.max(8, selection.top - (composing ? 150 : 44)),
    left: Math.max(8, Math.min(selection.left, window.innerWidth - 280)) }}
    onMouseDown={(event) => { if ((event.target as HTMLElement).tagName !== 'TEXTAREA') event.preventDefault() }}>
    {!composing ? <button type="button" disabled={readOnly} onClick={() => setComposing(true)}>{t('comment')}</button> :
      <div className="sel-composer">
        {readOnly && <p role="status">{t('editingPaused')}</p>}
        <textarea readOnly={readOnly} ref={ime.textareaRef} autoFocus rows={3} onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd} onBlur={ime.onBlur} value={body} placeholder={t('commentPlaceholder')}
          onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => {
            if (ime.isComposing(event.nativeEvent)) { event.stopPropagation(); return }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit()
            if (event.key === 'Escape') close()
            event.stopPropagation()
          }} />
        {(error || stale || selection.artifact !== artifact) && <div role="alert">{t('translatedCommentStale')}</div>}
        <div className="sel-composer-actions">
          <button type="button" onClick={close}>{t('cancel')}</button>
          <button type="button" className="primary" disabled={readOnly || !body.trim() || submitting}
            onClick={() => void submit()}>{t('comment')}</button>
        </div>
      </div>}
  </div>
}
