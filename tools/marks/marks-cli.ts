import fs from 'node:fs'
import { formatMark, inventoryMarks } from './inventory'

const USAGE = 'Usage: mastermind marks [--json] FILE...'

function invalid(message: string): never {
  process.stderr.write(`mastermind: ${message}\n${USAGE}\n`)
  process.exit(2)
}

const args = process.argv.slice(2)
let json = false
const files: string[] = []
let literal = false
for (const arg of args) {
  if (literal || !arg.startsWith('-') || arg === '-') files.push(arg)
  else if (arg === '--') literal = true
  else if (arg === '--json') json = true
  else invalid(`unknown option: ${arg}`)
}
if (files.length === 0) invalid('no files given')

const sources = files.map((file) => {
  try {
    if (fs.statSync(file).isDirectory()) invalid(`not a file: ${file} is a directory`)
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    invalid((error as NodeJS.ErrnoException).code === 'ENOENT' ? `file not found: ${file}` : `cannot read ${file}`)
  }
})

let malformed = false
const results = files.map((file, index) => {
  const inventory = inventoryMarks(sources[index]!)
  for (const problem of inventory.problems) {
    malformed = true
    process.stderr.write(`${file}:L${problem.line}:${problem.column}: ${problem.message}\n`)
  }
  return { file, ...inventory }
})

if (json) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
} else {
  const prefix = (file: string) => files.length > 1 ? `${file}:` : ''
  for (const { file, marks } of results) {
    for (const mark of marks) process.stdout.write(`${prefix(file)}${formatMark(mark)}\n`)
  }
}
process.exitCode = malformed ? 1 : 0
