import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveWithin } from '../tools/preview/contain'

let raw: string
let root: string
let outsideDir: string
let outsideFile: string
let evilSibling: string

beforeEach(() => {
  raw = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-ws-'))
  root = fs.realpathSync(raw) // mirror the route: macOS /tmp is itself a symlink

  fs.writeFileSync(path.join(root, 'a.md'), '# A\n\nHi {>>a note<<} there {++added++}.\n')
  fs.writeFileSync(path.join(root, 'plain.txt'), 'not markdown\n')
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'b.md'), '# B\n')
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg.md'), '# dep\n')
  fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n')

  // a sibling with a shared name prefix — the classic startsWith() footgun
  evilSibling = `${root}-evil`
  fs.mkdirSync(evilSibling)
  fs.writeFileSync(path.join(evilSibling, 'secret.md'), '# sibling secret\n')

  // a file genuinely outside the root
  outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-out-')))
  outsideFile = path.join(outsideDir, 'secret.md')
  fs.writeFileSync(outsideFile, '# outside secret\n')

  // symlinks: one contained, one escaping to a file, one escaping to the sibling dir
  fs.symlinkSync(path.join(root, 'sub', 'b.md'), path.join(root, 'link-in'))
  fs.symlinkSync(outsideFile, path.join(root, 'link-out'))
  fs.symlinkSync(evilSibling, path.join(root, 'sibling-link'))
})

afterEach(() => {
  fs.rmSync(raw, { recursive: true, force: true })
  fs.rmSync(evilSibling, { recursive: true, force: true })
  fs.rmSync(outsideDir, { recursive: true, force: true })
})

describe('resolveWithin', () => {
  it('resolves a normal file inside the root', async () => {
    expect(await resolveWithin(root, 'a.md')).toBe(path.join(root, 'a.md'))
  })

  it('resolves a nested file', async () => {
    expect(await resolveWithin(root, 'sub/b.md')).toBe(path.join(root, 'sub', 'b.md'))
  })

  it("treats '' and '.' as the root itself", async () => {
    expect(await resolveWithin(root, '')).toBe(root)
    expect(await resolveWithin(root, '.')).toBe(root)
  })

  it('resolves dotfiles (hiding is the route’s job, not containment’s)', async () => {
    expect(await resolveWithin(root, '.env')).toBe(path.join(root, '.env'))
  })

  it('BLOCKS a leading-.. traversal', async () => {
    expect(await resolveWithin(root, '../secret.md')).toBeNull()
    expect(await resolveWithin(root, '..')).toBeNull()
    expect(await resolveWithin(root, 'sub/../../etc/hosts')).toBeNull()
  })

  it('BLOCKS an absolute path injection', async () => {
    expect(await resolveWithin(root, '/etc/passwd')).toBeNull()
    expect(await resolveWithin(root, outsideFile)).toBeNull()
  })

  it('BLOCKS a sibling-prefix escape via symlink', async () => {
    // sibling-link -> <root>-evil ; without the trailing-sep guard this would
    // pass a naive startsWith(root) check
    expect(await resolveWithin(root, 'sibling-link/secret.md')).toBeNull()
  })

  it('BLOCKS a symlink pointing outside the root', async () => {
    expect(await resolveWithin(root, 'link-out')).toBeNull()
  })

  it('ALLOWS a symlink that resolves back inside the root', async () => {
    expect(await resolveWithin(root, 'link-in')).toBe(path.join(root, 'sub', 'b.md'))
  })

  it('returns null for a nonexistent path (ENOENT)', async () => {
    expect(await resolveWithin(root, 'nope.md')).toBeNull()
  })
})
