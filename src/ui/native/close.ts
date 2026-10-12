export interface CloseDocuments {
  prepareToClose(): Promise<boolean>
}

export function createCloseHandler(documents: CloseDocuments, finish: () => Promise<void>,
  lock: (locked: boolean) => void, blocked: () => void): () => Promise<void> {
  let pending = false
  return async () => {
    if (pending) return
    pending = true
    lock(true)
    try {
      if (await documents.prepareToClose()) await finish()
      else blocked()
    } catch { blocked() }
    finally { lock(false); pending = false }
  }
}
