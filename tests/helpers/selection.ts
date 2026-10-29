/** How a test drives a DOM selection over rendered text. */
export interface SelectionDrive {
  /** Select from the end back to the start, as a reader dragging leftward does. */
  backward?: boolean
  /** Place each endpoint on the outermost element boundary that holds no other text. */
  elementEndpoints?: boolean
}

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

/** The text position holding rendered offset `at`; `end` prefers the earlier node at a node boundary. */
function locate(texts: readonly Text[], at: number, end: boolean): [Text, number] {
  let passed = 0
  for (const text of texts) {
    const inside = end ? at > passed && at <= passed + text.length : at >= passed && at < passed + text.length
    if (inside) return [text, at - passed]
    passed += text.length
  }
  throw new Error(`No text at rendered offset ${at}`)
}

/**
 * Selects the `occurrence`th match of `needle` in `root`'s rendered text through the document
 * selection, and returns the range the selection reports. `root` must be connected.
 */
export function selectRendered(root: Element, needle: string, occurrence = 0, drive: SelectionDrive = {}): Range {
  const texts = textNodes(root)
  const rendered = texts.map((text) => text.data).join('')
  let at = -1
  for (let index = 0; index <= occurrence; index++) {
    at = rendered.indexOf(needle, at + 1)
    if (at === -1) throw new Error(`Rendered text has no occurrence ${occurrence} of ${JSON.stringify(needle)}: ${JSON.stringify(rendered)}`)
  }
  let [startNode, startOffset]: [Node, number] = locate(texts, at, false)
  let [endNode, endOffset]: [Node, number] = locate(texts, at + needle.length, true)
  if (drive.elementEndpoints) {
    if (startOffset === 0) {
      let node: Node = startNode
      while (node.parentNode !== root && !node.previousSibling) node = node.parentNode!
      ;[startNode, startOffset] = [node.parentNode!, Array.prototype.indexOf.call(node.parentNode!.childNodes, node)]
    }
    if (endOffset === (endNode as Text).length) {
      let node: Node = endNode
      while (node.parentNode !== root && !node.nextSibling) node = node.parentNode!
      ;[endNode, endOffset] = [node.parentNode!, Array.prototype.indexOf.call(node.parentNode!.childNodes, node) + 1]
    }
  }
  const selection = window.getSelection()!
  selection.removeAllRanges()
  if (drive.backward) selection.setBaseAndExtent(endNode, endOffset, startNode, startOffset)
  else selection.setBaseAndExtent(startNode, startOffset, endNode, endOffset)
  return selection.getRangeAt(0)
}

export const DRIVES: [string, SelectionDrive][] = [
  ['forward text endpoints', {}],
  ['backward text endpoints', { backward: true }],
  ['forward element endpoints', { elementEndpoints: true }],
  ['backward element endpoints', { backward: true, elementEndpoints: true }],
]
