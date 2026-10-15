import { act } from 'react'

export function openReaderMenu(container: HTMLElement): void {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
  act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

export function readerMenuItem(label: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent === label)
  if (!item) throw new Error(`Missing reader menu item: ${label}`)
  return item
}
