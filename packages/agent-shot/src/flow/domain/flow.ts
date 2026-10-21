import { Schema } from 'effect'

import { sizeSlug } from '../../capture/domain/capture-key.ts'
import { Size } from '../../capture/domain/size.ts'

/** A flow file's header: where it starts, as whom (B7), at which size (E21). */
export const Flow = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  start: Schema.String,
  as: Schema.String,
  params: Schema.Record(Schema.String, Schema.String),
  size: Size,
})

export type Flow = typeof Flow.Type

/** A flow's directory and manifest name: `invite-parent--iphone-15`; each size its own (E21). */
export const flowKey = (flow: Flow): string => `${flow.name}--${sizeSlug(flow.size)}`

/** One still per passed step; `file` is relative to the project root. */
export const FlowStill = Schema.Struct({ step: Schema.String, file: Schema.String })

export type FlowStill = typeof FlowStill.Type

export const CompletedFlow = Schema.TaggedStruct('CompletedFlow', {
  flow: Flow,
  stills: Schema.Array(FlowStill),
  video: Schema.String,
  trace: Schema.String,
})

export type CompletedFlow = typeof CompletedFlow.Type

/** A failing step stops the flow: the stills up to it, the video so far, the step's error (B8). */
export const StoppedFlow = Schema.TaggedStruct('StoppedFlow', {
  flow: Flow,
  stills: Schema.Array(FlowStill),
  video: Schema.String,
  trace: Schema.String,
  failedStep: Schema.String,
  reason: Schema.String,
})

export type StoppedFlow = typeof StoppedFlow.Type

export const FlowResult = Schema.Union([CompletedFlow, StoppedFlow])

export type FlowResult = typeof FlowResult.Type
