import type { Page } from 'playwright'

import type { Mode } from '../../capture/domain/capture.ts'
import type { Hook } from '../../plugin/hook.ts'

export interface FlowHeader {
  /** An app path, or a URL. */
  readonly start: string
  /** A user alias or email (D15); app paths only. */
  readonly as?: string
  readonly params?: Readonly<Record<string, string>>
  readonly mode?: Mode
  readonly device?: string
  readonly width?: number
  readonly height?: number
}

/** Runs `action`, then takes a still named after the step. A failing action stops the flow (B8). */
export type FlowStep = (name: string, action: () => Hook<unknown>) => Promise<void>

export type FlowBody = (input: { readonly page: Page; readonly step: FlowStep }) => Hook<void>

export interface FlowDefinition {
  readonly _tag: 'FlowDefinition'
  readonly header: FlowHeader
  readonly body: FlowBody
}

/** A flow file's default export: named steps from a start route as a user (B7). */
export const defineFlow = (header: FlowHeader, body: FlowBody): FlowDefinition => ({ _tag: 'FlowDefinition', header, body })
