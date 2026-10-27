import { Data } from 'effect'

/** `--size` names a size no named label was shot at (F25). */
export class SizeNotShotError extends Data.TaggedError('SizeNotShotError')<{
  readonly size: string
  readonly sizes: ReadonlyArray<string>
}> {}

/** The named labels have no still to compare. */
export class NothingToReviewError extends Data.TaggedError('NothingToReviewError')<{
  readonly labels: ReadonlyArray<string>
}> {}
