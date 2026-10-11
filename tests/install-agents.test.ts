import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  AGENT_TARGETS,
  MM_BEGIN,
  removeMarkedBlock,
  skillFile,
  stripFrontmatter,
  upsertMarkedBlock,
} from '../src/cli/install-agents'

const claude = AGENT_TARGETS.find((t) => t.id === 'claude')!
const cursor = AGENT_TARGETS.find((t) => t.id === 'cursor')!
const gemini = AGENT_TARGETS.find((t) => t.id === 'gemini')!
const canonicalSkill = fs.readFileSync(new URL('../.claude/skills/mastermind/SKILL.md', import.meta.url), 'utf8')
const canonicalBody = stripFrontmatter(canonicalSkill)

describe('install-agents helpers', () => {
  it('stripFrontmatter removes a leading --- block, leaves plain bodies alone', () => {
    expect(stripFrontmatter('---\nname: x\ndescription: y\n---\n\nBody here\n')).toBe('Body here\n')
    expect(stripFrontmatter('No frontmatter\n')).toBe('No frontmatter\n')
  })

  it('skillFile carries name/description and the per-agent version/license quirks', () => {
    const c = skillFile(claude, 'mastermind', 'desc', 'Body', '0.1.0')
    expect(c).toContain('name: mastermind')
    expect(c).toContain('description: desc')
    expect(c).not.toContain('version:')
    expect(c).not.toContain('license:')
    expect(c).toContain('Body')

    const cu = skillFile(cursor, 'mastermind', 'desc', 'Body', '0.1.0')
    expect(cu).toContain('version: 0.1.0')
    expect(cu).toContain('license: Apache-2.0')

    const g = skillFile(gemini, 'mastermind', 'desc', 'Body', '0.1.0')
    expect(g).toContain('version: 0.1.0')
    expect(g).not.toContain('license:')
  })

  it('skillFile flattens a multi-line description to one line', () => {
    expect(skillFile(claude, 'm', 'line one\nline two', 'B', '1')).toContain('description: line one line two')
  })

  it('carries the fresh preparation and original-file feedback protocol for every host', () => {
    for (const target of AGENT_TARGETS) {
      const rendered = skillFile(target, 'mastermind', 'desc', canonicalBody, '0.2.0')
      expect(rendered).toContain('reference/review-protocol.md')
      expect(rendered).toContain('translate the complete document afresh')
      expect(rendered).toContain('Do not start a translation listener or delegate to a separate translator')
      expect(rendered).toContain('--source-lang en --target-lang zh-CN --save')
    }
  })

  it('installs all public references alongside the skill in an isolated home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-install-'))
    try {
      const run = spawnSync(process.execPath,
        ['--import', 'tsx', path.resolve('src/cli/index.ts'), 'install-agents', '--all'],
        { env: { ...process.env, HOME: home }, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      const references = path.resolve('.claude/skills/mastermind/reference')
      for (const target of AGENT_TARGETS) {
        const installed = path.join(home, target.dir, 'skills/mastermind')
        expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8')).toContain('reference/review-protocol.md')
        for (const name of fs.readdirSync(references)) {
          expect(fs.readFileSync(path.join(installed, 'reference', name), 'utf8'))
            .toBe(fs.readFileSync(path.join(references, name), 'utf8'))
        }
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('upsertMarkedBlock appends once and is idempotent (replaces, never duplicates)', () => {
    const base = '# My memory\n\nSome existing rules.\n'
    const once = upsertMarkedBlock(base, 'ALPHA')
    expect(once).toContain('# My memory')
    expect(once).toContain('ALPHA')
    const twice = upsertMarkedBlock(once, 'BETA')
    expect(twice.split(MM_BEGIN).length - 1).toBe(1) // still exactly one block
    expect(twice).toContain('BETA')
    expect(twice).not.toContain('ALPHA')
  })

  it('upsertMarkedBlock into an empty file starts with the marker', () => {
    expect(upsertMarkedBlock('', 'Hi').startsWith(MM_BEGIN)).toBe(true)
  })

  it('removeMarkedBlock strips the block, keeps the rest, and is idempotent', () => {
    const withBlock = upsertMarkedBlock('# Mem\n\nrules\n', 'Block')
    const cleaned = removeMarkedBlock(withBlock)
    expect(cleaned).not.toContain(MM_BEGIN)
    expect(cleaned).toContain('# Mem')
    expect(cleaned).toContain('rules')
    expect(removeMarkedBlock(cleaned)).toBe(cleaned)
  })
})
