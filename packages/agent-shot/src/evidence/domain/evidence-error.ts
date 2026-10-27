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

/** The named labels have no still to publish. */
export class NoEvidenceError extends Data.TaggedError('NoEvidenceError')<{ readonly labels: ReadonlyArray<string> }> {}

/** A label the agent named is not in the session (C11, F23). */
export class LabelNotFoundError extends Data.TaggedError('LabelNotFoundError')<{
  readonly label: string
  readonly labels: ReadonlyArray<string>
}> {}

/** `--sheet` or `--note` matches no sheet the named labels have (C11, F25). */
export class SheetNotFoundError extends Data.TaggedError('SheetNotFoundError')<{
  readonly sheet: string
  readonly titles: ReadonlyArray<string>
}> {}

export class PublisherNotFoundError extends Data.TaggedError('PublisherNotFoundError')<{
  readonly publisher: string
  readonly available: ReadonlyArray<string>
}> {}

/** A plugin publisher threw or rejected. */
export class PublishFailedError extends Data.TaggedError('PublishFailedError')<{
  readonly publisher: string
  readonly message: string
}> {}
