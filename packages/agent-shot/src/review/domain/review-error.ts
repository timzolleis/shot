import { Data } from 'effect'

/** A label the agent named is not in the session (F23). */
export class LabelNotFoundError extends Data.TaggedError('LabelNotFoundError')<{
  readonly label: string
  readonly labels: ReadonlyArray<string>
}> {}

/** `--sheet` matches no sheet the named labels have (F25). */
export class SheetNotFoundError extends Data.TaggedError('SheetNotFoundError')<{
  readonly sheet: string
  readonly titles: ReadonlyArray<string>
}> {}

/** `--size` names a size no named label was shot at (F25). */
export class SizeNotShotError extends Data.TaggedError('SizeNotShotError')<{
  readonly size: string
  readonly sizes: ReadonlyArray<string>
}> {}

/** The named labels have no still to compare. */
export class NothingToReviewError extends Data.TaggedError('NothingToReviewError')<{
  readonly labels: ReadonlyArray<string>
}> {}
