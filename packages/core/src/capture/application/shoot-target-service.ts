import { Context, Effect, Layer, type Option } from 'effect'

import { ArtifactStore } from '../../artifact/artifact-store.ts'
import type { OutlineEntry } from '../../infrastructure/page-runtime.ts'
import type { Source } from '../domain/capture.ts'
import type { ConflictingOutputsError } from '../domain/capture-error.ts'
import {
  isPlanInFlags,
  planCapturesFromFlags,
  planDefaultCaptures,
  type ShootFlags,
  variantsFromFlags,
} from '../domain/capture-plan.ts'
import type { CaptureResult } from '../domain/capture-result.ts'
import { reasonFromCaptureFailure } from '../domain/capture-failure-reason.ts'
import { captureKey } from '../domain/capture-key.ts'
import { renderFindingFromReason } from '../domain/finding.ts'
import { CaptureRunner, isRunPlanError, type RunPlanError } from './capture-runner.ts'
import { type OpenSourceError, type ResolveSourceError, SourceProviders } from './source-providers.ts'

export interface ShootTargetCommand {
  readonly raw: string
  readonly as: Option.Option<string>
  readonly params: Readonly<Record<string, string>>
  readonly label: string
  readonly flags: ShootFlags
  readonly runChecks: boolean
}

/** A: one target, from raw input to files and findings. */
export class ShootTargetService extends Context.Service<
  ShootTargetService,
  {
    shootTarget(
      command: ShootTargetCommand,
    ): Effect.Effect<ReadonlyArray<CaptureResult>, ResolveSourceError | ConflictingOutputsError | OpenSourceError | RunPlanError>
    /** The source's sections, for `--section`. */
    readTargetOutline(
      command: Pick<ShootTargetCommand, 'raw' | 'as' | 'params' | 'flags'>,
    ): Effect.Effect<{ readonly source: Source; readonly outline: ReadonlyArray<OutlineEntry> }, ResolveSourceError | OpenSourceError>
  }
>()('shot/ShootTargetService') {}

export const ShootTargetServiceLayer = Layer.effect(
  ShootTargetService,
  Effect.gen(function* () {
    const providers = yield* SourceProviders
    const runner = yield* CaptureRunner
    const store = yield* ArtifactStore

    const outlineOf = (source: Source, flags: ShootFlags) =>
      runner.readOutline({ source, variant: { ...variantsFromFlags(flags)[0]!, mode: 'light' } })

    return ShootTargetService.of({
      shootTarget: Effect.fn('ShootTargetService.shootTarget')(function* ({ raw, as, params, label, flags, runChecks }) {
        const source = yield* providers.resolveSource({ raw, as, params })
        if (isPlanInFlags(flags)) {
          const plan = yield* Effect.fromResult(planCapturesFromFlags({ source, flags }))
          const results = yield* runner.runPlan({ plan, label, runChecks })
          yield* store.writeManifest({ label, results })
          return results
        }
        const outline = yield* outlineOf(source, flags).pipe(Effect.result)
        if (outline._tag === 'Failure') {
          const error = outline.failure
          if (isRunPlanError(error)) return yield* error
          // The source did not render: the page capture fails with the reason, not the command (A3).
          const results = planDefaultCaptures({ source, flags, sections: [] }).map(
            (capture): CaptureResult => ({
              _tag: 'FailedCaptureResult',
              capture,
              key: captureKey(capture),
              findings: [renderFindingFromReason(reasonFromCaptureFailure(error))],
            }),
          )
          yield* store.writeManifest({ label, results })
          return results
        }
        const plan = planDefaultCaptures({ source, flags, sections: outline.success.map((entry) => entry.title) })
        const results = yield* runner.runPlan({ plan, label, runChecks })
        yield* store.writeManifest({ label, results })
        return results
      }),
      readTargetOutline: Effect.fn('ShootTargetService.readTargetOutline')(function* ({ raw, as, params, flags }) {
        const source = yield* providers.resolveSource({ raw, as, params })
        return { source, outline: yield* outlineOf(source, flags) }
      }),
    })
  }),
)
