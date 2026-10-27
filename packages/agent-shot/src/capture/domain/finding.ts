import { Option, Result, Schema } from 'effect'

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

/** Checks shot has without plugins; `render` is not one: a capture that did not render always fails. */
export const coreCheckNames = ['console', 'overflow', 'target', 'focus', 'align'] as const

export type CoreCheckName = (typeof coreCheckNames)[number]

/** `off` drops a check's findings (and skips running it); `warn` and `error` set the severity of every one. */
export const checkLevels = ['off', 'warn', 'error'] as const

export type CheckLevel = (typeof checkLevels)[number]

/** `checks` in `shot.config.ts`: `'off'` for every check, else a level per check name; unnamed checks keep theirs. */
export type ChecksSetting<Name extends string = string> = 'off' | { readonly [N in Name]?: CheckLevel }

export const levelOfCheck = ({
  check,
  checks,
}: {
  readonly check: string
  readonly checks: ChecksSetting
}): CheckLevel | undefined => (checks === 'off' ? 'off' : checks[check])

/** Findings at the project's levels (`checks`); render findings stay as they are. */
export const findingsAtLevels = ({
  findings,
  checks,
}: {
  readonly findings: ReadonlyArray<Finding>
  readonly checks: ChecksSetting
}): ReadonlyArray<Finding> =>
  findings.flatMap((finding) => {
    if (finding.check === 'render') return [finding]

    const level = levelOfCheck({ check: finding.check, checks })

    if (level === 'off') return []

    return [level === undefined ? finding : { ...finding, severity: level }]
  })

const decodeChecksSetting = Schema.decodeUnknownOption(
  Schema.Union([Schema.Literal('off'), Schema.Record(Schema.String, Schema.Literals(checkLevels))]),
)

/**
 * `checks` from the config file, which `defineConfig` types but a `.js` config or a widened plugin does not: a level
 * that is not one, or a check no core or plugin check has, is a problem instead of a silent no-op.
 */
export const checksSettingFromConfig = ({
  checks,
  known,
}: {
  readonly checks: unknown
  readonly known: ReadonlyArray<string>
}): Result.Result<ChecksSetting, string> => {
  if (checks === undefined) return Result.succeed({})

  const decoded = decodeChecksSetting(checks)

  if (Option.isNone(decoded)) {
    return Result.fail(`checks must be 'off' or { <check>: 'off' | 'warn' | 'error' }`)
  }

  const setting = decoded.value

  if (setting === 'off') return Result.succeed(setting)

  const unknown = Object.keys(setting).find((check) => !known.includes(check))

  return unknown === undefined
    ? Result.succeed(setting)
    : Result.fail(`unknown check "${unknown}" in checks; checks: ${known.join(', ')}`)
}

export const hasErrorFinding = (findings: ReadonlyArray<Finding>): boolean =>
  findings.some((finding) => finding.severity === 'error')
