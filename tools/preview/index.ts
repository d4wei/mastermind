import path from 'node:path'
import { parseArgs } from 'node:util'
import { startPreview } from './server'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { file: { type: 'string' }, port: { type: 'string', default: '5199' } } })
const file = values.file ?? positionals[0]
if (!file || positionals.length > 1) throw new Error('Usage: npm run dev -- FILE [--port PORT]')
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid preview port')
// `npm run` moves to the package root; INIT_CWD keeps a relative FILE relative to the caller.
const preview = await startPreview(path.resolve(process.env.INIT_CWD ?? process.cwd(), file), port)
console.log(`Development preview: ${preview.url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void preview.close() })
