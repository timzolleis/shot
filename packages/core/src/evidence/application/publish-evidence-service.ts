import { Context, Effect, Layer, Option } from 'effect'

import { ArtifactStore } from '../../artifact/artifact-store.ts'
import type { EvidencePublisher, PublishEvidenceError, PublishedEvidence } from '../../plugin/evidence-publisher.ts'
import { ShotConfig } from '../../plugin/shot-config.ts'
import { NoEvidenceError, PublisherNotFoundError } from '../domain/evidence-error.ts'
import { evidenceReportFromSession } from '../domain/evidence-report.ts'

/** The plugins' publishers, run in the context their layers built. */
export class EvidencePublishers extends Context.Service<
  EvidencePublishers,
  { readonly publishers: ReadonlyArray<EvidencePublisher> }
>()('shot/EvidencePublishers') {}

export const EvidencePublishersLayer = Layer.effect(
  EvidencePublishers,
  Effect.gen(function* () {
    const config = yield* ShotConfig
    const context = yield* Effect.context<never>()

    return EvidencePublishers.of({
      publishers: config.plugins
        .flatMap((plugin) => plugin.publishers ?? [])
        .map((publisher) => ({
          publisher: publisher.publisher,
          publishEvidence: (input) =>
            // SAFETY: `context` was captured inside the merged plugin layers (shot-layer), which provide every publisher's R.
            publisher.publishEvidence(input).pipe(Effect.provideContext(context)) as Effect.Effect<PublishedEvidence, PublishEvidenceError>,
        })),
    })
  }),
)

export interface PublishEvidenceCommand {
  readonly publisher: Option.Option<string>
  readonly pr: Option.Option<number>
}

/** C: the session's evidence on the PR. */
export class PublishEvidenceService extends Context.Service<
  PublishEvidenceService,
  {
    publishEvidence(
      command: PublishEvidenceCommand,
    ): Effect.Effect<
      { readonly reportFile: string; readonly published: PublishedEvidence },
      NoEvidenceError | PublisherNotFoundError | PublishEvidenceError
    >
  }
>()('shot/PublishEvidenceService') {}

export const PublishEvidenceServiceLayer = Layer.effect(
  PublishEvidenceService,
  Effect.gen(function* () {
    const store = yield* ArtifactStore
    const { publishers } = yield* EvidencePublishers

    return PublishEvidenceService.of({
      publishEvidence: Effect.fn('PublishEvidenceService.publishEvidence')(function* ({ publisher: name, pr }) {
        const publisher = Option.match(name, {
          onNone: () => publishers[0],
          onSome: (wanted) => publishers.find((candidate) => candidate.publisher === wanted),
        })

        if (publisher === undefined) {
          return yield* new PublisherNotFoundError({
            publisher: Option.getOrElse(name, () => ''),
            available: publishers.map((candidate) => candidate.publisher),
          })
        }

        const session = yield* store.readSession()

        if (session.labels.every((label) => label.captures.length === 0 && label.flows.length === 0)) {
          return yield* new NoEvidenceError({ session: session.name })
        }

        const report = evidenceReportFromSession(session)
        const reportFile = yield* store.writeReport(report)
        const published = yield* publisher.publishEvidence({ report, pr: Option.getOrUndefined(pr) })

        return { reportFile, published }
      }),
    })
  }),
)
