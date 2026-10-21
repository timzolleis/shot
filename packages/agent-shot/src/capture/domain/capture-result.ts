import { Schema } from 'effect'

import { Capture, Rect } from './capture.ts'
import { Finding } from './finding.ts'

/**
 * An element a still shows, for naming what a review note points at (F34). `selector` is one `--select` accepts; `rect`
 * is in the still's CSS pixels, from its top-left.
 */
export const PageElement = Schema.Struct({
  selector: Schema.String,
  role: Schema.String,
  name: Schema.String,
  rect: Rect,
})

export type PageElement = typeof PageElement.Type

/** A capture that produced a file; `file` is relative to the project root. */
export const CapturedResult = Schema.TaggedStruct('CapturedResult', {
  capture: Capture,
  key: Schema.String,
  file: Schema.String,
  measurements: Schema.Json,
  findings: Schema.Array(Finding),
  /** Stills only; manifests written before the element map have none. */
  elements: Schema.optionalKey(Schema.Array(PageElement)),
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
