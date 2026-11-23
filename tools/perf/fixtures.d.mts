export const FIXTURE_DIR: string
export const FIXTURES: Record<string, () => string>
export function sha256(text: string): string
/** Writes any missing fixture and returns its path. */
export function ensureFixture(name: string): string
