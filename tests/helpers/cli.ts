import { spawn } from 'node:child_process'

export interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Runs `node` with `args` and collects its exit code and output, failing after ten seconds. With
 * `input` the child reads it from stdin; without, stdin is closed.
 */
export function runNode(args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}):
  Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: options.cwd, env: options.env,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout!.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr!.on('data', (chunk) => { stderr += chunk.toString() })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${args.join(' ')} did not exit`)) }, 10_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    if (options.input !== undefined) child.stdin!.end(options.input)
  })
}
