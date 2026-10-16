import { useEffect, useRef, useState, type ReactNode } from 'react'

const IDLE_MS = 1000
const EDGE_HIT_WIDTH = 16

export function DocumentScroll({ children }: { children: ReactNode }) {
  const [scrolling, setScrolling] = useState(false)
  const [atEdge, setAtEdge] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return <div className="document-scroll" data-scroll-active={scrolling || atEdge}
    onScroll={() => {
      setScrolling(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setScrolling(false), IDLE_MS)
    }}
    onPointerMove={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect()
      setAtEdge(event.clientX >= bounds.right - EDGE_HIT_WIDTH)
    }}
    onPointerLeave={() => setAtEdge(false)}>{children}</div>
}
