import { Option } from 'effect'

import { isStill, runtimeCaptureCheck } from './runtime-check.ts'

/** Touch targets under 24×24 or 44×44, on devices. */
export const targetCheck = runtimeCaptureCheck({
  check: 'target',
  appliesTo: (capture) => isStill(capture) && Option.isSome(capture.variant.device),
})
