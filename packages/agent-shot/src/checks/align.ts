import { runtimeCaptureCheck } from './runtime-check.ts'

/** Neighbouring edges and baselines 1–3px apart. */
export const alignCheck = runtimeCaptureCheck({ check: 'align' })
