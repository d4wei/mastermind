import { useCallback, useRef } from 'react'

/** A key the input method consumes; WebKit can dispatch compositionend before the IME's final keydown. */
export function isImeKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

export function useCompositionGuard() {
  const active = useRef(false)
  const ref = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (!element) active.current = false
  }, [])
  return {
    /** Spread onto the guarded input to track its composition lifecycle. */
    inputProps: {
      ref,
      onCompositionStart: () => { active.current = true },
      onCompositionEnd: () => { active.current = false },
      onBlur: () => { active.current = false },
    },
    isComposing(event: KeyboardEvent): boolean {
      return active.current || isImeKey(event)
    },
  }
}
