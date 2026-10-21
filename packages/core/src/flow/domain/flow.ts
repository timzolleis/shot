import { Schema } from 'effect'

/** A flow file's header: where it starts, as whom (B7). */
export const Flow = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  start: Schema.String,
  as: Schema.String,
  params: Schema.Record(Schema.String, Schema.String),
})
export type Flow = typeof Flow.Type

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
