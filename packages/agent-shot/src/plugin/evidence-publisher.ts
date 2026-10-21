import type { EvidenceReport } from '../evidence/domain/evidence-report.ts'
import type {
  GhCommandFailedError,
  GhMissingError,
  GhTooOldError,
  NoPullRequestError,
  NoPushAccessError,
  PublishFailedError,
} from '../evidence/domain/evidence-error.ts'
import type { Hook } from './hook.ts'

export interface PublishedEvidence {
  /** Where the evidence went: the PR's URL. */
  readonly url: string
  readonly attachments: number
}

export type PublishEvidenceError =
  | GhMissingError
  | GhTooOldError
  | GhCommandFailedError
  | NoPushAccessError
  | NoPullRequestError
  | PublishFailedError

/**
 * Puts the session's evidence somewhere. `publishEvidence` returns the result, a Promise of it, or an Effect; a throw
 * or a rejection becomes a `PublishFailedError`.
 */
export interface EvidencePublisher<R = never> {
  readonly publisher: string
  readonly publishEvidence: (input: {
    readonly report: EvidenceReport
    readonly pr: number | undefined
  }) => Hook<PublishedEvidence, PublishEvidenceError, R>
}
