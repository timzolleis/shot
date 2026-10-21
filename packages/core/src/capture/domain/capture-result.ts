import { Schema } from 'effect'

import { Capture } from './capture.ts'
import { Finding } from './finding.ts'

/** A capture that produced a file; `file` is relative to the project root. */
export const CapturedResult = Schema.TaggedStruct('CapturedResult', {
  capture: Capture,
  key: Schema.String,
  file: Schema.String,
  measurements: Schema.Json,
  findings: Schema.Array(Finding),
})
export type CapturedResult = typeof CapturedResult.Type

/** A capture whose source, scene or part failed: findings say why; there is no file to show (A3). */
export const FailedCaptureResult = Schema.TaggedStruct('FailedCaptureResult', {
  capture: Capture,
  key: Schema.String,
  findings: Schema.Array(Finding),
})
export type FailedCaptureResult = typeof FailedCaptureResult.Type

export const CaptureResult = Schema.Union([CapturedResult, FailedCaptureResult])
export type CaptureResult = typeof CaptureResult.Type
