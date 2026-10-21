import { Effect, FileSystem, Layer, Option, Schema } from 'effect'
import path from 'node:path'

import { ArtifactStore } from '../artifact/artifact-store.ts'
import { ReviewStore } from '../review/application/review-service.ts'
import { emptyReviewDraft, ReviewDraft } from '../review/domain/review.ts'

const ReviewDraftJson = Schema.fromJsonString(ReviewDraft)
const decodeReviewDraft = Schema.decodeUnknownOption(ReviewDraftJson)
const encodeReviewDraft = Schema.encodeSync(ReviewDraftJson)

/** `.shots/<session>/review/`: `draft.json`, and `round-<n>/` per submitted round (F31, F32). */
export const FileReviewStoreLayer = Layer.effect(
  ReviewStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const artifacts = yield* ArtifactStore
    const reviewDir = path.join(artifacts.sessionDir, 'review')
    const draftFile = artifacts.absolutePath(path.join(reviewDir, 'draft.json'))

    const roundFile = ({ round, name }: { readonly round: number; readonly name: string }) =>
      path.join(reviewDir, `round-${round}`, name)

    const write = (file: string, content: Uint8Array | string) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true })
        const temporary = `${file}.${process.pid}.tmp`
        yield* content instanceof Uint8Array ? fs.writeFile(temporary, content) : fs.writeFileString(temporary, content)
        yield* fs.rename(temporary, file)
      }).pipe(Effect.orDie)

    const readDraftFile = (file: string) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(file))) return Option.none<ReviewDraft>()

        return decodeReviewDraft(yield* fs.readFileString(file))
      }).pipe(Effect.orDie)

    return ReviewStore.of({
      readDraft: () => readDraftFile(draftFile),
      writeDraft: (draft) => write(draftFile, encodeReviewDraft(draft)),
      removeDraft: () => fs.remove(draftFile, { force: true }).pipe(Effect.orDie),
      readLastRound: () =>
        Effect.gen(function* () {
          const root = artifacts.absolutePath(reviewDir)
          const entries = (yield* fs.exists(root)) ? yield* fs.readDirectory(root) : []

          const rounds = entries.flatMap((entry) => {
            const match = /^round-(\d+)$/.exec(entry)

            return match === null ? [] : [Number(match[1])]
          })

          if (rounds.length === 0) return Option.none()
          const round = Math.max(...rounds)
          const draft = yield* readDraftFile(artifacts.absolutePath(roundFile({ round, name: 'draft.json' })))

          return Option.some({ round, draft: Option.getOrElse(draft, () => emptyReviewDraft) })
        }).pipe(Effect.orDie),
      roundFile,
      writeRoundFile: ({ round, name, content }) =>
        Effect.gen(function* () {
          const file = roundFile({ round, name })
          yield* write(artifacts.absolutePath(file), content)

          return file
        }),
      readStill: (file) => fs.readFile(artifacts.absolutePath(file)).pipe(Effect.orDie),
    })
  }),
)
