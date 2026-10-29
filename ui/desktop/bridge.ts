import type { NativeBridge } from './host'

declare global {
  interface Window {
    __TAURI__: {
      core: Pick<NativeBridge, 'invoke'>
      event: { listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void> }
    }
  }
}

export const nativeBridge: NativeBridge = {
  invoke: (command, args) => window.__TAURI__.core.invoke(command, args),
  listen: (event, handler) => window.__TAURI__.event.listen(event, (received) => handler(received.payload)),
}
