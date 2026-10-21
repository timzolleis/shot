import { Predicate } from 'effect'

import { isStill, runtimeCaptureCheck } from './runtime-check.ts'

/** Touch targets under 24×24 or 44×44, on devices; a `WxH` size is a desktop browser without touch. */
export const targetCheck = runtimeCaptureCheck({
  check: 'target',
  appliesTo: (capture) => isStill(capture) && Predicate.isTagged(capture.variant.size, 'DeviceSize'),
})
