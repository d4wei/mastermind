// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { settledHeight, settledMarginBox } from '../ui/review/settling'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

it('subtracts what outermost shrinking sections are still to lose, margins included', () => {
  document.body.innerHTML = `<div id="card">
    <div id="quote" data-settles-to="46" style="margin: 8px 0"></div>
    <div id="composer" data-settles-to="0"><p id="alert" data-settles-to="0"></p></div>
    <div id="reveal" data-settles-to="0" style="margin-top: -4px"></div>
  </div>`
  const heights: Record<string, number> = { quote: 60, composer: 80, alert: 20, reveal: 28 }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: heights[this.id] ?? 0 } as DOMRect
  })
  // The quote loses 76 - 46, the composer (with its alert) 80, the reveal 28 - 4.
  expect(settledHeight(document.getElementById('card')!, 400)).toBe(400 - 30 - 80 - 24)
})

it('marks a shrink by its target height plus the element\'s margins', () => {
  document.body.innerHTML = '<div id="quote" style="margin: 8px 0 6px"></div>'
  expect(settledMarginBox(document.getElementById('quote')!, 46)).toBe(60)
})
