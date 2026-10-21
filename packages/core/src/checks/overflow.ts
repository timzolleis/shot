import { runtimeCaptureCheck } from './runtime-check.ts'

/** Text that overflows its box, or is clipped without an ellipsis. */
export const overflowCheck = runtimeCaptureCheck({ check: 'overflow' })
