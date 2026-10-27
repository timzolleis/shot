import { Match, Option, Predicate, Result } from 'effect'

import { labelDisplayName, labelFromName, type Session } from '../../artifact/session.ts'
import type { Capture, Source } from '../../capture/domain/capture.ts'
import { sheetKey } from '../../capture/domain/capture-key.ts'
import { type Size, sizeDescription } from '../../capture/domain/size.ts'
import { LabelNotFoundError, SheetNotFoundError } from '../../evidence/domain/evidence-error.ts'
import {
  type EvidenceCell,
  type EvidenceSheet,
  evidenceSheetsFromSession,
  MissingCell,
  type SheetRow,
  sheetHeading,
  sheetTitle,
  uniqueVariants,
  variantDescription,
} from '../../evidence/domain/evidence-report.ts'
import { NothingToReviewError, SizeNotShotError } from './review-error.ts'
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

const isShot = (cell: EvidenceCell) => Predicate.isTagged(cell, 'ShotCell')

const withoutQuery = (source: Source): Source =>
  Match.valueTags(source, {
    RouteSource: (route) => ({ ...route, path: route.path.split('?')[0]! }),
    UrlSource: (url) => ({ ...url, url: url.url.split('?')[0]! }),
  })

/** A capture with the query left out of its source: `/team?variant=quiet` and `/team?variant=dense` line up. */
const alignedCapture = (capture: Capture): Capture => ({ ...capture, source: withoutQuery(capture.source) })

/**
 * The report's sheets for these labels, with sheets that differ only in their URL's query merged into one, so variants
 * served as `?variant=<name>` sit side by side (F27). Sheets stay apart when a label has a still in more than one.
 */
const alignedSheets = ({
  session,
  labels,
}: {
  readonly session: Session
  readonly labels: ReadonlyArray<string>
}): ReadonlyArray<EvidenceSheet> => {
  const captures = new Map(
    session.labels.flatMap((entry) =>
      entry.captures.map((result) => [sheetKey(result.capture), result.capture] as const),
    ),
  )

  const sheets = evidenceSheetsFromSession(session).map((sheet) => ({
    ...sheet,
    rows: sheet.rows.filter((row) => labels.includes(row.label)),
  }))

  const groups = new Map<string, { capture: Capture; members: Array<EvidenceSheet> }>()

  for (const sheet of sheets) {
    const capture = alignedCapture(captures.get(sheet.key)!)
    const key = sheetKey(capture)
    const group = groups.get(key)
    const taken = new Set(group?.members.flatMap((member) => member.rows.map((row) => row.label)) ?? [])

    if (group !== undefined && sheet.rows.every((row) => !taken.has(row.label))) group.members.push(sheet)
    else groups.set(group === undefined ? key : sheet.key, { capture, members: [sheet] })
  }

  return [...groups.entries()].map(([key, { capture, members }]): EvidenceSheet => {
    if (members.length === 1) return members[0]!

    const variants = uniqueVariants(members.flatMap((member) => member.variants))

    const rows = members.flatMap((member) =>
      member.rows.map((row): SheetRow => ({
        label: row.label,
        cells: variants.map((variant) => {
          const index = member.variants.findIndex((own) => variantDescription(own) === variantDescription(variant))

          return index === -1 ? MissingCell.make({}) : row.cells[index]!
        }),
      })),
    )

    return { key, title: sheetTitle(capture), heading: sheetHeading(capture), file: members[0]!.file, variants, rows }
  })
}

/**
 * The labels the agent named, base first, and the sheets where a label that takes a vote has a still; variants (size
 * and mode) narrowest first, light before dark, narrowed by `--sheet` and `--size` (F23–F27).
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
    const label = labelFromName({ session, name })

    if (label === undefined) return Result.fail(new LabelNotFoundError({ label: name, labels: known }))
    resolved.set(name, label)
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

  const aligned = alignedSheets({ session, labels: order })

  const shotSizes = [
    ...new Set(aligned.flatMap((sheet) => sheet.variants.map((variant) => sizeDescription(variant.size)))),
  ]

  for (const size of wanted) {
    if (!shotSizes.includes(size)) return Result.fail(new SizeNotShotError({ size, sizes: shotSizes }))
  }

  const all = aligned.flatMap((sheet): ReadonlyArray<ReviewSheet> => {
    const variants = sheet.variants.flatMap((variant, index) => {
      if (wanted.size > 0 && !wanted.has(sizeDescription(variant.size))) return []

      const cells = order.map((label) => ({
        label,
        cell: sheet.rows.find((row) => row.label === label)?.cells[index] ?? MissingCell.make({}),
      }))

      const compared = cells.some(({ label, cell }) => candidates.includes(label) && isShot(cell))

      return compared ? [{ variant: variantDescription(variant), cells }] : []
    })

    return variants.length === 0 ? [] : [{ key: sheet.key, title: sheet.title, variants }]
  })

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

  const hasCell = ({
    sheet,
    label,
    variant,
  }: {
    readonly sheet: string
    readonly label: string
    readonly variant: string
  }) =>
    review.sheets.some(
      (entry) =>
        entry.key === sheet &&
        entry.variants.some(
          (column) =>
            column.variant === variant && column.cells.some((cell) => cell.label === label && isShot(cell.cell)),
        ),
    )

  return {
    votes: draft.votes.filter((vote) => keys.has(vote.sheet) && (vote.pick === null || voting.includes(vote.pick))),
    notes: draft.notes.filter(hasCell),
    pick: draft.pick !== null && voting.includes(draft.pick) ? draft.pick : null,
    comment: draft.comment,
  }
}
