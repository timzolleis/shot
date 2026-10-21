import { Schema } from 'effect'

import { EvidenceCell } from '../../evidence/domain/evidence-report.ts'

/**
 * F: the user compares labels the agent named, votes, draws on the stills and submits. Shapes are in the still's CSS
 * pixels from its top-left (F29). This is also the wire format of the review page, so it holds no `Option`.
 */

export const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite })

export type Point = typeof Point.Type

export const Pin = Schema.TaggedStruct('Pin', { x: Schema.Finite, y: Schema.Finite })

export const Box = Schema.TaggedStruct('Box', {
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
})

export const Arrow = Schema.TaggedStruct('Arrow', { from: Point, to: Point })
export const Pen = Schema.TaggedStruct('Pen', { points: Schema.Array(Point) })
export const Mark = Schema.Union([Pin, Box, Arrow, Pen])

export type Mark = typeof Mark.Type

/** One drawing on one cell: a sheet key, a label and a sheet variant ("iPhone 15, light"). An empty comment is none. */
export const Note = Schema.Struct({
  id: Schema.String,
  sheet: Schema.String,
  label: Schema.String,
  variant: Schema.String,
  mark: Mark,
  comment: Schema.String,
})

export type Note = typeof Note.Type

/** A vote on one sheet key: `pick` is a label, or null for "none of these" (F28). */
export const Vote = Schema.Struct({ sheet: Schema.String, pick: Schema.NullOr(Schema.String), comment: Schema.String })

export type Vote = typeof Vote.Type

/** What the user has so far: saved as the draft on every change, sent on submit (F31). */
export const ReviewDraft = Schema.Struct({
  votes: Schema.Array(Vote),
  notes: Schema.Array(Note),
  pick: Schema.NullOr(Schema.String),
  comment: Schema.String,
})

export type ReviewDraft = typeof ReviewDraft.Type

export const emptyReviewDraft: ReviewDraft = { votes: [], notes: [], pick: null, comment: '' }

/** A label as the page shows it: the base is first and takes no vote (F24). */
export const ReviewLabel = Schema.Struct({ label: Schema.String, description: Schema.String, base: Schema.Boolean })

export type ReviewLabel = typeof ReviewLabel.Type

/** One label's cell in one variant: the still, a failure, or not shot (F27). */
export const ReviewCell = Schema.Struct({ label: Schema.String, cell: EvidenceCell })

export type ReviewCell = typeof ReviewCell.Type

export const ReviewVariant = Schema.Struct({ variant: Schema.String, cells: Schema.Array(ReviewCell) })

export type ReviewVariant = typeof ReviewVariant.Type

/** One sheet key, its variants (size and mode) narrowest first, light before dark. */
export const ReviewSheet = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  variants: Schema.Array(ReviewVariant),
})

export type ReviewSheet = typeof ReviewSheet.Type

/** Everything the review page renders. `previous` is the last round's notes, shown faded (F35). */
export const ReviewPage = Schema.Struct({
  round: Schema.Number,
  ask: Schema.String,
  labels: Schema.Array(ReviewLabel),
  sheets: Schema.Array(ReviewSheet),
  draft: ReviewDraft,
  previous: Schema.Array(Note),
})

export type ReviewPage = typeof ReviewPage.Type

export const reviewDecisions = ['picked', 'annotated', 'dismissed'] as const

export const ReviewDecision = Schema.Literals(reviewDecisions)

export type ReviewDecision = typeof ReviewDecision.Type

/** How the page ended: the user submitted their draft, or closed it (button, or the tab gone 30s) (F33). */
export const SubmittedReview = Schema.TaggedStruct('SubmittedReview', { draft: ReviewDraft })
export const ClosedReview = Schema.TaggedStruct('ClosedReview', {})
export const ReviewEnd = Schema.Union([SubmittedReview, ClosedReview])

export type ReviewEnd = typeof ReviewEnd.Type
