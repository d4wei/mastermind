import path from 'node:path'
import { parseArgs } from 'node:util'

/**
 * Parses `FILE [--port PORT]`. `npm run` moves to the package root and records the invoking
 * directory as INIT_CWD, so a relative FILE resolves there only when npm started the script; a
 * direct run resolves against `cwd`, whatever INIT_CWD it inherited.
 */
export function previewArguments(args: string[], env: NodeJS.ProcessEnv, cwd: string): { file: string; port: number } {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { file: { type: 'string' }, port: { type: 'string', default: '5199' } } })
  const file = values.file ?? positionals[0]
  if (!file || positionals.length > 1) throw new Error('Usage: npm run dev -- FILE [--port PORT]')
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid preview port')
  const base = env.npm_lifecycle_event && env.INIT_CWD ? env.INIT_CWD : cwd
  return { file: path.resolve(base, file), port }
}
