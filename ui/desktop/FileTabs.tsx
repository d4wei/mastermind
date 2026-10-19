import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Popover } from 'radix-ui'
import { AlertIcon, ChevronDownIcon, CrossIcon } from '../icons'
import { fileLabels } from './file-labels'
import { fileWindow } from './file-window'
import { useClosePrompt } from './CloseDialog'

export interface OpenDocument { id: string; path: string }
interface FileTabsProps {
  files: OpenDocument[]
  activeId: string | null
  chinese: boolean
  needsAttention: (id: string) => boolean
  onSelect: (id: string) => void
  onAttention: (id: string) => void
  onClose: (file: OpenDocument) => Promise<boolean>
}

export function FileTabs({ files, activeId, chinese, needsAttention, onSelect, onAttention, onClose }: FileTabsProps) {
  const bar = useRef<HTMLElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [geometry, setGeometry] = useState({ width: Infinity, widths: [] as number[], overflowWidths: [] as number[], gap: 0 })
  const [open, setOpen] = useState(false)
  const pendingFocus = useRef<{ id: string; index: number; menu: boolean } | null>(null)
  const selecting = useRef(false)
  const selectedFocus = useRef<string | null>(null)
  const closePrompt = useClosePrompt((state) => state.prompt)
  const labels = fileLabels(files.map((file) => file.path))
  const activeIndex = Math.max(0, files.findIndex((file) => file.id === activeId))
  const measurementKey = JSON.stringify(files.map((file, index) => [file.id, labels[index], needsAttention(file.id)]))
  const overflowDigits = String(files.length).length
  const widths = geometry.widths.length === files.length ? geometry.widths : files.map(() => 0)
  const { start, end } = fileWindow(widths, activeIndex, geometry.width,
    geometry.overflowWidths, geometry.gap)
  const hidden = files.length - (end - start)

  useLayoutEffect(() => {
    const element = bar.current!
    const sizes = measure.current!
    const update = () => {
      const next = { width: element.getBoundingClientRect().width,
        widths: [...sizes.querySelectorAll('.native-file-size')].map((item) => item.getBoundingClientRect().width),
        overflowWidths: [...sizes.querySelectorAll('.native-file-overflow')].map((item) => item.getBoundingClientRect().width),
        gap: parseFloat(getComputedStyle(element).columnGap) || 0 }
      if (!next.width || next.widths.some((size) => !size)) return
      setGeometry((old) => old.width === next.width && old.gap === next.gap
        && old.widths.length === next.widths.length && old.widths.every((size, index) => size === next.widths[index])
        && old.overflowWidths.length === next.overflowWidths.length
        && old.overflowWidths.every((size, index) => size === next.overflowWidths[index]) ? old : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    for (const item of sizes.children) observer.observe(item)
    return () => observer.disconnect()
  }, [measurementKey])

  useEffect(() => {
    const dismiss = () => { selecting.current = true; setOpen(false) }
    window.addEventListener('mastermind-find', dismiss)
    return () => window.removeEventListener('mastermind-find', dismiss)
  }, [])
  useLayoutEffect(() => {
    if (closePrompt) { selecting.current = true; setOpen(false) }
  }, [closePrompt])
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending || files.some((file) => file.id === pending.id)) return
    if (files.length && !files.some((file) => file.id === activeId)) return
    pendingFocus.current = null
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('.native-file-close')
    const target = pending.menu && open && buttons?.length
      ? buttons[Math.min(pending.index, buttons.length - 1)]
      : bar.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')
        ?? document.querySelector<HTMLButtonElement>('.native-open')
    target?.focus()
    target?.scrollIntoView?.({ block: 'nearest' })
    if (!files.length) setOpen(false)
  }, [files, activeId, open])

  useLayoutEffect(() => {
    if (open || selectedFocus.current !== activeId) return
    bar.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
    selectedFocus.current = null
  }, [activeId, open])

  const close = async (file: OpenDocument, menu: boolean) => {
    if (pendingFocus.current) return
    pendingFocus.current = { id: file.id, index: files.indexOf(file), menu }
    if (!await onClose(file)) pendingFocus.current = null
  }
  const select = (id: string) => {
    selectedFocus.current = id
    selecting.current = true
    setOpen(false)
    onSelect(id)
  }
  const row = (file: OpenDocument, index: number, menu: boolean, measuring = false) => {
    const Control = measuring ? 'span' : 'button'
    return <div key={file.id}
    className={`${measuring ? 'native-file-size' : 'native-file-pill'}${menu ? ' native-file-entry' : ''}${activeId === file.id ? ' active' : ''}`}>
    <Control type={measuring ? undefined : "button"} className="native-file-select" aria-current={!measuring && activeId === file.id ? 'page' : undefined}
      title={file.path} onClick={measuring ? undefined : () => select(file.id)}>{labels[index]}</Control>
    {needsAttention(file.id) && <Control type={measuring ? undefined : "button"} className="native-file-attention btn-ghost btn-icon"
      aria-label={`${labels[index]} · ${chinese ? '需要处理' : 'Needs attention'}`}
      onClick={measuring ? undefined : () => { select(file.id); onAttention(file.id) }}><AlertIcon /></Control>}
    <Control type={measuring ? undefined : "button"} className="native-file-close btn-icon" onClick={measuring ? undefined : () => { void close(file, menu) }}
      aria-label={`${chinese ? '关闭' : 'Close'} ${labels[index]}`}
      title={`${chinese ? '关闭' : 'Close'} ${file.path}`}><CrossIcon /></Control>
  </div>
  }
  const move = (event: KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const target = (event.target as HTMLElement).closest('.native-file-entry')
    const rows = [...list.current!.querySelectorAll('.native-file-entry')]
    const index = rows.indexOf(target!)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
    const button = rows[next]?.querySelector<HTMLButtonElement>('.native-file-select')
    button?.focus(); button?.scrollIntoView?.({ block: 'nearest' })
  }
  const label = chinese ? `全部 ${files.length} 个打开的文件` : `All ${files.length} open files`
  return <nav ref={bar} data-tauri-drag-region className="native-file-pills" aria-label={chinese ? '打开的文件' : 'Open files'}>
    <div ref={measure} className="native-file-measure" aria-hidden inert>
      {files.map((file, index) => row(file, index, false, true))}
      {Array.from({ length: overflowDigits }, (_, index) => <span key={index} className="native-file-overflow">
        +{'9'.repeat(index + 1)}<ChevronDownIcon /></span>)}
    </div>
    {files.slice(start, end).map((file, index) => row(file, start + index, false))}
    <Popover.Root open={open && files.length > 0} onOpenChange={setOpen} modal={false}>
      {(hidden > 0 || open) && <Popover.Trigger asChild>
        <button ref={trigger} type="button" className="native-file-overflow btn-ghost" aria-label={label}
          title={chinese ? '打开的文件' : 'Open files'}>+{hidden}<ChevronDownIcon /></button>
      </Popover.Trigger>}
      <Popover.Portal>
        <Popover.Content ref={list} className="native-file-list" aria-label={chinese ? '打开的文件' : 'Open files'}
          align="end" sideOffset={8} collisionPadding={8} onKeyDown={move}
          onOpenAutoFocus={(event) => {
            event.preventDefault(); selecting.current = false
            const button = list.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')
              ?? list.current?.querySelector<HTMLButtonElement>('.native-file-select')
            button?.focus(); button?.scrollIntoView?.({ block: 'nearest' })
            window.dispatchEvent(new Event('mastermind-find-close'))
          }}
          onCloseAutoFocus={(event) => {
            if (selecting.current || !trigger.current) event.preventDefault()
            selecting.current = false
          }}>
          <div className="native-file-list-title">{chinese ? '打开的文件' : 'Open files'}</div>
          {files.map((file, index) => row(file, index, true))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </nav>
}
