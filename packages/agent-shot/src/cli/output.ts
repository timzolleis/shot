import {
  ArtifactStore,
  type CaptureResult,
  hasErrorFinding,
  partDescription,
  sizeDescription,
  sourceDescription,
} from '../index.ts'
import { Console, Effect, Option, Predicate } from 'effect'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** stdout holds only what to read: paths, findings, JSON, the summary. stderr holds progress. */
export const printLine = (line: string) => Console.log(line)

/** A project-relative file, relative to where the agent runs shot. */
export const displayPath = (file: string) =>
  Effect.map(ArtifactStore, (store) => path.relative(process.cwd(), store.absolutePath(file)) || file)

/**
 * One line per finding: `warn target People (iPhone 15): touch target 67×40, under 44×44 (#invite)`. The source only
 * when the run shot several, the size only when it shot several; the same finding in light and dark is one line.
 */
export const findingLines = (results: ReadonlyArray<CaptureResult>): ReadonlyArray<string> => {
  const sources = new Set(results.map((result) => sourceDescription(result.capture.source)))
  const sizes = new Set(results.map((result) => sizeDescription(result.capture.variant.size)))

  return [
    ...new Set(
      results.flatMap(({ capture, findings }) =>
        findings.map((finding) => {
          const where = [
            ...(sources.size > 1 ? [`${sourceDescription(capture.source)} ›`] : []),
            Option.getOrElse(capture.name, () => partDescription(capture.part)),
            ...(sizes.size > 1 ? [`(${sizeDescription(capture.variant.size)})`] : []),
          ].join(' ')

          const selector = finding.selector === '' ? '' : ` (${finding.selector})`

          return `${finding.severity} ${finding.check} ${where}: ${finding.message}${selector}`
        }),
      ),
    ),
  ]
}

export const printCaptureResults = (results: ReadonlyArray<CaptureResult>) =>
  Effect.gen(function* () {
    const store = yield* ArtifactStore

    for (const result of results) {
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

    for (const line of findingLines(results)) yield* printLine(line)
  })

export const anyErrorFinding = (results: ReadonlyArray<CaptureResult>) =>
  results.some((result) => Predicate.isTagged(result, 'FailedCaptureResult') || hasErrorFinding(result.findings))
