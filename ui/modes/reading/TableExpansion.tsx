import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Expansion = { close: () => void }
const TableExpansionContext = createContext({
  hidden: false,
  begin: (_owner: Expansion) => {},
  end: (_owner: Expansion) => {},
  collapse: () => {},
})

export function TableExpansionProvider({ children }: { children: ReactNode }) {
  const owner = useRef<Expansion | null>(null)
  const [hidden, setHidden] = useState(false)
  const begin = useCallback((next: Expansion) => {
    if (owner.current !== next) owner.current?.close()
    owner.current = next
    setHidden(true)
  }, [])
  const end = useCallback((previous: Expansion) => {
    if (owner.current !== previous) return
    owner.current = null
    setHidden(false)
  }, [])
  const collapse = useCallback(() => owner.current?.close(), [])
  const value = useMemo(() => ({ hidden, begin, end, collapse }), [hidden, begin, end, collapse])
  return <TableExpansionContext.Provider value={value}>{children}</TableExpansionContext.Provider>
}

export const useTableExpansion = () => useContext(TableExpansionContext)
