/** A single splice on a source string. `from`/`to` are UTF-16 code-unit offsets. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

