import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { planTranslation, savePreparedTranslation } from './prepared-translations'
const program = new Command().name('mastermind translate-blocks')
function die(code: number, message: string): never {
  process.stderr.write(`mastermind: ${message}\n`)
  process.exit(code)
}
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

program
  .argument('<file>', 'markdown file to prepare for translation')
  .requiredOption('--source-lang <code>', 'repository/source language code')
  .requiredOption('--target-lang <code>', 'target language code')
  .option('--save', 'read a complete prepared translation artifact as JSON from stdin')
  .description('emit every current block for a fresh translation pass, or save a complete result')
  .action(async (file: string, opts: { save?: boolean; sourceLang: string; targetLang: string }) => {
    let realPath: string
    let source: string
    try {
      realPath = fs.realpathSync(path.resolve(file))
      source = fs.readFileSync(realPath, 'utf8')
    } catch {
      die(2, `file not found: ${path.resolve(file)}`)
    }
    try {
      if (opts.save) {
        const artifact: unknown = JSON.parse(await readStdin())
        const result = await savePreparedTranslation(realPath, source, opts.sourceLang, opts.targetLang, artifact)
        process.stdout.write(`${JSON.stringify(result)}\n`)
      } else {
        const plan = await planTranslation(realPath, source, opts.sourceLang, opts.targetLang)
        process.stdout.write(`${JSON.stringify(plan)}\n`)
      }
    } catch (error) {
      die(2, error instanceof Error ? error.message : String(error))
    }
    process.exit(0)
  })

program.parseAsync().catch((error: unknown) => die(1, error instanceof Error ? error.message : String(error)))
