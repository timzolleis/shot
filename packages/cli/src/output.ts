import {
  ArtifactStore,
  type CaptureResult,
  type Finding,
  hasErrorFinding,
  partDescription,
  sourceDescription,
} from '@shot/core'
import { Console, Effect, Option } from 'effect'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** stdout holds only what to read: paths, findings, JSON, the summary. stderr holds progress. */
export const printLine = (line: string) => Console.log(line)

/** A project-relative file, relative to where the agent runs shot. */
export const displayPath = (file: string) =>
  Effect.map(ArtifactStore, (store) => path.relative(process.cwd(), store.absolutePath(file)) || file)

export const findingLine = (result: CaptureResult, finding: Finding): string => {
  const subject = Option.getOrElse(result.capture.name, () => partDescription(result.capture.part))
  const selector = finding.selector === '' ? '' : ` (${finding.selector})`

  return `${finding.severity === 'error' ? 'error' : 'warn '} ${finding.check.padEnd(8)} ${sourceDescription(result.capture.source)} › ${subject} (${result.capture.variant.mode}): ${finding.message}${selector}`
}

/** The same finding in light and dark is one line. */
export const distinctFindingLines = (results: ReadonlyArray<CaptureResult>): ReadonlyArray<string> => [
  ...new Set(results.flatMap((result) => result.findings.map((finding) => findingLine(result, finding).replace(/ \((light|dark)\):/, ':')))),
]

export const printCaptureResults = (results: ReadonlyArray<CaptureResult>) =>
  Effect.gen(function* () {
    const store = yield* ArtifactStore

    for (const result of results) {
      if (result._tag !== 'CapturedResult') continue
      const shown = yield* displayPath(result.file)

      if (result.file.endsWith('.png')) {
        yield* printLine(shown)
        continue
      }

      // Measurements and the aria tree are what to read: print them after their path.
      yield* printLine(`# ${shown}`)
      yield* printLine(readFileSync(store.absolutePath(result.file), 'utf8').trimEnd())
    }

    for (const line of distinctFindingLines(results)) yield* printLine(line)
  })

export const anyErrorFinding = (results: ReadonlyArray<CaptureResult>) =>
  results.some((result) => result._tag === 'FailedCaptureResult' || hasErrorFinding(result.findings))
