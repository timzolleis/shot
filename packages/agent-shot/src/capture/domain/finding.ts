import { Option, Schema } from 'effect'

import { Rect } from './capture.ts'

/** `check` is open: plugins add checks (`a11y`). Core checks: render, console, overflow, target, focus, align. */
export const Finding = Schema.Struct({
  check: Schema.String,
  severity: Schema.Literals(['error', 'warn']),
  message: Schema.String,
  selector: Schema.String,
  rect: Schema.Option(Rect),
})

export type Finding = typeof Finding.Type

/** A source that did not render, or a scene or part that failed: the capture has no file (A3). */
export const renderFindingFromReason = (reason: string): Finding => ({
  check: 'render',
  severity: 'error',
  message: reason,
  selector: '',
  rect: Option.none(),
})

/** Console and page errors and blocked writes, one finding each (A4). */
export const consoleFindingsFromErrors = (errors: ReadonlyArray<string>): ReadonlyArray<Finding> =>
  errors.map((error) => ({
    check: 'console',
    severity: 'warn',
    message: (error.split('\n')[0] ?? '').slice(0, 200),
    selector: '',
    rect: Option.none(),
  }))

/** One finding per check, severity and message; repeats become a count. */
export const collapsedFindings = (findings: ReadonlyArray<Finding>): ReadonlyArray<Finding> => {
  const groups = new Map<string, Array<Finding>>()

  for (const finding of findings) {
    const id = `${finding.check}|${finding.severity}|${finding.message}`
    groups.set(id, [...(groups.get(id) ?? []), finding])
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!

    return group.length === 1 ? first : { ...first, message: `${first.message} (×${group.length})` }
  })
}

export const hasErrorFinding = (findings: ReadonlyArray<Finding>): boolean =>
  findings.some((finding) => finding.severity === 'error')
