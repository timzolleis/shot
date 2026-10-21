import { Context, Effect, Layer, Option } from 'effect'
import type { Locator } from 'playwright'

import type { Capture } from '../capture/domain/capture.ts'
import { collapsedFindings, type Finding } from '../capture/domain/finding.ts'
import type { ReadyPage } from '../infrastructure/page-lifecycle.ts'
import type { CaptureCheck, CheckFinding } from '../plugin/capture-check.ts'
import { effectFromPluginHook, type Hook } from '../plugin/hook.ts'
import { ShotConfig } from '../plugin/shot-config.ts'
import { alignCheck } from './align.ts'
import { focusCheck } from './focus.ts'
import { overflowCheck } from './overflow.ts'
import { targetCheck } from './target.ts'

/** Core checks on a part; `render` and `console` come from the page itself. */
export const coreCaptureChecks: ReadonlyArray<CaptureCheck<any>> = [overflowCheck, targetCheck, focusCheck, alignCheck]

const findingFromCheckFinding = ({ check, finding }: { readonly check: string; readonly finding: CheckFinding }) =>
  ({
    check: finding.check ?? check,
    severity: finding.severity,
    message: finding.message,
    selector: finding.selector ?? '',
    rect: Option.fromNullishOr(finding.rect),
  }) satisfies Finding

/** One check's findings; a check that throws or rejects reports one error finding instead. */
export const findingsFromCheck = <I, R>({
  check,
  input,
}: {
  readonly check: {
    readonly check: string
    readonly runCheck: (input: I) => Hook<ReadonlyArray<CheckFinding>, never, R>
  }
  readonly input: I
}): Effect.Effect<ReadonlyArray<Finding>, never, R> =>
  effectFromPluginHook(
    () => check.runCheck(input),
    (message) => message,
  ).pipe(
    Effect.catch((message) =>
      Effect.succeed<ReadonlyArray<CheckFinding>>([{ severity: 'error', message: `check failed: ${message}` }]),
    ),
    Effect.map((findings) => findings.map((finding) => findingFromCheckFinding({ check: check.check, finding }))),
  )

/** Core and plugin checks, each where it applies; repeats collapse. */
export class CaptureChecks extends Context.Service<
  CaptureChecks,
  {
    runCaptureChecks(input: {
      readonly page: ReadyPage
      readonly capture: Capture
      readonly roots: ReadonlyArray<Locator>
    }): Effect.Effect<ReadonlyArray<Finding>>
  }
>()('shot/CaptureChecks') {}

/** Needs the plugins' layers: their checks run in the context this layer is built in. */
export const CaptureChecksLayer = Layer.effect(
  CaptureChecks,
  Effect.gen(function* () {
    const config = yield* ShotConfig
    const context = yield* Effect.context<never>()
    const checks = [...coreCaptureChecks, ...config.plugins.flatMap((plugin) => plugin.checks ?? [])]

    return CaptureChecks.of({
      runCaptureChecks: (input) =>
        Effect.forEach(
          checks.filter((check) => check.appliesTo(input.capture)),
          (check) =>
            // SAFETY: `context` was captured inside the merged plugin layers (shot-layer), which provide every check's R.
            findingsFromCheck({ check, input }).pipe(Effect.provideContext(context)) as Effect.Effect<
              ReadonlyArray<Finding>
            >,
        ).pipe(Effect.map((findings) => collapsedFindings(findings.flat()))),
    })
  }),
)
