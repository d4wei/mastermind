export interface CloseDocuments {
  prepareToClose(): Promise<boolean>
}

export function createCloseHandler(documents: CloseDocuments, finish: () => Promise<void>,
  lock: (locked: boolean) => void, blocked: () => void | Promise<void>): () => Promise<void> {
  let pending = false
  return async () => {
    if (pending) return
    pending = true
    lock(true)
    try {
      let allowed = false
      try {
        if (await documents.prepareToClose()) { await finish(); allowed = true }
      } catch { /* Failed saves and exit requests both retain the window. */ }
      if (!allowed) await blocked()
    }
    finally { lock(false); pending = false }
  }
}
