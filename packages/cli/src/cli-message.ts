import {
  type AmbiguousSectionError,
  type AppHookFailedError,
  type AppHookMissingError,
  type AppNotRunningError,
  type ConflictingOutputsError,
  type FlowInvalidError,
  type FlowNotFoundError,
  type GhMissingError,
  type GhTooOldError,
  type LoupeTooLargeError,
  type NoEvidenceError,
  type NoPullRequestError,
  type NoPushAccessError,
  type PublisherNotFoundError,
  reasonFromCaptureFailure,
  type SectionNotFoundError,
  type SelectionNotFoundError,
  type SessionLockTimeoutError,
  type ShotConfigInvalidError,
  type SourceNotFoundError,
  sourceDescription,
  type SourceRedirectedError,
  type SourceRenderFailedError,
  type SourceTimedOutError,
  type StepFailedError,
  type UnknownDeviceError,
  type UserMissingError,
  type VideoTooLargeError,
} from '@shot/core'
import { Match, Option } from 'effect'

/** Every domain error a command can end with. */
export type ShotError =
  | SourceNotFoundError
  | UserMissingError
  | SourceRenderFailedError
  | SourceTimedOutError
  | SourceRedirectedError
  | SectionNotFoundError
  | AmbiguousSectionError
  | SelectionNotFoundError
  | StepFailedError
  | ConflictingOutputsError
  | UnknownDeviceError
  | LoupeTooLargeError
  | AppHookMissingError
  | AppNotRunningError
  | AppHookFailedError
  | SessionLockTimeoutError
  | FlowNotFoundError
  | FlowInvalidError
  | VideoTooLargeError
  | GhMissingError
  | GhTooOldError
  | NoPushAccessError
  | NoPullRequestError
  | NoEvidenceError
  | PublisherNotFoundError
  | ShotConfigInvalidError

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/** One line per domain error, for stderr (exhaustive: a new error tag does not compile until it has a line). */
export const cliMessageFromShotError = (error: ShotError): string =>
  Match.valueTags(error, {
    SourceNotFoundError: ({ raw, reason }) => `no source matches ${raw}; ${reason}`,
    UserMissingError: ({ path }) => `${path} needs a user: --as <user>, or set a default with shot login --as <user>`,
    SourceRenderFailedError: (failure) => `${sourceDescription(failure.source)}: ${reasonFromCaptureFailure(failure)}`,
    SourceTimedOutError: (failure) => `${sourceDescription(failure.source)}: ${reasonFromCaptureFailure(failure)}`,
    SourceRedirectedError: (failure) => `${sourceDescription(failure.source)}: ${reasonFromCaptureFailure(failure)}`,
    SectionNotFoundError: reasonFromCaptureFailure,
    AmbiguousSectionError: reasonFromCaptureFailure,
    SelectionNotFoundError: reasonFromCaptureFailure,
    StepFailedError: reasonFromCaptureFailure,
    UnknownDeviceError: reasonFromCaptureFailure,
    LoupeTooLargeError: reasonFromCaptureFailure,
    ConflictingOutputsError: ({ outputs }) => `${outputs.join(', ')} are separate outputs: pick one per run`,
    AppHookMissingError: ({ hook }) => `no ${hook} in shot.config.ts; app paths need app.url and app.logIn`,
    AppNotRunningError: ({ url }) => `app not running at ${url}; start it, then retry`,
    AppHookFailedError: ({ hook, user, message }) =>
      `${hook} hook failed${Option.match(user, { onNone: () => '', onSome: (email) => ` for ${email}` })}: ${message}`,
    SessionLockTimeoutError: ({ key }) =>
      `another shot held the login lock for ${key} over 90s; remove .shots/auth/${key}.json.lock if none runs`,
    FlowNotFoundError: ({ flow, looked }) => `no flow ${flow}; looked at ${looked.join(', ')}`,
    FlowInvalidError: ({ file, reason }) => `flow ${file}: ${reason}`,
    VideoTooLargeError: ({ file, bytes, limitBytes }) =>
      `video ${file} is ${megabytes(bytes)} MB, over the ${megabytes(limitBytes)} MB limit at every resolution; shorten the flow`,
    GhMissingError: ({ reason }) => `gh: ${reason}`,
    GhTooOldError: ({ version }) => `gh ${version} cannot attach files; update to 2.99 or later`,
    NoPushAccessError: ({ repository, permission }) =>
      `no push access to ${repository} (${permission === '' ? 'none' : permission.toLowerCase()}); attaching files needs it`,
    NoPullRequestError: ({ branch }) => `no pull request for ${branch}; create it first`,
    NoEvidenceError: ({ session }) => `nothing to publish in session ${session}; shoot or record a flow first`,
    PublisherNotFoundError: ({ publisher, available }) =>
      available.length === 0
        ? 'no publisher configured; add github() from @shot/github to plugins in shot.config.ts'
        : `no publisher "${publisher}"; configured: ${available.join(', ')}`,
    ShotConfigInvalidError: ({ file, reason }) => `${file} failed to load: ${reason}`,
  })
