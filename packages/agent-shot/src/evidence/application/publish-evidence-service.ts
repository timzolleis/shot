import { Context, Effect, Layer, Option } from 'effect'

import { ArtifactStore } from '../../artifact/artifact-store.ts'
import type { EvidencePublisher, PublishEvidenceError, PublishedEvidence } from '../../plugin/evidence-publisher.ts'
import { effectFromPluginHook } from '../../plugin/hook.ts'
import { ShotConfig } from '../../plugin/shot-config.ts'
import {
  type LabelNotFoundError,
  type NoEvidenceError,
  PublisherNotFoundError,
  PublishFailedError,
  type SheetNotFoundError,
} from '../domain/evidence-error.ts'
import { evidenceReportFromSession, type PublishRequest } from '../domain/evidence-report.ts'

/** The plugins' publishers, run in the context their layers built. */
export class EvidencePublishers extends Context.Service<
  EvidencePublishers,
  {
    readonly publishers: ReadonlyArray<{
      readonly publisher: string
      publishEvidence(
        input: Parameters<EvidencePublisher['publishEvidence']>[0],
      ): Effect.Effect<PublishedEvidence, PublishEvidenceError>
    }>
  }
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
            effectFromPluginHook(
              () => publisher.publishEvidence(input),
              (message) => new PublishFailedError({ publisher: publisher.publisher, message }),
            ).pipe(Effect.provideContext(context)) as Effect.Effect<PublishedEvidence, PublishEvidenceError>,
        })),
    })
  }),
)

export interface PublishEvidenceCommand {
  readonly request: PublishRequest
  readonly publisher: Option.Option<string>
  readonly pr: Option.Option<number>
}

/** C: the sheets the agent picked, on the PR. */
export class PublishEvidenceService extends Context.Service<
  PublishEvidenceService,
  {
    publishEvidence(
      command: PublishEvidenceCommand,
    ): Effect.Effect<
      { readonly sheets: number; readonly published: PublishedEvidence },
      LabelNotFoundError | SheetNotFoundError | NoEvidenceError | PublisherNotFoundError | PublishEvidenceError
    >
  }
>()('shot/PublishEvidenceService') {}

export const PublishEvidenceServiceLayer = Layer.effect(
  PublishEvidenceService,
  Effect.gen(function* () {
    const store = yield* ArtifactStore
    const { publishers } = yield* EvidencePublishers

    return PublishEvidenceService.of({
      publishEvidence: Effect.fn('PublishEvidenceService.publishEvidence')(function* ({
        request,
        publisher: name,
        pr,
      }) {
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
        const report = yield* Effect.fromResult(evidenceReportFromSession({ session, request }))
        yield* store.writeReport(report)
        const published = yield* publisher.publishEvidence({ report, pr: Option.getOrUndefined(pr) })

        return { sheets: report.sheets.length, published }
      }),
    })
  }),
)
