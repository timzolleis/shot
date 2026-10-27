import {
  ArtifactStore,
  type CaptureResult,
  type Finding,
  findingsNewSinceBase,
  hasErrorFinding,
  type SessionLabel,
  partDescription,
  sizeDescription,
  sourceDescription,
} from '../index.ts'
import { Console, Effect, Option, Predicate } from 'effect'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** stdout holds only what to read: paths, findings, JSON, one line of notes. */
export const printLine = (line: string) => Console.log(line)

/** A project-relative file, relative to where the agent runs shot. */
export const displayPath = (file: string) =>
  Effect.map(ArtifactStore, (store) => path.relative(process.cwd(), store.absolutePath(file)) || file)

/**
 * One line per finding: `warn target People (iPhone 15): touch target 67×40, under 44×44 (#invite)`. The source only
 * when the run shot several, the size only when it shot several; the same finding in light and dark is one line.
 */
export const findingLines = (
  results: ReadonlyArray<CaptureResult>,
): ReadonlyArray<{ readonly severity: Finding['severity']; readonly line: string }> => {
  const sources = new Set(results.map((result) => sourceDescription(result.capture.source)))
  const sizes = new Set(results.map((result) => sizeDescription(result.capture.variant.size)))

  const lines = results.flatMap(({ capture, findings }) =>
    findings.map((finding) => {
      const where = [
        ...(sources.size > 1 ? [`${sourceDescription(capture.source)} ›`] : []),
        Option.getOrElse(capture.name, () => partDescription(capture.part)),
        ...(sizes.size > 1 ? [`(${sizeDescription(capture.variant.size)})`] : []),
      ].join(' ')

      const selector = finding.selector === '' ? '' : ` (${finding.selector})`

      return {
        severity: finding.severity,
        line: `${finding.severity} ${finding.check} ${where}: ${finding.message}${selector}`,
      }
    }),
  )

  return lines.filter((entry, index) => lines.findIndex((other) => other.line === entry.line) === index)
}

/** What a run reports: its findings against the base label, how many the base had too, and whether it fails. */
export interface FindingsReport {
  readonly results: ReadonlyArray<CaptureResult>
  readonly inBase: number
  /** The base has these captures, shot without `--check`: nothing to compare against. */
  readonly baseUnchecked: boolean
}

/**
 * Each result with only the findings its capture in `base` (same key) does not have. A base shot without `--check`
 * says nothing about findings, so those results keep all of theirs.
 */
export const findingsReportAgainstBase = ({
  results,
  base,
}: {
  readonly results: ReadonlyArray<CaptureResult>
  readonly base: SessionLabel | undefined
}): FindingsReport => {
  const baseByKey = new Map((base?.captures ?? []).map((result) => [result.key, result]))
  let inBase = 0
  let baseUnchecked = false

  const compared = results.map((result) => {
    const before = baseByKey.get(result.key)

    if (before === undefined || !Predicate.isTagged(result, 'CapturedResult') || result.checked !== true) return result

    if (!Predicate.isTagged(before, 'CapturedResult') || before.checked !== true) {
      baseUnchecked = true

      return result
    }

    const fresh = findingsNewSinceBase({ findings: result.findings, base: before.findings })
    inBase += fresh.inBase

    return { ...result, findings: fresh.findings }
  })

  return { results: compared, inBase, baseUnchecked }
}

/** Exit 1: a capture failed, or an error finding the base does not have. */
export const isFailingReport = (report: FindingsReport) =>
  report.results.some((result) => Predicate.isTagged(result, 'FailedCaptureResult') || hasErrorFinding(result.findings))

export const printCaptureResults = ({
  report,
  base,
  warnings,
}: {
  readonly report: FindingsReport
  readonly base: string
  readonly warnings: boolean
}) =>
  Effect.gen(function* () {
    const store = yield* ArtifactStore

    for (const result of report.results) {
      if (!Predicate.isTagged(result, 'CapturedResult')) continue
      const shown = yield* displayPath(result.file)

      if (result.file.endsWith('.png')) {
        yield* printLine(shown)
        continue
      }

      // Measurements and the aria tree are what to read: print them after their path.
      yield* printLine(`# ${shown}`)
      yield* printLine(readFileSync(store.absolutePath(result.file), 'utf8').trimEnd())
    }

    const lines = findingLines(report.results)
    const hidden = warnings ? [] : lines.filter((entry) => entry.severity === 'warn')

    for (const { line } of lines) if (!hidden.some((entry) => entry.line === line)) yield* printLine(line)

    const notes = [
      ...(hidden.length === 0
        ? []
        : [`${hidden.length} ${hidden.length === 1 ? 'warning' : 'warnings'} (--warnings lists them)`]),
      ...(report.inBase === 0
        ? []
        : [`${report.inBase} ${report.inBase === 1 ? 'finding' : 'findings'} also in ${base}`]),
      ...(report.baseUnchecked ? [`${base} was shot without --check: findings not compared`] : []),
    ]

    if (notes.length > 0) yield* printLine(notes.join('; '))
  })
