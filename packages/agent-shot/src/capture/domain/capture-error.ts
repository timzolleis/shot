import { Data } from 'effect'

import type { Source } from './capture.ts'

export class SourceNotFoundError extends Data.TaggedError('SourceNotFoundError')<{
  readonly raw: string
  readonly reason: string
}> {}

/** A route needs a user: `--as`, or the host's default from `shot login`. */
export class UserMissingError extends Data.TaggedError('UserMissingError')<{ readonly path: string }> {}

export class SourceRenderFailedError extends Data.TaggedError('SourceRenderFailedError')<{
  readonly source: Source
  readonly reason: string
}> {}

/** What did not finish: the app's `waitUntilReady` hook, or the page load and the network quiet after it. */
export type ReadyWait = 'waitUntilReady' | 'load'

export class SourceTimedOutError extends Data.TaggedError('SourceTimedOutError')<{
  readonly source: Source
  readonly waitedMs: number
  readonly waitedFor: ReadyWait
  readonly consoleErrors: ReadonlyArray<string>
}> {}

/** Landed elsewhere; for the login page only after one fresh login (A5). */
export class SourceRedirectedError extends Data.TaggedError('SourceRedirectedError')<{
  readonly source: Source
  readonly landedOn: string
}> {}

export class SectionNotFoundError extends Data.TaggedError('SectionNotFoundError')<{
  readonly title: string
  readonly outline: string
}> {}

export class AmbiguousSectionError extends Data.TaggedError('AmbiguousSectionError')<{
  readonly title: string
  readonly matches: ReadonlyArray<string>
}> {}

/** `--select` matched nothing, or nothing visible. */
export class SelectionNotFoundError extends Data.TaggedError('SelectionNotFoundError')<{
  readonly selector: string
  readonly reason: string
}> {}

export class StepFailedError extends Data.TaggedError('StepFailedError')<{
  readonly step: string
  readonly reason: string
}> {}

export class ConflictingOutputsError extends Data.TaggedError('ConflictingOutputsError')<{
  readonly outputs: ReadonlyArray<string>
}> {}

/** Not an alias, `WxH` or a Playwright device (E16). */
export class UnknownSizeError extends Data.TaggedError('UnknownSizeError')<{
  readonly text: string
  readonly closest: ReadonlyArray<string>
}> {}

/** A loupe beyond 2400px: pick a smaller part or factor. */
export class LoupeTooLargeError extends Data.TaggedError('LoupeTooLargeError')<{
  readonly factor: number
  readonly width: number
  readonly height: number
}> {}

/** The errors that end one capture; the runner turns each into a render finding (A3). */
export type CaptureFailure =
  | SourceRenderFailedError
  | SourceTimedOutError
  | SourceRedirectedError
  | SectionNotFoundError
  | AmbiguousSectionError
  | SelectionNotFoundError
  | StepFailedError
  | LoupeTooLargeError
