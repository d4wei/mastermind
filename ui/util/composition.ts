import { useMemo, useRef } from 'react'

/** A key the input method consumes; WebKit can dispatch compositionend before the IME's final keydown. */
export function isImeKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/** The guard is stable for the component's lifetime, so effects may depend on it. */
export function useCompositionGuard() {
  const active = useRef(false)
  return useMemo(() => ({
    /** Spread onto the guarded input to track its composition lifecycle. */
    inputProps: {
      ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => { if (!element) active.current = false },
      onCompositionStart: () => { active.current = true },
      onCompositionEnd: () => { active.current = false },
      onBlur: () => { active.current = false },
    },
    isComposing(event: KeyboardEvent): boolean {
      return active.current || isImeKey(event)
    },
  }), [])
}
