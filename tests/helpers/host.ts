import type { ReviewerHost } from '../../ui/app/host'

const unconfigured = async (): Promise<never> => { throw new Error('Host operation is not configured for this test') }

export function fakeHost(overrides: Partial<ReviewerHost> = {}): ReviewerHost {
  return {
    getSession: unconfigured,
    getFile: unconfigured,
    putFile: unconfigured,
    saveCopy: unconfigured,
    subscribe: () => () => {},
    translations: async () => [],
    config: unconfigured,
    updateConfig: unconfigured,
    themes: unconfigured,
    setAppearance: async () => {},
    ...overrides,
  }
}
