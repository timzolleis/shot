import { Data, type Option } from 'effect'

/** The project's config lacks a hook a route source needs (D13). */
export class AppHookMissingError extends Data.TaggedError('AppHookMissingError')<{ readonly hook: string }> {}

export class AppNotRunningError extends Data.TaggedError('AppNotRunningError')<{ readonly url: string }> {}

/** A hook rejected, as a Promise or an Effect (D13). */
export class AppHookFailedError extends Data.TaggedError('AppHookFailedError')<{
  readonly hook: string
  readonly user: Option.Option<string>
  readonly message: string
}> {}

/** Another process held the login lock for a key past the timeout (D14). */
export class SessionLockTimeoutError extends Data.TaggedError('SessionLockTimeoutError')<{ readonly key: string }> {}
