import type { Effect } from 'effect'
import type { Locator } from 'playwright'

import type { Capture } from '../capture/domain/capture.ts'
import type { Finding } from '../capture/domain/finding.ts'
import type { ReadyPage } from '../infrastructure/page-lifecycle.ts'

/** A check on each capture's part, before overlays draw. `roots` are the part's elements. */
export interface CaptureCheck<R = never> {
  readonly check: string
  readonly appliesTo: (capture: Capture) => boolean
  readonly runCheck: (input: {
    readonly page: ReadyPage
    readonly capture: Capture
    readonly roots: ReadonlyArray<Locator>
  }) => Effect.Effect<ReadonlyArray<Finding>, never, R>
}
