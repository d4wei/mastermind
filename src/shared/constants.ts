export const APP_NAME = 'mastermind'

/** Default port per spec ("5173 or next free"); server.json is the sole port authority. */
export const DEFAULT_PORT = 5173
export const PORT_SCAN_LIMIT = 20

export const SSE_PING_INTERVAL_MS = 15_000
export const SESSION_CLOSE_GRACE_MS = 30_000
export const SESSION_NEVER_OPENED_MS = 120_000
export const DAEMON_IDLE_EXIT_MS = 30 * 60_000

/** Neutral fallback when no configured signature or Git name is available. */
export const DEFAULT_AUTHOR_TAG = 'reviewer'

/** How long an agent-channel request waits for the agent to answer. */
export const ASSIST_TIMEOUT_MS = 120_000
