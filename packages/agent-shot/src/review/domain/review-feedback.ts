import { Match, Option, Schema } from 'effect'

import { labelDisplayName } from '../../artifact/session.ts'
import { slugFromText } from '../../capture/domain/capture-key.ts'
import { PageElement } from '../../capture/domain/capture-result.ts'
import { type Bounds, numberedNotes, markBounds } from '../marks.ts'
import type { ReviewSheets } from './review-sheets.ts'
import { type ReviewDecision, ReviewDecision as ReviewDecisionSchema, type ReviewDraft, Mark } from './review.ts'

/** What the agent gets back from a round (F32): per sheet the vote, the numbered notes and the burned images. */

export const FeedbackNote = Schema.Struct({
  number: Schema.Number,
  label: Schema.String,
  variant: Schema.String,
  mark: Mark,
  comment: Schema.String,
  element: Schema.NullOr(PageElement),
})

export type FeedbackNote = typeof FeedbackNote.Type

export const FeedbackSheet = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  /** Null: no vote. `pick` null: "none of these" (F28). */
  vote: Schema.NullOr(Schema.Struct({ pick: Schema.NullOr(Schema.String), comment: Schema.String })),
  notes: Schema.Array(FeedbackNote),
  images: Schema.Array(Schema.String),
})

export type FeedbackSheet = typeof FeedbackSheet.Type

export const ReviewFeedback = Schema.Struct({
  decision: ReviewDecisionSchema,
  round: Schema.Number,
  ask: Schema.String,
  labels: Schema.Array(Schema.String),
  base: Schema.NullOr(Schema.String),
  pick: Schema.NullOr(Schema.String),
  comment: Schema.String,
  sheets: Schema.Array(FeedbackSheet),
})

export type ReviewFeedback = typeof ReviewFeedback.Type

/** A cell of the page: one sheet key, label and variant. */
export interface ReviewCellKey {
  readonly sheet: string
  readonly label: string
  readonly variant: string
}

/** Picked: a vote or a pick. Annotated: only notes or comments. Dismissed: nothing at all (F33). */
export const decisionFromDraft = (draft: ReviewDraft): ReviewDecision => {
  if (draft.votes.length > 0 || draft.pick !== null) return 'picked'

  const commented =
    draft.comment.trim() !== '' || draft.notes.length > 0 || draft.votes.some((vote) => vote.comment.trim() !== '')

  return commented ? 'annotated' : 'dismissed'
}

/** The user's pick, else the label picked on most sheets; a tie goes to the label shown first (F28). */
export const overallPickFromDraft = ({
  draft,
  labels,
}: {
  readonly draft: ReviewDraft
  readonly labels: ReadonlyArray<string>
}): Option.Option<string> => {
  if (draft.pick !== null) return Option.some(draft.pick)

  const counts = labels.map((label) => ({ label, count: draft.votes.filter((vote) => vote.pick === label).length }))
  const most = Math.max(0, ...counts.map(({ count }) => count))

  return most === 0 ? Option.none() : Option.fromNullishOr(counts.find(({ count }) => count === most)?.label)
}

const controlRoles = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'slider',
  'switch',
  'tab',
  'menuitem',
  'option',
  'img',
  'heading',
])

const area = (bounds: Bounds) => bounds.width * bounds.height

const containsPoint = ({ bounds, x, y }: { readonly bounds: Bounds; readonly x: number; readonly y: number }) =>
  x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height

const overlapRatio = (a: Bounds, b: Bounds) => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)

  if (width <= 0 || height <= 0) return 0
  const shared = width * height

  return shared / (area(a) + area(b) - shared)
}

const smallest = (elements: ReadonlyArray<PageElement>): Option.Option<PageElement> =>
  Option.fromNullishOr(elements.toSorted((a, b) => area(a.rect) - area(b.rect))[0])

/** The control under a point, else the smallest element under it. */
const elementAtPoint = ({
  elements,
  x,
  y,
}: {
  readonly elements: ReadonlyArray<PageElement>
  readonly x: number
  readonly y: number
}): Option.Option<PageElement> => {
  const under = elements.filter((element) => containsPoint({ bounds: element.rect, x, y }))

  return Option.orElse(smallest(under.filter((element) => controlRoles.has(element.role))), () => smallest(under))
}

/** The element that fills an area best (half its area or more shared), else the one under its centre. */
const elementInBounds = ({
  elements,
  bounds,
}: {
  readonly elements: ReadonlyArray<PageElement>
  readonly bounds: Bounds
}): Option.Option<PageElement> => {
  const ranked = elements
    .map((element) => ({ element, ratio: overlapRatio(element.rect, bounds) }))
    .filter(({ ratio }) => ratio >= 0.5)
    .toSorted((a, b) => b.ratio - a.ratio)

  if (ranked.length > 0) return Option.some(ranked[0]!.element)

  return elementAtPoint({ elements, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
}

/** What a note points at, from the still's element map (F34): a pin's point, an arrow's tip, a box's or stroke's area. */
export const elementAtMark = ({
  mark,
  elements,
}: {
  readonly mark: Mark
  readonly elements: ReadonlyArray<PageElement>
}): Option.Option<PageElement> =>
  Match.valueTags(mark, {
    Pin: ({ x, y }) => elementAtPoint({ elements, x, y }),
    Arrow: ({ to }) => elementAtPoint({ elements, x: to.x, y: to.y }),
    Box: () => elementInBounds({ elements, bounds: markBounds(mark) }),
    Pen: () => elementInBounds({ elements, bounds: markBounds(mark) }),
  })

/** `<sheet key>--<label>--<variant>.png` (F32). */
export const burnedImageName = ({ sheet, label, variant }: ReviewCellKey): string =>
  `${sheet}--${slugFromText(labelDisplayName(label))}--${slugFromText(variant)}.png`

/** The round's feedback; `images` gives each burned cell's file, `elementsOf` each cell's element map. */
export const reviewFeedbackFromDraft = ({
  round,
  ask,
  review,
  draft,
  elementsOf,
  images,
}: {
  readonly round: number
  readonly ask: string
  readonly review: ReviewSheets
  readonly draft: ReviewDraft
  readonly elementsOf: (cell: ReviewCellKey) => ReadonlyArray<PageElement>
  readonly images: (cell: ReviewCellKey) => Option.Option<string>
}): ReviewFeedback => {
  const voting = review.labels.filter((label) => !label.base).map((label) => label.label)
  const numbered = numberedNotes({ notes: draft.notes, sheets: review.sheets.map((sheet) => sheet.key) })

  const sheets = review.sheets.map((sheet): FeedbackSheet => {
    const vote = draft.votes.find((entry) => entry.sheet === sheet.key)
    const notes = numbered.filter(({ note }) => note.sheet === sheet.key)

    const cells = sheet.variants.flatMap((column) =>
      column.cells.map((cell) => ({ sheet: sheet.key, label: cell.label, variant: column.variant })),
    )

    return {
      key: sheet.key,
      title: sheet.title,
      vote: vote === undefined ? null : { pick: vote.pick, comment: vote.comment.trim() },
      notes: notes.map(({ note, number }) => ({
        number,
        label: note.label,
        variant: note.variant,
        mark: note.mark,
        comment: note.comment.trim(),
        element: Option.getOrNull(elementAtMark({ mark: note.mark, elements: elementsOf(note) })),
      })),
      images: cells.flatMap((cell) => Option.toArray(images(cell))),
    }
  })

  return {
    decision: decisionFromDraft(draft),
    round,
    ask,
    labels: voting,
    base: review.labels.find((label) => label.base)?.label ?? null,
    pick: Option.getOrNull(overallPickFromDraft({ draft, labels: voting })),
    comment: draft.comment.trim(),
    sheets,
  }
}

const whole = (value: number) => Math.round(value)

const markText = (mark: Mark): string =>
  Match.valueTags(mark, {
    Pin: ({ x, y }) => `pin (${whole(x)}, ${whole(y)})`,
    Box: ({ x, y, width, height }) => `box (${whole(x)}, ${whole(y)}, ${whole(width)}×${whole(height)})`,
    Arrow: ({ from, to }) => `arrow (${whole(from.x)}, ${whole(from.y)}) → (${whole(to.x)}, ${whole(to.y)})`,
    Pen: () => {
      const bounds = markBounds(mark)

      return `pen around (${whole(bounds.x + bounds.width / 2)}, ${whole(bounds.y + bounds.height / 2)})`
    },
  })

const elementText = (element: PageElement) =>
  `\`${element.selector}\` ${element.role}${element.name === '' ? '' : ` "${element.name}"`}`

const quoted = (text: string) =>
  text
    .split('\n')
    .map((line) => `   > ${line}`)
    .join('\n')

const voteText = ({ sheet, labels }: { readonly sheet: FeedbackSheet; readonly labels: ReadonlyArray<string> }) => {
  if (sheet.vote === null) return 'No vote.'

  const { pick } = sheet.vote

  if (pick === null) return 'Picked: none of these.'
  const others = labels.filter((label) => label !== pick).map(labelDisplayName)

  return `Picked: ${labelDisplayName(pick)}${others.length === 0 ? '' : ` (over ${others.join(', ')})`}.`
}

/** `feedback.md`: the pick, then per sheet the vote and the numbered notes with their element and image paths. */
export const feedbackMarkdown = (feedback: ReviewFeedback): string => {
  const pick = feedback.pick === null ? 'none' : labelDisplayName(feedback.pick)
  const lines: Array<string> = [`# Review, round ${feedback.round}. Pick: ${pick}`, '']

  if (feedback.ask !== '') lines.push(`Asked: ${feedback.ask}`, '')

  if (feedback.comment !== '') lines.push(...feedback.comment.split('\n').map((line) => `> ${line}`), '')

  for (const sheet of feedback.sheets) {
    lines.push(`## ${sheet.title}`, '', voteText({ sheet, labels: feedback.labels }))

    if (sheet.vote !== null && sheet.vote.comment !== '')
      lines.push(quoted(sheet.vote.comment).replaceAll('   > ', '> '))
    lines.push('')

    for (const note of sheet.notes) {
      const element = note.element === null ? '' : ` · ${elementText(note.element)}`
      lines.push(`${note.number}. ${labelDisplayName(note.label)} · ${note.variant} · ${markText(note.mark)}${element}`)

      if (note.comment !== '') lines.push(quoted(note.comment))
    }

    if (sheet.notes.length > 0) lines.push('')

    if (sheet.images.length > 0) lines.push('Images:', ...sheet.images.map((image) => `- ${image}`), '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}
