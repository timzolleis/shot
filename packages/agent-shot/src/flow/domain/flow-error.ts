import { Data } from 'effect'

export class FlowNotFoundError extends Data.TaggedError('FlowNotFoundError')<{
  readonly flow: string
  readonly looked: ReadonlyArray<string>
}> {}

/** The file loads but does not export a `defineFlow(...)` default. */
export class FlowInvalidError extends Data.TaggedError('FlowInvalidError')<{
  readonly file: string
  readonly reason: string
}> {}
