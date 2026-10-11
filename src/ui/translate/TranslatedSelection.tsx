import { useEffect, useRef, useState, type RefObject } from 'react'
import { matchPreparedTranslation, translatedCommentEdit, type PreparedTranslation } from '../../shared/translation'
import { useDoc } from '../app/store'
import { useConfig } from '../app/configStore'
import { useT } from '../i18n'
import { useTranslation } from './translationStore'

interface Props {
  containerRef: RefObject<HTMLElement | null>
  sessionId: string
  artifact: PreparedTranslation
  authorTag: string
  stale?: boolean
}
interface Selection { blockId: string; quote: string; top: number; left: number }
export function TranslatedSelection({ containerRef, sessionId, artifact, authorTag, stale }: Props) {
  const t = useT()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [composing, setComposing] = useState(false)
  const [body, setBody] = useState('')
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
      setSelection({ blockId: first.dataset.transBlockId!, quote, top: rect.top, left: rect.left })
      setError(false)
    }
    document.addEventListener('selectionchange', change)
    return () => document.removeEventListener('selectionchange', change)
  }, [containerRef, artifact])
  const close = () => { setSelection(null); setComposing(false); setBody(''); setError(false) }
  const submit = async () => {
    if (!selection || !body.trim() || busy.current) return
    busy.current = true
    setSubmitting(true)
    try {
      const current = useDoc.getState()
      const translated = useTranslation.getState()
      if (current.sessionId !== sessionId || !translated.active || translated.artifact !== artifact ||
        translated.targetLang !== artifact.targetLang || useConfig.getState().config?.comfortLang !== artifact.targetLang ||
        !(await matchPreparedTranslation(current.source, artifact))) {
        setError(true); return
      }
      const edit = await translatedCommentEdit(current.source, { blockId: selection.blockId,
        sourceHash: artifact.sourceHash, quote: selection.quote, language: artifact.targetLang, author: authorTag, body })
      const latest = useDoc.getState()
      if (!edit || latest.sessionId !== sessionId || latest.source !== current.source ||
        useTranslation.getState().artifact !== artifact || !useTranslation.getState().active ||
        useConfig.getState().config?.comfortLang !== artifact.targetLang) { setError(true); return }
      latest.applyEdits([edit])
      window.getSelection()?.removeAllRanges()
      close()
    } finally { busy.current = false; setSubmitting(false) }
  }
  if (!selection) return null
  return <div className="sel-toolbar" style={{ top: Math.max(8, selection.top - (composing ? 150 : 44)),
    left: Math.max(8, Math.min(selection.left, window.innerWidth - 280)) }}
    onMouseDown={(event) => { if ((event.target as HTMLElement).tagName !== 'TEXTAREA') event.preventDefault() }}>
    {!composing ? <button type="button" onClick={() => setComposing(true)}>{t('comment')}</button> :
      <div className="sel-composer">
        <textarea autoFocus rows={3} value={body} placeholder={t('commentPlaceholder')}
          onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit()
            if (event.key === 'Escape') close()
            event.stopPropagation()
          }} />
        {(error || stale) && <div role="alert">{t('translatedCommentStale')}</div>}
        <div className="sel-composer-actions">
          <button type="button" onClick={close}>{t('cancel')}</button>
          <button type="button" className="primary" disabled={!body.trim() || submitting}
            onClick={() => void submit()}>{t('comment')}</button>
        </div>
      </div>}
  </div>
}
