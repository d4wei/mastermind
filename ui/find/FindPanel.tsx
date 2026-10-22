import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Analysis } from '../../document/markdown/analyze'
import { useDoc } from '../documents/store'
import { useT } from '../i18n'
import { ChevronDownIcon, ChevronUpIcon, CrossIcon, SearchIcon } from '../icons'
import { commentSearchText } from '../review/CommentBody'
import { useCompositionGuard } from '../util/composition'
import { textMatches, type Match } from './matches'
import { clearMatches, commentRange, paintMatches, readingMatches, revealMatch } from './reading'
import { useSourceSearch } from './source'
import './find.css'

interface FindState { open: boolean; query: string; caseSensitive: boolean }
const retained = new Map<string, FindState>()
useDoc.subscribe((state) => {
  for (const id of retained.keys()) if (!state.hasDocument(id)) retained.delete(id)
})

interface Result extends Match { range?: Range; comment?: number; anchor?: number }
interface Props {
  sessionId: string
  source: string
  mode: 'reading' | 'translated' | 'source'
  docRef: RefObject<HTMLElement | null>
  analysis: Analysis | null
  onOpen: () => void
  onRevealComment: (spanIndex: number) => void
  onClose: () => void
}

export function FindPanel({ sessionId, source, mode, docRef, analysis, onOpen, onRevealComment, onClose }: Props) {
  const t = useT()
  const ime = useCompositionGuard()
  const [state, setState] = useState<FindState>(() => retained.get(sessionId) ?? { open: false, query: '', caseSensitive: false })
  const { open, query, caseSensitive } = state
  const [index, setIndex] = useState(0)
  const [revision, setRevision] = useState(0)
  const [focusRequest, setFocusRequest] = useState(0)
  const [wrapped, setWrapped] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const setInput = useCallback((element: HTMLInputElement | null) => {
    input.current = element
    ime.ref(element)
  }, [ime.ref])
  const pendingReveal = useRef(false)
  const chooseFromPosition = useRef(false)
  const adapter = useSourceSearch((s) => s.adapter?.sessionId === sessionId ? s.adapter : null)
  const restoreRail = useRef(onClose)
  restoreRail.current = onClose
  useEffect(() => { retained.set(sessionId, state) }, [sessionId, state])

  const openFind = useCallback(() => {
    if (document.getElementById('root')?.inert || document.querySelector('.close-dialog[open]')) return
    const active = document.activeElement as HTMLElement | null
    let selected = ''
    if (!open && !active?.closest('input, textarea, select, .find-bar')) {
      if (mode === 'source') selected = adapter?.selection() ?? ''
      else {
        const selection = window.getSelection()
        if (selection?.anchorNode && docRef.current?.contains(selection.anchorNode)) selected = selection.toString()
      }
    }
    if (!open) returnFocus.current = active
    const seed = selected && !/[\r\n]/.test(selected) ? selected : undefined
    setState((current) => ({ ...current, open: true, query: seed ?? current.query }))
    if (!open || seed !== undefined) { pendingReveal.current = true; chooseFromPosition.current = true }
    onOpen()
    setFocusRequest((value) => value + 1)
  }, [adapter, mode, docRef, open, onOpen])

  const close = useCallback(() => {
    if (!open) return
    setState((current) => ({ ...current, open: false }))
    pendingReveal.current = false
    clearMatches()
    adapter?.close()
    onClose()
    const previous = returnFocus.current
    if (previous?.isConnected && previous !== document.body && !previous.closest('.find-bar')) previous.focus({ preventScroll: true })
    else if (mode === 'source') adapter?.focus()
    else {
      const target = docRef.current
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }) }
    }
  }, [open, adapter, mode, docRef, onClose])

  useLayoutEffect(() => {
    if (open && focusRequest) { input.current?.focus({ preventScroll: true }); input.current?.select() }
  }, [open, focusRequest])

  useLayoutEffect(() => {
    if (!open || !panel.current) return
    const element = panel.current
    const measure = () => document.documentElement.style.setProperty('--find-panel-height', `${element.offsetHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--find-panel-height') }
  }, [open])

  useEffect(() => {
    if (!open || mode === 'source') return
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.find-bar'))) {
        setRevision((value) => value + 1)
      }
    })
    const root = document.querySelector('.app-content') ?? docRef.current
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [open, mode, docRef])

  const [results, setResults] = useState<Result[]>([])
  const latestResults = useRef(results)
  useLayoutEffect(() => {
    const publish = (next: Result[]) => { latestResults.current = next; setResults(next) }
    if (!open || !query) { publish([]); return }
    if (mode === 'source') { publish(adapter ? adapter.matches(query, caseSensitive) : []); return }
    const root = docRef.current
    const body: Result[] = root ? readingMatches(root, query, caseSensitive) : []
    if (mode === 'reading' && analysis) for (const item of analysis.items) {
      if (item.type !== 'thread') continue
      const anchor = analysis.spans.indexOf(item.anchor ?? item.comments[0]!.span)
      for (const comment of item.comments) {
        const commentIndex = analysis.spans.indexOf(comment.span)
        body.push(...textMatches(commentSearchText(comment.body), query, caseSensitive)
          .map((match) => ({ ...match, comment: commentIndex, anchor })))
      }
    }
    publish(body)
  }, [open, query, caseSensitive, mode, adapter, docRef, analysis, source, revision])

  // Search effects update the editor only after React has committed its view.
  useLayoutEffect(() => {
    if (open && mode === 'source') adapter?.query(query, caseSensitive)
  }, [open, mode, query, caseSensitive, adapter])

  const rangeFor = useCallback((result: Result): Range | null => {
    if (result.range) return result.range
    const body = document.querySelector<HTMLElement>(`[data-find-comment="${result.comment}"] .rail-body`)
    return body ? commentRange(body, result) : null
  }, [])

  const currentIndex = Math.min(index, Math.max(0, results.length - 1))
  const step = useCallback((delta: number) => {
    if (!results.length) return
    const next = currentIndex + delta
    setWrapped(next < 0 || next >= results.length)
    pendingReveal.current = true
    chooseFromPosition.current = false
    setIndex((next + results.length) % results.length)
    // A single result still needs to be revealed on repeated navigation.
    setRevision((value) => value + 1)
  }, [results.length, currentIndex])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.getElementById('root')?.inert || document.querySelector('.close-dialog[open]')) return
      if (ime.isComposing(event)) return
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation(); openFind()
      } else if (open && modifier && event.key.toLowerCase() === 'g') {
        const target = event.target as HTMLElement | null
        if (target?.closest('input, textarea, select, [contenteditable="true"]') && !panel.current?.contains(target) && !target.closest('.cm-editor')) return
        event.preventDefault(); event.stopPropagation(); step(event.shiftKey ? -1 : 1)
      } else if (open && event.key === 'Escape' && (panel.current?.contains(event.target as Node) ||
        (event.target as HTMLElement | null)?.closest('.cm-editor') ||
        !(event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]'))) {
        event.preventDefault(); event.stopPropagation(); close()
      }
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('mastermind-find', openFind)
    window.addEventListener('mastermind-find-close', close)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mastermind-find', openFind); window.removeEventListener('mastermind-find-close', close) }
  }, [open, openFind, close, step, ime])

  useLayoutEffect(() => {
    if (!open) { clearMatches(); return }
    if (results !== latestResults.current) return
    let selected = currentIndex
    if (chooseFromPosition.current && results.length) {
      const top = document.querySelector('.document-scroll')?.getBoundingClientRect().top ?? 0
      const found = results.findIndex((result) => mode === 'source' ? result.from >= (adapter?.start() ?? 0) :
        (rangeFor(result)?.getBoundingClientRect().bottom ?? -1) >= top)
      selected = Math.max(0, found)
      chooseFromPosition.current = false
      if (selected !== index) setIndex(selected)
    }
    const result = results[selected]
    if (mode === 'source') {
      clearMatches()
      if (pendingReveal.current && result) { adapter?.select(result, panel.current); pendingReveal.current = false }
      return
    }
    const current = result ? rangeFor(result) : null
    paintMatches(results.map(rangeFor).filter((range): range is Range => !!range), current)
    if (!pendingReveal.current || !result) return
    if (result.comment !== undefined) onRevealComment(result.anchor!)
    if (!current) return
    const frame = requestAnimationFrame(() => {
      if (current.startContainer.isConnected) revealMatch(current, panel.current)
      pendingReveal.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [open, results, currentIndex, index, mode, adapter, rangeFor, onRevealComment])

  useEffect(() => () => { clearMatches(); restoreRail.current() }, [])
  useEffect(() => () => { adapter?.close() }, [adapter])

  if (!open) return null
  const count = results.length ? t('findCount').replace('{current}', String(currentIndex + 1)).replace('{total}', String(results.length)) : query ? t('findNone') : ''
  const countSize = results.length ? t('findCount').replace('{current}', String(results.length)).replace('{total}', String(results.length)) : count
  return <div className="find-bar" role="search" aria-label={t('find')} ref={panel}>
    <SearchIcon />
    <input ref={setInput}
      spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off"
      className="settings-input find-input" aria-label={t('findPlaceholder')} placeholder={t('findPlaceholder')}
      value={query} onChange={(event) => {
        pendingReveal.current = true; chooseFromPosition.current = true; setWrapped(false)
        setState((current) => ({ ...current, query: event.target.value }))
      }} onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd} onBlur={ime.onBlur}
      onKeyDown={(event) => {
        if (ime.isComposing(event.nativeEvent)) return
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); step(event.shiftKey ? -1 : 1) }
      }} />
    <span className="find-count">
      <span className="find-count-size" aria-hidden="true">{countSize}</span>
      <span role="status" aria-live="polite">{count}<span className="find-announcement">{wrapped ? ` · ${t('findWrapped')}` : ''}</span></span>
    </span>
    <div className="find-actions">
      <button className="btn-ghost btn-icon find-nav" type="button" aria-label={t('findCase')} title={t('findCase')}
        aria-pressed={caseSensitive} onClick={() => {
          pendingReveal.current = true; chooseFromPosition.current = true
          setState((current) => ({ ...current, caseSensitive: !current.caseSensitive }))
        }}>Aa</button>
      <button className="btn-ghost btn-icon find-nav" type="button" disabled={!results.length} aria-label={t('findPrevious')}
        title={t('findPrevious')} onClick={() => step(-1)}><ChevronUpIcon /></button>
      <button className="btn-ghost btn-icon find-nav" type="button" disabled={!results.length} aria-label={t('findNext')}
        title={t('findNext')} onClick={() => step(1)}><ChevronDownIcon /></button>
      <button className="btn-ghost btn-icon find-nav" type="button" aria-label={t('findClose')} title={t('findClose')}
        onClick={close}><CrossIcon /></button>
    </div>
  </div>
}
