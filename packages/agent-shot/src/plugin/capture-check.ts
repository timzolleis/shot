import type { Locator } from 'playwright'

import type { Capture, Rect } from '../capture/domain/capture.ts'
import type { ReadyPage } from '../infrastructure/page-lifecycle.ts'
import type { Hook } from './hook.ts'

/** What a check reports. `check` defaults to the check's name; `rect`, in page pixels, outlines it on the still. */
export interface CheckFinding {
  readonly check?: string
  readonly severity: 'error' | 'warn'
  readonly message: string
  readonly selector?: string
  readonly rect?: Rect | undefined
}

/**
 * A check on each capture's part, before overlays draw. `roots` are the part's elements. `runCheck` returns findings,
 * a Promise of them, or an Effect; a throw or a rejection becomes an error finding.
 */
export interface CaptureCheck<R = never> {
  readonly check: string
  readonly appliesTo: (capture: Capture) => boolean
  readonly runCheck: (input: {
    readonly page: ReadyPage
    readonly capture: Capture
    readonly roots: ReadonlyArray<Locator>
  }) => Hook<ReadonlyArray<CheckFinding>, never, R>
}
