import { previewArguments } from './arguments'
import { startPreview } from './server'

const { file, port } = previewArguments(process.argv.slice(2), process.env, process.cwd())
const preview = await startPreview(file, port)
console.log(`Development preview: ${preview.url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void preview.close() })
