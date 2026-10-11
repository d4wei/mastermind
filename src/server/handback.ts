import { group, reviewCounts, scan } from '../shared/critic/scanner'
import { codeRanges } from '../shared/markdown/exclusions'
import { stripSummary, summaryLine, upsertSummary } from '../shared/summary'
import type { ReviewCounts } from '../shared/types'
import { writeSessionFile } from './files'
import type { Session } from './sessions'

export interface HandbackResult {
  ok: true
  mtimeMs: number
  version: string
  counts: ReviewCounts
  summaryLine: string
}

export type HandbackOutcome = HandbackResult | { ok: false; currentMtimeMs: number | null }

/**
 * The hand-back contract: strip any stale summary, count marks with the same
 * scanner the UI uses, write content + fresh summary block, and report the
 * one-line summary the CLI prints. The in-file block and the --wait stdout
 * line always agree by construction.
 */
export async function performHandback(
  session: Session,
  rawContent: string,
  baseVersion: string,
  note?: string,
): Promise<HandbackOutcome> {
  const content = rawContent
  const body = stripSummary(content)
  const counts = reviewCounts(group(scan(body, codeRanges(body)), body))
  const final = upsertSummary(content, counts, new Date(), note)

  const result = await writeSessionFile(session, final, baseVersion)
  if (!result.ok) return result
  return { ...result, counts, summaryLine: summaryLine(counts) }
}
