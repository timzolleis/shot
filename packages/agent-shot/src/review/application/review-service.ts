import { Context, Effect, Layer, Match, Option, Predicate } from 'effect'

import { ArtifactStore } from '../../artifact/artifact-store.ts'
import type { PageElement } from '../../capture/domain/capture-result.ts'
import type { ShotCell } from '../../evidence/domain/evidence-report.ts'
import { Sheets } from '../../infrastructure/sheets.ts'
import {
  burnedImageName,
  decisionFromDraft,
  feedbackMarkdown,
  type ReviewCellKey,
  type ReviewFeedback,
  reviewFeedbackFromDraft,
} from '../domain/review-feedback.ts'
import {
  draftForSheets,
  type ReviewRequest,
  type ReviewSheets,
  reviewSheetsFromSession,
  type ReviewSheetsError,
} from '../domain/review-sheets.ts'
import {
  emptyReviewDraft,
  type Note,
  type ReviewDecision,
  type ReviewDraft,
  type ReviewEnd,
  type ReviewPage,
} from '../domain/review.ts'
import { numberedNotes, marksSvg } from '../marks.ts'

/** Where rounds and the draft live: `.shots/<session>/review/` (F31, F32). Paths are relative to the project root. */
export class ReviewStore extends Context.Service<
  ReviewStore,
  {
    readDraft(): Effect.Effect<Option.Option<ReviewDraft>>
    writeDraft(draft: ReviewDraft): Effect.Effect<void>
    removeDraft(): Effect.Effect<void>
    /** The highest round written, with the draft it was submitted from. */
    readLastRound(): Effect.Effect<Option.Option<{ readonly round: number; readonly draft: ReviewDraft }>>
    roundFile(input: { readonly round: number; readonly name: string }): string
    writeRoundFile(input: {
      readonly round: number
      readonly name: string
      readonly content: Uint8Array | string
    }): Effect.Effect<string>
    readStill(file: string): Effect.Effect<Uint8Array>
  }
>()('shot/ReviewStore') {}

/** The local review page: serves it, saves drafts, ends on submit or close (F22, F33). */
export class ReviewServer extends Context.Service<
  ReviewServer,
  {
    serveReview(input: {
      readonly page: ReviewPage
      /** The stills the page may load; nothing else is served. */
      readonly files: ReadonlyArray<string>
      readonly saveDraft: (draft: ReviewDraft) => Effect.Effect<void>
      readonly open: boolean
      readonly onListening: (url: string) => Effect.Effect<void>
    }): Effect.Effect<ReviewEnd>
  }
>()('shot/ReviewServer') {}

export interface ReviewLabelsCommand {
  readonly request: ReviewRequest
  /** Open the browser; else only print the URL. */
  readonly open: boolean
  readonly onListening: (url: string) => Effect.Effect<void>
}

export interface ReviewedRound {
  readonly feedback: ReviewFeedback
  readonly markdown: string
  readonly markdownFile: string
  readonly jsonFile: string
}

export interface ReviewOutcome {
  readonly decision: ReviewDecision
  /** None when dismissed: nothing is written (F33). */
  readonly round: Option.Option<ReviewedRound>
}

/** F: the labels the agent named, compared and annotated by the user; the round written for the agent. */
export class ReviewService extends Context.Service<
  ReviewService,
  {
    reviewLabels(command: ReviewLabelsCommand): Effect.Effect<ReviewOutcome, ReviewSheetsError>
  }
>()('shot/ReviewService') {}

const cellOf = ({ review, cell }: { readonly review: ReviewSheets; readonly cell: ReviewCellKey }) =>
  Option.fromNullishOr(
    review.sheets
      .find((sheet) => sheet.key === cell.sheet)
      ?.sizes.find((sized) => sized.size === cell.size)
      ?.cells.find((entry) => entry.label === cell.label)?.cell,
  ).pipe(Option.filter((found): found is typeof ShotCell.Type => Predicate.isTagged(found, 'ShotCell')))

const cellKeyText = ({ sheet, label, size }: ReviewCellKey) => JSON.stringify([sheet, label, size])

const stillFiles = (review: ReviewSheets) =>
  review.sheets.flatMap((sheet) =>
    sheet.sizes.flatMap((sized) =>
      sized.cells.flatMap(({ cell }) => (Predicate.isTagged(cell, 'ShotCell') ? [cell.file] : [])),
    ),
  )

const dismissed: ReviewOutcome = { decision: 'dismissed', round: Option.none() }

export const ReviewServiceLayer = Layer.effect(
  ReviewService,
  Effect.gen(function* () {
    const artifacts = yield* ArtifactStore
    const store = yield* ReviewStore
    const server = yield* ReviewServer
    const sheets = yield* Sheets

    /** Each annotated cell's still with its numbered marks burned in (F32). */
    const burnCells = ({
      review,
      round,
      draft,
    }: {
      readonly review: ReviewSheets
      readonly round: number
      readonly draft: ReviewDraft
    }) =>
      Effect.gen(function* () {
        const numbered = numberedNotes({ notes: draft.notes, sheets: review.sheets.map((sheet) => sheet.key) })
        const cells = new Map<string, { cell: ReviewCellKey; notes: Array<(typeof numbered)[number]> }>()

        for (const entry of numbered) {
          const key = cellKeyText(entry.note)
          const group = cells.get(key) ?? { cell: entry.note, notes: [] }
          group.notes.push(entry)
          cells.set(key, group)
        }

        const images = new Map<string, string>()

        for (const [key, { cell, notes }] of cells) {
          const still = cellOf({ review, cell })

          if (Option.isNone(still)) continue
          const png = yield* store.readStill(still.value.file)

          const burned = yield* sheets.burnMarks({
            png,
            scale: still.value.scale,
            svg: marksSvg(notes.map(({ note, number }) => ({ mark: note.mark, number }))),
          })

          images.set(key, yield* store.writeRoundFile({ round, name: burnedImageName(cell), content: burned }))
        }

        return images
      })

    return ReviewService.of({
      reviewLabels: Effect.fn('ReviewService.reviewLabels')(function* ({ request, open, onListening }) {
        const session = yield* artifacts.readSession()
        const review = yield* Effect.fromResult(reviewSheetsFromSession({ session, request }))
        const last = yield* store.readLastRound()
        const round = Option.match(last, { onNone: () => 1, onSome: (entry) => entry.round + 1 })
        const saved = Option.getOrElse(yield* store.readDraft(), () => emptyReviewDraft)

        const previous: ReadonlyArray<Note> = Option.match(last, {
          onNone: () => [],
          onSome: (entry) => draftForSheets({ draft: entry.draft, review }).notes,
        })

        const page: ReviewPage = {
          round,
          ask: Option.getOrElse(request.ask, () => ''),
          labels: review.labels,
          sheets: review.sheets,
          draft: draftForSheets({ draft: saved, review }),
          previous,
        }

        const ended = yield* server.serveReview({
          page,
          files: stillFiles(review),
          saveDraft: (draft) => store.writeDraft(draft),
          open,
          onListening,
        })

        const draft = Match.valueTags(ended, {
          SubmittedReview: (submitted) => Option.some(draftForSheets({ draft: submitted.draft, review })),
          ClosedReview: () => Option.none<ReviewDraft>(),
        })

        if (Option.isNone(draft) || decisionFromDraft(draft.value) === 'dismissed') return dismissed

        const images = yield* burnCells({ review, round, draft: draft.value })

        const elements = new Map<string, ReadonlyArray<PageElement>>(
          session.labels.flatMap((entry) =>
            entry.captures.flatMap((result) =>
              Predicate.isTagged(result, 'CapturedResult') ? [[result.file, result.elements ?? []] as const] : [],
            ),
          ),
        )

        const feedback = reviewFeedbackFromDraft({
          round,
          ask: page.ask,
          review,
          draft: draft.value,
          elementsOf: (cell) =>
            Option.match(cellOf({ review, cell }), {
              onNone: () => [],
              onSome: (still) => elements.get(still.file) ?? [],
            }),
          images: (cell) => Option.fromNullishOr(images.get(cellKeyText(cell))),
        })

        const markdown = feedbackMarkdown(feedback)
        const markdownFile = yield* store.writeRoundFile({ round, name: 'feedback.md', content: markdown })

        const jsonFile = yield* store.writeRoundFile({
          round,
          name: 'feedback.json',
          content: `${JSON.stringify(feedback, null, 2)}\n`,
        })

        yield* store.writeRoundFile({ round, name: 'draft.json', content: JSON.stringify(draft.value) })
        yield* store.removeDraft()

        return { decision: feedback.decision, round: Option.some({ feedback, markdown, markdownFile, jsonFile }) }
      }),
    })
  }),
)
