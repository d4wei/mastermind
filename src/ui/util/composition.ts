import { useCallback, useRef } from 'react'

export function useCompositionGuard() {
  const active = useRef(false)
  const textareaRef = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) active.current = false
  }, [])
  return {
    textareaRef,
    onCompositionStart: () => { active.current = true },
    onCompositionEnd: () => { active.current = false },
    onBlur: () => { active.current = false },
    isComposing(event: KeyboardEvent): boolean {
      // WebKit can dispatch compositionend before the IME's final keydown.
      return active.current || event.isComposing || event.keyCode === 229
    },
  }
}
