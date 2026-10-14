import type { ReviewerHost } from '../../ui/app/host'

const unconfigured = async (): Promise<never> => { throw new Error('Host operation is not configured for this test') }

export function fakeHost(overrides: Partial<ReviewerHost> = {}): ReviewerHost {
  return {
    getSession: unconfigured,
    getFile: unconfigured,
    putFile: unconfigured,
    subscribe: () => () => {},
    translation: unconfigured,
    config: unconfigured,
    updateConfig: unconfigured,
    themes: unconfigured,
    ...overrides,
  }
}
