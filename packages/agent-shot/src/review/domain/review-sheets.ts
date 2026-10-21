import { Option, Predicate, Result } from 'effect'

import { labelDisplayName, type Session } from '../../artifact/session.ts'
import { type Size, sizeDescription } from '../../capture/domain/size.ts'
import { type EvidenceCell, evidenceReportFromSession, MissingCell } from '../../evidence/domain/evidence-report.ts'
import { LabelNotFoundError, NothingToReviewError, SheetNotFoundError, SizeNotShotError } from './review-error.ts'
import type { ReviewDraft, ReviewLabel, ReviewSheet } from './review.ts'

/** What the agent puts up for review; shot adds nothing (F23). */
export interface ReviewRequest {
  /** In the order given; at least one. */
  readonly labels: ReadonlyArray<string>
  readonly base: Option.Option<string>
  /** Case-insensitive parts of sheet titles; empty = every sheet (F25). */
  readonly sheets: ReadonlyArray<string>
  /** Empty = every size the labels were shot at (F25). */
  readonly sizes: ReadonlyArray<Size>
  readonly ask: Option.Option<string>
  /** A line under a label (F26). */
  readonly describe: Readonly<Record<string, string>>
}

export interface ReviewSheets {
  readonly labels: ReadonlyArray<ReviewLabel>
  readonly sheets: ReadonlyArray<ReviewSheet>
}

export type ReviewSheetsError = LabelNotFoundError | SheetNotFoundError | SizeNotShotError | NothingToReviewError

/** `shot` names the captures shot without `--label` (A6). */
const sessionLabelFromName = ({ session, name }: { readonly session: Session; readonly name: string }) =>
  Option.fromNullishOr(
    session.labels.find((entry) => entry.label === name) ??
      session.labels.find((entry) => labelDisplayName(entry.label) === name),
  ).pipe(Option.map((entry) => entry.label))

const isShot = (cell: EvidenceCell) => Predicate.isTagged(cell, 'ShotCell')

/**
 * The labels the agent named, base first, and the sheets where a label that takes a vote has a still; sizes narrowest
 * first, narrowed by `--sheet` and `--size` (F23–F27).
 */
export const reviewSheetsFromSession = ({
  session,
  request,
}: {
  readonly session: Session
  readonly request: ReviewRequest
}): Result.Result<ReviewSheets, ReviewSheetsError> => {
  const known = session.labels.map((entry) => labelDisplayName(entry.label))
  const named = [...Option.toArray(request.base), ...request.labels, ...Object.keys(request.describe)]

  const resolved = new Map<string, string>()

  for (const name of named) {
    const label = sessionLabelFromName({ session, name })

    if (Option.isNone(label)) return Result.fail(new LabelNotFoundError({ label: name, labels: known }))
    resolved.set(name, label.value)
  }

  const labelOf = (name: string) => resolved.get(name) ?? name
  const base = Option.map(request.base, labelOf)
  const candidates = [...new Set(request.labels.map(labelOf))].filter((label) => !Option.contains(base, label))

  const order = [...Option.toArray(base), ...candidates]

  const labels = order.map((label): ReviewLabel => ({
    label,
    description: Object.entries(request.describe).find(([name]) => labelOf(name) === label)?.[1] ?? '',
    base: Option.contains(base, label),
  }))

  const wanted = new Set(request.sizes.map(sizeDescription))

  const all = evidenceReportFromSession(session).sheets.flatMap((sheet): ReadonlyArray<ReviewSheet> => {
    const sizes = sheet.sizes.flatMap((size, index) => {
      if (wanted.size > 0 && !wanted.has(sizeDescription(size))) return []

      const cells = order.map((label) => ({
        label,
        cell: sheet.rows.find((row) => row.label === label)?.cells[index] ?? MissingCell.make({}),
      }))

      const compared = cells.some(({ label, cell }) => candidates.includes(label) && isShot(cell))

      return compared ? [{ size: sizeDescription(size), cells }] : []
    })

    return sizes.length === 0 ? [] : [{ key: sheet.key, title: sheet.title, sizes }]
  })

  for (const size of wanted) {
    if (!all.some((sheet) => sheet.sizes.some((entry) => entry.size === size))) {
      const shot = [...new Set(all.flatMap((sheet) => sheet.sizes.map((entry) => entry.size)))]

      return Result.fail(new SizeNotShotError({ size, sizes: shot }))
    }
  }

  const matching = (needle: string) => all.filter((sheet) => sheet.title.toLowerCase().includes(needle.toLowerCase()))

  for (const needle of request.sheets) {
    if (matching(needle).length === 0) {
      return Result.fail(new SheetNotFoundError({ sheet: needle, titles: all.map((sheet) => sheet.title) }))
    }
  }

  const sheets =
    request.sheets.length === 0
      ? all
      : all.filter((sheet) => request.sheets.some((needle) => matching(needle).includes(sheet)))

  if (sheets.length === 0) return Result.fail(new NothingToReviewError({ labels: candidates.map(labelDisplayName) }))

  return Result.succeed({ labels, sheets })
}

/** A restored draft keeps what still has a place on the page: a vote on a sheet it shows, a note on a still (F31). */
export const draftForSheets = ({
  draft,
  review,
}: {
  readonly draft: ReviewDraft
  readonly review: ReviewSheets
}): ReviewDraft => {
  const voting = review.labels.filter((label) => !label.base).map((label) => label.label)
  const keys = new Set(review.sheets.map((sheet) => sheet.key))

  const hasCell = ({ sheet, label, size }: { readonly sheet: string; readonly label: string; readonly size: string }) =>
    review.sheets.some(
      (entry) =>
        entry.key === sheet &&
        entry.sizes.some(
          (sized) => sized.size === size && sized.cells.some((cell) => cell.label === label && isShot(cell.cell)),
        ),
    )

  return {
    votes: draft.votes.filter((vote) => keys.has(vote.sheet) && (vote.pick === null || voting.includes(vote.pick))),
    notes: draft.notes.filter(hasCell),
    pick: draft.pick !== null && voting.includes(draft.pick) ? draft.pick : null,
    comment: draft.comment,
  }
}
