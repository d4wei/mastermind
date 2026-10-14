import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
export function createReactHost(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement('div')
  document.body.append(host)
  return { host, root: createRoot(host) }
}

export function removeReactHost(root: Root, host: HTMLElement): void {
  act(() => root.unmount())
  host.remove()
}

export function inputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export function rangeBetween(start: Node, from: number, end: Node, to: number): Range {
  const range = document.createRange()
  range.setStart(start, from)
  range.setEnd(end, to)
  return range
}
