import { Effect, Predicate } from 'effect'

import type { Capture } from '../capture/domain/capture.ts'
import { PageRuntime } from '../infrastructure/page-runtime.ts'
import type { CaptureCheck } from '../plugin/capture-check.ts'

export const isStill = (capture: Capture) => Predicate.isTagged(capture.output, 'Still')

/** A check that runs in the page, on each of the part's elements (`window.__shot.check`). */
export const runtimeCaptureCheck = ({
  check,
  appliesTo = isStill,
}: {
  readonly check: string
  readonly appliesTo?: (capture: Capture) => boolean
}): CaptureCheck<PageRuntime> => ({
  check,
  appliesTo,
  runCheck: ({ roots }) => Effect.flatMap(PageRuntime, (runtime) => runtime.runRuntimeChecks({ roots, checks: [check] })),
})
