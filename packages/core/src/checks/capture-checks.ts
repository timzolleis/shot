import { Context, Effect, Layer } from 'effect'
import type { Locator } from 'playwright'

import type { Capture } from '../capture/domain/capture.ts'
import { collapsedFindings, type Finding } from '../capture/domain/finding.ts'
import type { ReadyPage } from '../infrastructure/page-lifecycle.ts'
import type { CaptureCheck } from '../plugin/capture-check.ts'
import { ShotConfig } from '../plugin/shot-config.ts'
import { alignCheck } from './align.ts'
import { focusCheck } from './focus.ts'
import { overflowCheck } from './overflow.ts'
import { targetCheck } from './target.ts'

/** Core checks on a part; `render` and `console` come from the page itself. */
export const coreCaptureChecks: ReadonlyArray<CaptureCheck<any>> = [overflowCheck, targetCheck, focusCheck, alignCheck]

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
            check.runCheck(input).pipe(Effect.provideContext(context)) as Effect.Effect<ReadonlyArray<Finding>>,
        ).pipe(Effect.map((findings) => collapsedFindings(findings.flat()))),
    })
  }),
)
