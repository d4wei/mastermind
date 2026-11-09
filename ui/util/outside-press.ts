import { useEffect, useRef } from 'react'

/**
 * Marks a floating layer: a surface drawn over the document, such as a panel, bar, toolbar, or
 * dialog. See `outside-press.md` for the rule it takes part in.
 */
export const LAYER = { 'data-layer': '' } as const
/** Radix portals its menus, popovers, and tooltips into a wrapper, which counts as a layer. */
const LAYER_SELECTOR = '[data-layer], [data-radix-popper-content-wrapper]'
/** Pointer travel, in pixels, beyond which a press and release is a drag rather than a click. */
const DRAG_DISTANCE = 4

/** Whether the close dialog, or the inert root behind it, holds the window. */
export function modalOpen(): boolean {
  return !!document.getElementById('root')?.inert || !!document.querySelector('.close-dialog[open]')
}

export interface Layer {
  /** What the layer occupies; a press within it is inside. */
  element?: Element | null
  /** Surfaces beyond `element` whose presses are the layer's own, such as the control that toggles it. */
  inside?: string | ((target: Element) => boolean)
  /** Where the layer is placed, when that is not `element`; a layer nested with it does not shield it. */
  host?: Element | null
}

/**
 * Whether a press on `target` is outside `layer`. A press in another floating layer is that layer's
 * own, unless the two are nested; a press while a modal is up is outside nothing.
 */
export function isOutsidePress(target: EventTarget | null, layer: Layer): boolean {
  // A control the press removed, such as a menu item, was inside what it belonged to.
  if (!(target instanceof Element) || !target.isConnected || modalOpen()) return false
  const { element, inside, host = element } = layer
  if (element?.contains(target)) return false
  if (typeof inside === 'string' ? target.closest(inside) : inside?.(target)) return false
  const owner = target.closest(LAYER_SELECTOR)
  return !owner || !!host && (owner.contains(host) || host.contains(owner))
}

export interface OutsidePressOptions {
  /**
   * `press` acts at pointerdown in the capture phase, so a press the document stops still counts,
   * and never prevents the press's default. `click` waits for the click a press ends in, ignoring a
   * drag, and sees only clicks that reach the document.
   */
  on?: 'press' | 'click'
  enabled?: boolean
}

/** Calls `onOutside` for each press outside the layer `layer()` describes at that moment. */
export function useOutsidePress(layer: () => Layer, onOutside: () => void,
  { on = 'press', enabled = true }: OutsidePressOptions = {}): void {
  const latest = useRef({ layer, onOutside })
  latest.current = { layer, onOutside }
  useEffect(() => {
    if (!enabled) return
    const outside = (event: Event): boolean =>
      isOutsidePress(event.composedPath()[0] ?? event.target, latest.current.layer())
    if (on === 'press') {
      const press = (event: PointerEvent): void => { if (outside(event)) latest.current.onOutside() }
      window.addEventListener('pointerdown', press, true)
      return () => window.removeEventListener('pointerdown', press, true)
    }
    // The press that began the coming click. A press that ends without one (a context menu, a touch
    // turned into a scroll) or a key that can click is forgotten, so it cannot measure a later click.
    let pressed: { x: number; y: number } | null = null
    const press = (event: PointerEvent): void => { pressed = { x: event.clientX, y: event.clientY } }
    const forget = (): void => { pressed = null }
    const click = (event: MouseEvent): void => {
      const from = pressed
      pressed = null
      if (event.button !== 0) return
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG_DISTANCE) return
      if (outside(event)) latest.current.onOutside()
    }
    const forgetting = ['pointercancel', 'contextmenu', 'keydown'] as const
    document.addEventListener('pointerdown', press, true)
    for (const type of forgetting) document.addEventListener(type, forget, true)
    document.addEventListener('click', click)
    return () => {
      document.removeEventListener('pointerdown', press, true)
      for (const type of forgetting) document.removeEventListener(type, forget, true)
      document.removeEventListener('click', click)
    }
  }, [on, enabled])
}
