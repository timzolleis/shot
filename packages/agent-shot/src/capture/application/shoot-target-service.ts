import { Context, Effect, Layer, type Option, Result } from 'effect'

import { ArtifactStore } from '../../artifact/artifact-store.ts'
import type { OutlineEntry } from '../../infrastructure/page-runtime.ts'
import type { Source } from '../domain/capture.ts'
import type { ConflictingOutputsError } from '../domain/capture-error.ts'
import {
  isPlanInFlags,
  planCapturesFromFlags,
  planDefaultCaptures,
  type ShootFlags,
  type SizeOutline,
  sizesFromFlags,
} from '../domain/capture-plan.ts'
import type { Size } from '../domain/size.ts'
import { type CaptureResult, FailedCaptureResult } from '../domain/capture-result.ts'
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
    ): Effect.Effect<
      ReadonlyArray<CaptureResult>,
      ResolveSourceError | ConflictingOutputsError | OpenSourceError | RunPlanError
    >
    /** The source's sections, for `--section`. */
    readTargetOutline(
      command: Pick<ShootTargetCommand, 'raw' | 'as' | 'params'> & { readonly size: Size },
    ): Effect.Effect<
      { readonly source: Source; readonly outline: ReadonlyArray<OutlineEntry> },
      ResolveSourceError | OpenSourceError
    >
  }
>()('shot/ShootTargetService') {}

export const ShootTargetServiceLayer = Layer.effect(
  ShootTargetService,
  Effect.gen(function* () {
    const providers = yield* SourceProviders
    const runner = yield* CaptureRunner
    const store = yield* ArtifactStore

    const outlineOf = ({ source, size }: { readonly source: Source; readonly size: Size }) =>
      runner.readOutline({ source, variant: { mode: 'light', size, scale: 1, reducedMotion: false } })

    return ShootTargetService.of({
      shootTarget: Effect.fn('ShootTargetService.shootTarget')(function* ({
        raw,
        as,
        params,
        label,
        flags,
        runChecks,
      }) {
        const source = yield* providers.resolveSource({ raw, as, params })

        if (isPlanInFlags(flags)) {
          const plan = yield* Effect.fromResult(planCapturesFromFlags({ source, flags }))
          const results = yield* runner.runPlan({ plan, label, runChecks })
          yield* store.writeManifest({ label, results })

          return results
        }

        // Each size shoots the sections its own outline lists (E19).
        const outlines = yield* Effect.forEach(
          sizesFromFlags(flags),
          (size) =>
            outlineOf({ source, size }).pipe(
              Effect.result,
              Effect.map((outline) => ({ size, outline })),
            ),
          { concurrency: 4 },
        )

        const failed: Array<CaptureResult> = []
        const shown: Array<SizeOutline> = []

        for (const { size, outline } of outlines) {
          if (Result.isSuccess(outline)) {
            shown.push({ size, sections: outline.success.map((entry) => entry.title) })
            continue
          }

          const error = outline.failure

          if (isRunPlanError(error)) return yield* error

          // The source did not render at this size: its page capture fails with the reason, not the command (A3).
          for (const capture of planDefaultCaptures({ source, flags, outlines: [{ size, sections: [] }] })) {
            failed.push(
              FailedCaptureResult.make({
                capture,
                key: captureKey(capture),
                findings: [renderFindingFromReason(reasonFromCaptureFailure(error))],
              }),
            )
          }
        }

        const shot = yield* runner.runPlan({
          plan: planDefaultCaptures({ source, flags, outlines: shown }),
          label,
          runChecks,
        })

        const results = [...shot, ...failed]
        yield* store.writeManifest({ label, results })

        return results
      }),
      readTargetOutline: Effect.fn('ShootTargetService.readTargetOutline')(function* ({ raw, as, params, size }) {
        const source = yield* providers.resolveSource({ raw, as, params })

        return { source, outline: yield* outlineOf({ source, size }) }
      }),
    })
  }),
)
