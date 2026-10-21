import { Predicate, Schema } from 'effect'
import type { Page } from 'playwright'

import { Mode } from '../../capture/domain/capture.ts'
import type { Hook } from '../../plugin/hook.ts'

export const FlowHeader = Schema.Struct({
  /** An app path, or a URL. */
  start: Schema.String,
  /** A user alias or email (D15); app paths only. */
  as: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  mode: Schema.optionalKey(Mode),
  /** `phone`, `tablet`, `laptop`, `desktop`, `WxH` or a Playwright device; default laptop; `--size` wins (E21). */
  size: Schema.optionalKey(Schema.String),
})

export type FlowHeader = typeof FlowHeader.Type

/** Runs `action`, then takes a still named after the step. A failing action stops the flow (B8). */
export type FlowStep = <A>(name: string, action: () => Hook<A>) => Promise<void>

export type FlowBody = (input: { readonly page: Page; readonly step: FlowStep }) => Hook<void>

/** The body is the project's code: only that it is a function can be checked. */
const FlowBody = Schema.declare((input): input is FlowBody => Predicate.isFunction(input))

/** A flow file's default export; decoded when the file loads. */
export const FlowDefinition = Schema.TaggedStruct('FlowDefinition', { header: FlowHeader, body: FlowBody })

export type FlowDefinition = typeof FlowDefinition.Type

/** A flow file's default export: named steps from a start route as a user (B7). */
export const defineFlow = (header: FlowHeader, body: FlowBody): FlowDefinition => FlowDefinition.make({ header, body })
