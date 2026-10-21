import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'

import type { Session } from '../src/artifact/session.ts'
import { type Capture, RouteSource } from '../src/capture/domain/capture.ts'
import { captureKey, sheetKey } from '../src/capture/domain/capture-key.ts'
import { defaultShootFlags, planCapturesFromFlags } from '../src/capture/domain/capture-plan.ts'
import { CapturedResult, type CaptureResult, type PageElement } from '../src/capture/domain/capture-result.ts'
import { type Size, sizeAliases } from '../src/capture/domain/size.ts'
import {
  decisionFromDraft,
  elementAtMark,
  feedbackMarkdown,
  overallPickFromDraft,
  reviewFeedbackFromDraft,
} from '../src/review/domain/review-feedback.ts'
import { draftForSheets, type ReviewRequest, reviewSheetsFromSession } from '../src/review/domain/review-sheets.ts'
import { Arrow, Box, emptyReviewDraft, type Note, Pin, type ReviewDraft } from '../src/review/domain/review.ts'
import { numberedNotes } from '../src/review/marks.ts'

const persons = RouteSource.make({ path: '/app/persons', user: 'admin@example.org', params: {} })

const captureOf = ({ section, size }: { readonly section: string; readonly size: Size }): Capture => {
  const plan = Result.getOrThrow(
    planCapturesFromFlags({
      source: persons,
      flags: { ...defaultShootFlags, sizes: [size], sections: [section] },
    }),
  )

  return plan[0]!
}

const captured = ({ label, capture }: { readonly label: string; readonly capture: Capture }): CaptureResult => {
  const key = captureKey(capture)

  return CapturedResult.make({ capture, key, file: `.shots/s/${label}/${key}.png`, measurements: null, findings: [] })
}

const people = {
  phone: captureOf({ section: 'People', size: sizeAliases.phone }),
  desktop: captureOf({ section: 'People', size: sizeAliases.desktop }),
}

const filters = captureOf({ section: 'Filters', size: sizeAliases.desktop })

/** before, quiet and dense: People at phone and desktop, Filters at desktop; dense has no phone still. */
const session: Session = {
  name: 's',
  dir: '.shots/s',
  labels: [
    {
      label: 'before',
      captures: [people.phone, people.desktop, filters].map((capture) => captured({ label: 'before', capture })),
      flows: [],
    },
    {
      label: 'quiet',
      captures: [people.phone, people.desktop, filters].map((capture) => captured({ label: 'quiet', capture })),
      flows: [],
    },
    {
      label: 'dense',
      captures: [people.desktop, filters].map((capture) => captured({ label: 'dense', capture })),
      flows: [],
    },
  ],
}

const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  labels: ['quiet', 'dense'],
  base: Option.some('before'),
  sheets: [],
  sizes: [],
  ask: Option.none(),
  describe: {},
  ...overrides,
})

const failureTag = <A>(result: Result.Result<A, { readonly _tag: string }>) =>
  Result.isFailure(result) ? result.failure._tag : 'ok'

const peopleKey = sheetKey(people.phone)
const filtersKey = sheetKey(filters)

describe('reviewSheetsFromSession (F23–F27)', () => {
  it('variants served as ?variant=<name> line up on one sheet, titled without the query (F27)', () => {
    const at = (variant: string) =>
      Result.getOrThrow(
        planCapturesFromFlags({
          source: RouteSource.make({ path: `/team?variant=${variant}`, user: 'admin@example.org', params: {} }),
          flags: { ...defaultShootFlags, sizes: [sizeAliases.phone], sections: ['People'] },
        }),
      )[0]!

    const variants: Session = {
      name: 's',
      dir: '.shots/s',
      labels: ['quiet', 'dense'].map((label) => ({
        label,
        captures: [captured({ label, capture: at(label) })],
        flows: [],
      })),
    }

    const review = Result.getOrThrow(
      reviewSheetsFromSession({ session: variants, request: request({ base: Option.none() }) }),
    )

    expect(review.sheets).toHaveLength(1)
    expect(review.sheets[0]!.title).toBe('/team as admin@example.org › People')
    expect(review.sheets[0]!.variants[0]!.cells.map((cell) => `${cell.label}: ${cell.cell._tag}`)).toEqual([
      'quiet: ShotCell',
      'dense: ShotCell',
    ])
  })

  it('labels in the order named, base first and without a vote; descriptions under their label (F23, F24, F26)', () => {
    const review = Result.getOrThrow(
      reviewSheetsFromSession({
        session,
        request: request({ labels: ['dense', 'quiet'], describe: { quiet: 'Lowest weight' } }),
      }),
    )

    expect(review.labels).toEqual([
      { label: 'before', description: '', base: true },
      { label: 'dense', description: '', base: false },
      { label: 'quiet', description: 'Lowest weight', base: false },
    ])
  })

  it('only the labels named appear: no base unless named (F23)', () => {
    const review = Result.getOrThrow(
      reviewSheetsFromSession({ session, request: request({ labels: ['dense'], base: Option.none() }) }),
    )

    expect(review.labels.map((label) => label.label)).toEqual(['dense'])
    expect(review.sheets[0]!.variants[0]!.cells.map((cell) => cell.label)).toEqual(['dense'])
  })

  it('a sheet per key, variants narrowest first; a label not shot in a variant → MissingCell (F27)', () => {
    const review = Result.getOrThrow(reviewSheetsFromSession({ session, request: request() }))
    expect(review.sheets.map((sheet) => sheet.key)).toEqual([peopleKey, filtersKey])

    expect(
      review.sheets[0]!.variants.map(
        (column) => `${column.variant}: ${column.cells.map((cell) => cell.cell._tag).join(' ')}`,
      ),
    ).toEqual(['iPhone 15, light: ShotCell ShotCell MissingCell', '1440×900, light: ShotCell ShotCell ShotCell'])
  })

  it('light and dark are columns of one sheet, light first (F27)', () => {
    const dark = Result.getOrThrow(
      planCapturesFromFlags({
        source: persons,
        flags: { ...defaultShootFlags, sizes: [sizeAliases.phone], sections: ['People'], modes: ['dark'] },
      }),
    )[0]!

    const modes: Session = {
      name: 's',
      dir: '.shots/s',
      labels: ['quiet', 'dense'].map((label) => ({
        label,
        captures: [dark, people.phone].map((capture) => captured({ label, capture })),
        flows: [],
      })),
    }

    const review = Result.getOrThrow(
      reviewSheetsFromSession({ session: modes, request: request({ base: Option.none() }) }),
    )

    expect(review.sheets).toHaveLength(1)
    expect(review.sheets[0]!.variants.map((column) => column.variant)).toEqual(['iPhone 15, light', 'iPhone 15, dark'])
  })

  it('a size where only the base has a still is left out', () => {
    const review = Result.getOrThrow(reviewSheetsFromSession({ session, request: request({ labels: ['dense'] }) }))
    expect(review.sheets[0]!.variants.map((column) => column.variant)).toEqual(['1440×900, light'])
  })

  it('--sheet narrows by part of the title, case-insensitive; --size by size (F25)', () => {
    const review = Result.getOrThrow(
      reviewSheetsFromSession({ session, request: request({ sheets: ['people'], sizes: [sizeAliases.phone] }) }),
    )

    expect(review.sheets.map((sheet) => sheet.key)).toEqual([peopleKey])
    expect(review.sheets[0]!.variants.map((column) => column.variant)).toEqual(['iPhone 15, light'])
  })

  it('an unknown label, sheet or size → its error; only the base → NothingToReviewError', () => {
    expect(failureTag(reviewSheetsFromSession({ session, request: request({ labels: ['nope'] }) }))).toBe(
      'LabelNotFoundError',
    )
    expect(failureTag(reviewSheetsFromSession({ session, request: request({ describe: { nope: 'x' } }) }))).toBe(
      'LabelNotFoundError',
    )
    expect(failureTag(reviewSheetsFromSession({ session, request: request({ sheets: ['Nope'] }) }))).toBe(
      'SheetNotFoundError',
    )
    expect(failureTag(reviewSheetsFromSession({ session, request: request({ sizes: [sizeAliases.tablet] }) }))).toBe(
      'SizeNotShotError',
    )
    expect(failureTag(reviewSheetsFromSession({ session, request: request({ labels: ['before'] }) }))).toBe(
      'NothingToReviewError',
    )
  })
})

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 'n1',
  sheet: peopleKey,
  label: 'dense',
  variant: '1440×900, light',
  mark: Pin.make({ x: 40, y: 50 }),
  comment: '',
  ...overrides,
})

describe('draftForSheets (F31)', () => {
  it('keeps what has a place on the page; drops notes on cells it no longer shows and votes for the base', () => {
    const review = Result.getOrThrow(reviewSheetsFromSession({ session, request: request() }))

    const draft: ReviewDraft = {
      votes: [
        { sheet: peopleKey, pick: 'dense', comment: '' },
        { sheet: filtersKey, pick: 'before', comment: '' },
        { sheet: 'gone', pick: null, comment: '' },
      ],
      notes: [note(), note({ id: 'n2', variant: 'iPhone 15, light' }), note({ id: 'n3', sheet: 'gone' })],
      pick: 'before',
      comment: 'hi',
    }

    expect(draftForSheets({ draft, review })).toEqual({
      votes: [{ sheet: peopleKey, pick: 'dense', comment: '' }],
      notes: [note()],
      pick: null,
      comment: 'hi',
    })
  })
})

describe('decisionFromDraft (F33)', () => {
  it('a vote or a pick → picked; only notes or comments → annotated; nothing → dismissed', () => {
    expect(decisionFromDraft({ ...emptyReviewDraft, votes: [{ sheet: 'a', pick: null, comment: '' }] })).toBe('picked')
    expect(decisionFromDraft({ ...emptyReviewDraft, pick: 'quiet' })).toBe('picked')
    expect(decisionFromDraft({ ...emptyReviewDraft, notes: [note()] })).toBe('annotated')
    expect(decisionFromDraft({ ...emptyReviewDraft, comment: 'try a scroller' })).toBe('annotated')
    expect(decisionFromDraft({ ...emptyReviewDraft, comment: '  ' })).toBe('dismissed')
  })
})

describe('overallPickFromDraft (F28)', () => {
  const vote = (sheet: string, pick: string | null) => ({ sheet, pick, comment: '' })

  it("the user's pick wins; else most votes; a tie goes to the label shown first", () => {
    const labels = ['quiet', 'dense']
    expect(
      overallPickFromDraft({ draft: { ...emptyReviewDraft, pick: 'quiet', votes: [vote('a', 'dense')] }, labels }),
    ).toEqual(Option.some('quiet'))
    expect(
      overallPickFromDraft({
        draft: { ...emptyReviewDraft, votes: [vote('a', 'dense'), vote('b', 'dense'), vote('c', 'quiet')] },
        labels,
      }),
    ).toEqual(Option.some('dense'))
    expect(
      overallPickFromDraft({ draft: { ...emptyReviewDraft, votes: [vote('a', 'dense'), vote('b', 'quiet')] }, labels }),
    ).toEqual(Option.some('quiet'))
    expect(overallPickFromDraft({ draft: { ...emptyReviewDraft, votes: [vote('a', null)] }, labels })).toEqual(
      Option.none(),
    )
  })
})

const element = (selector: string, role: string, rect: PageElement['rect'], name = ''): PageElement => ({
  selector,
  role,
  name,
  rect,
})

const section = element('section', 'region', { x: 0, y: 0, width: 400, height: 300 }, 'People')
const heading = element('h2', 'heading', { x: 16, y: 16, width: 200, height: 32 }, 'People')
const label = element('span', 'span', { x: 20, y: 250, width: 40, height: 20 }, 'Invite')
const invite = element('#invite', 'button', { x: 16, y: 244, width: 80, height: 32 }, 'Invite')
const elements = [section, heading, invite, label]

describe('elementAtMark (F34)', () => {
  it('pin on the text inside a button → the button: a control wins over smaller text', () => {
    expect(elementAtMark({ mark: Pin.make({ x: 30, y: 260 }), elements })).toEqual(Option.some(invite))
  })

  it('pin on empty space in a section → the section', () => {
    expect(elementAtMark({ mark: Pin.make({ x: 300, y: 150 }), elements })).toEqual(Option.some(section))
  })

  it('box drawn around the heading → the heading; arrow → what its tip points at', () => {
    expect(elementAtMark({ mark: Box.make({ x: 12, y: 12, width: 210, height: 40 }), elements })).toEqual(
      Option.some(heading),
    )
    expect(elementAtMark({ mark: Arrow.make({ from: { x: 300, y: 100 }, to: { x: 50, y: 255 } }), elements })).toEqual(
      Option.some(invite),
    )
  })

  it('outside every element, or no element map → none', () => {
    expect(elementAtMark({ mark: Pin.make({ x: 500, y: 500 }), elements })).toEqual(Option.none())
    expect(elementAtMark({ mark: Pin.make({ x: 30, y: 260 }), elements: [] })).toEqual(Option.none())
  })
})

describe('numberedNotes', () => {
  it('numbers in page order of sheets, then in the order drawn', () => {
    const notes = [note({ id: 'a', sheet: filtersKey }), note({ id: 'b' }), note({ id: 'c' })]
    expect(
      numberedNotes({ notes, sheets: [peopleKey, filtersKey] }).map(({ note, number }) => `${number}:${note.id}`),
    ).toEqual(['1:b', '2:c', '3:a'])
  })
})

describe('feedbackMarkdown (F32)', () => {
  it('the pick, then per sheet the vote, numbered notes with their element, and the images', () => {
    const review = Result.getOrThrow(reviewSheetsFromSession({ session, request: request({ sheets: ['people'] }) }))

    const draft: ReviewDraft = {
      votes: [{ sheet: peopleKey, pick: 'dense', comment: 'reads fastest' }],
      notes: [
        note({ comment: 'too tight\nagainst the list', mark: Pin.make({ x: 30.4, y: 260 }) }),
        note({
          id: 'n2',
          label: 'quiet',
          mark: Box.make({ x: 12, y: 12, width: 210, height: 40 }),
          comment: 'keep this',
        }),
      ],
      pick: null,
      comment: '',
    }

    const feedback = reviewFeedbackFromDraft({
      round: 2,
      ask: 'Pick a density',
      review,
      draft,
      elementsOf: () => elements,
      images: (cell) =>
        cell.label === 'dense' && cell.variant === '1440×900, light'
          ? Option.some('.shots/s/review/round-2/dense.png')
          : Option.none(),
    })

    expect(feedback.decision).toBe('picked')
    expect(feedback.pick).toBe('dense')

    expect(feedbackMarkdown(feedback)).toBe(
      [
        '# Review, round 2. Pick: dense',
        '',
        'Asked: Pick a density',
        '',
        `## ${review.sheets[0]!.title}`,
        '',
        'Picked: dense (over quiet).',
        '> reads fastest',
        '',
        '1. dense · 1440×900, light · pin (30, 260) · `#invite` button "Invite"',
        '   > too tight',
        '   > against the list',
        '2. quiet · 1440×900, light · box (12, 12, 210×40) · `h2` heading "People"',
        '   > keep this',
        '',
        'Images:',
        '- .shots/s/review/round-2/dense.png',
        '',
      ].join('\n'),
    )
  })
})
