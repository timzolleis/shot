import { Data } from 'effect'

export class VideoTooLargeError extends Data.TaggedError('VideoTooLargeError')<{
  readonly file: string
  readonly bytes: number
  readonly limitBytes: number
}> {}

export class GhTooOldError extends Data.TaggedError('GhTooOldError')<{ readonly version: string }> {}

/** `gh` is not installed or not logged in. */
export class GhMissingError extends Data.TaggedError('GhMissingError')<{ readonly reason: string }> {}

/** A gh command failed for a reason shot does not model (network, an unsupported file). */
export class GhCommandFailedError extends Data.TaggedError('GhCommandFailedError')<{
  readonly command: string
  readonly stderr: string
}> {}

export class NoPushAccessError extends Data.TaggedError('NoPushAccessError')<{
  readonly repository: string
  readonly permission: string
}> {}

export class NoPullRequestError extends Data.TaggedError('NoPullRequestError')<{ readonly branch: string }> {}

/** Nothing shot or recorded in this session. */
export class NoEvidenceError extends Data.TaggedError('NoEvidenceError')<{ readonly session: string }> {}

export class PublisherNotFoundError extends Data.TaggedError('PublisherNotFoundError')<{
  readonly publisher: string
  readonly available: ReadonlyArray<string>
}> {}
