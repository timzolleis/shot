import type { Effect } from 'effect'

import type { EvidenceReport } from '../evidence/domain/evidence-report.ts'
import type {
  GhMissingError,
  GhTooOldError,
  NoPullRequestError,
  NoPushAccessError,
} from '../evidence/domain/evidence-error.ts'

export interface PublishedEvidence {
  /** Where the evidence went: the PR's URL. */
  readonly url: string
  readonly attachments: number
}

export type PublishEvidenceError = GhMissingError | GhTooOldError | NoPushAccessError | NoPullRequestError

export interface EvidencePublisher<R = never> {
  readonly publisher: string
  readonly publishEvidence: (input: {
    readonly report: EvidenceReport
    readonly pr: number | undefined
  }) => Effect.Effect<PublishedEvidence, PublishEvidenceError, R>
}
