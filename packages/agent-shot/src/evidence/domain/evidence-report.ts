import { Match, Option, Predicate, Result, Schema } from 'effect'

import { labelDisplayName, labelFromName, type Session } from '../../artifact/session.ts'
import { partDescription, type SheetKey, sheetKey, sourceDescription } from '../../capture/domain/capture-key.ts'
import type { Capture, Mode } from '../../capture/domain/capture.ts'
import type { CaptureResult } from '../../capture/domain/capture-result.ts'
import { type Size, sizeDescription, sizeOrder } from '../../capture/domain/size.ts'
import { LabelNotFoundError, NoEvidenceError, SheetNotFoundError } from './evidence-error.ts'

/** One cell of a sheet: a label's still at a size, its failure, or nothing shot there (E20). */
export const ShotCell = Schema.TaggedStruct('ShotCell', { file: Schema.String, scale: Schema.Number })
export const FailedCell = Schema.TaggedStruct('FailedCell', {})
export const MissingCell = Schema.TaggedStruct('MissingCell', {})
export const EvidenceCell = Schema.Union([ShotCell, FailedCell, MissingCell])

export type EvidenceCell = typeof EvidenceCell.Type

/** A column of a sheet: one size in one mode. */
export interface SheetVariant {
  readonly size: Size
  readonly mode: Mode
}

/** A label's cells, one per variant of the sheet, in its order. */
export interface SheetRow {
  readonly label: string
  readonly cells: ReadonlyArray<EvidenceCell>
}

/**
 * One capture across labels, sizes and modes (C11, E20). `title` names the user, for `--sheet`; `heading` leaves it
 * out, for the PR. `file` is the sheet composed of its stills, labels and sizes drawn in.
 */
export interface EvidenceSheet {
  readonly key: SheetKey
  readonly title: string
  readonly heading: string
  readonly file: string
  readonly variants: ReadonlyArray<SheetVariant>
  readonly rows: ReadonlyArray<SheetRow>
}

/** A sheet the agent picked, with what it says about it (`''`: nothing). */
export interface PublishedSheet extends EvidenceSheet {
  readonly note: string
}

/** What goes on the PR: only the sheets the agent picked (C11). */
export interface EvidenceReport {
  readonly session: string
  readonly sheets: ReadonlyArray<PublishedSheet>
}

/** What the agent publishes; shot adds nothing (C11). */
export interface PublishRequest {
  /** In the order given, a row each; at least one. */
  readonly labels: ReadonlyArray<string>
  /** Case-insensitive parts of sheet titles; with no `sheets` and no `notes`, every sheet of the labels. */
  readonly sheets: ReadonlyArray<string>
  /** Part of a sheet title → a line under that sheet; also picks the sheet. */
  readonly notes: Readonly<Record<string, string>>
}

/** Composed sheets live next to the report. */
export const sheetFileFromKey = ({ dir, key }: { readonly dir: string; readonly key: string }): string =>
  `${dir}/report/${key}.png`

const cellFromResult = (result: CaptureResult | undefined): EvidenceCell => {
  if (result === undefined) return MissingCell.make({})

  return Match.valueTags(result, {
    CapturedResult: ({ file, capture }) => ShotCell.make({ file, scale: capture.variant.scale }),
    FailedCaptureResult: () => FailedCell.make({}),
  })
}

const isShot = (cell: EvidenceCell) => Predicate.isTagged(cell, 'ShotCell')

const modeOrder: ReadonlyArray<Mode> = ['light', 'dark']

const variantName = (variant: SheetVariant): string => `${sizeDescription(variant.size)} ${variant.mode}`

/** Narrowest size first, light before dark (E20). */
export const uniqueVariants = (variants: ReadonlyArray<SheetVariant>): ReadonlyArray<SheetVariant> =>
  variants
    .filter((variant, index) => variants.findIndex((other) => variantName(other) === variantName(variant)) === index)
    .toSorted((a, b) => sizeOrder(a.size, b.size) || modeOrder.indexOf(a.mode) - modeOrder.indexOf(b.mode))

const variantOfResult = (result: CaptureResult): SheetVariant => ({
  size: result.capture.variant.size,
  mode: result.capture.variant.mode,
})

/** The capture's source and part, user included: what `--sheet` matches. */
export const sheetTitle = (capture: Capture): string =>
  `${sourceDescription(capture.source)} › ${Option.getOrElse(capture.name, () => partDescription(capture.part))}`

/** The title without the user: the PR's reader knows who the app shows. */
export const sheetHeading = (capture: Capture): string => {
  const source = Match.valueTags(capture.source, {
    RouteSource: ({ path, params }) =>
      [path, ...Object.entries(params).map(([name, value]) => `${name}=${value}`)].join(' '),
    UrlSource: () => sourceDescription(capture.source),
  })

  return `${source} › ${Option.getOrElse(capture.name, () => partDescription(capture.part))}`
}

/** Stills grouped by sheet key: a row per label in session order, a column per size and mode, narrowest first, light before dark (C11, E20). */
export const evidenceSheetsFromSession = (session: Session): ReadonlyArray<EvidenceSheet> => {
  const stills = session.labels.map((entry) => ({
    label: entry.label,
    results: entry.captures.filter((result) => Predicate.isTagged(result.capture.output, 'Still')),
  }))

  const all = stills.flatMap((entry) => entry.results)
  const keys = [...new Set(all.map((result) => sheetKey(result.capture)))]

  return keys.flatMap((key): ReadonlyArray<EvidenceSheet> => {
    const results = all.filter((result) => sheetKey(result.capture) === key)
    const capture = results[0]!.capture
    const variants = uniqueVariants(results.map(variantOfResult))

    const rows = stills
      .filter((entry) => entry.results.some((result) => sheetKey(result.capture) === key))
      .map((entry): SheetRow => ({
        label: entry.label,
        cells: variants.map((variant) =>
          cellFromResult(
            entry.results.find(
              (result) =>
                sheetKey(result.capture) === key && variantName(variantOfResult(result)) === variantName(variant),
            ),
          ),
        ),
      }))

    if (!rows.some((row) => row.cells.some(isShot))) return []

    return [
      {
        key,
        title: sheetTitle(capture),
        heading: sheetHeading(capture),
        file: sheetFileFromKey({ dir: session.dir, key }),
        variants,
        rows,
      },
    ]
  })
}

/** The sheet with only `labels`' rows, in their order, and only the columns one of them has a still in. */
const sheetForLabels = (sheet: EvidenceSheet, labels: ReadonlyArray<string>): Option.Option<EvidenceSheet> => {
  const rows = labels.flatMap((label) => sheet.rows.filter((row) => row.label === label))
  const kept = sheet.variants.flatMap((_, index) => (rows.some((row) => isShot(row.cells[index]!)) ? [index] : []))

  if (kept.length === 0) return Option.none()

  return Option.some({
    ...sheet,
    variants: kept.map((index) => sheet.variants[index]!),
    rows: rows.map((row) => ({ label: row.label, cells: kept.map((index) => row.cells[index]!) })),
  })
}

const titleMatches = (title: string, needle: string) => title.toLowerCase().includes(needle.toLowerCase())

/**
 * The sheets the agent picked, a row per named label in its order, each with its note (C11). Every `--sheet` and
 * `--note` must match a sheet: a typo fails instead of publishing less than the agent meant.
 */
export const evidenceReportFromSession = ({
  session,
  request,
}: {
  readonly session: Session
  readonly request: PublishRequest
}): Result.Result<EvidenceReport, LabelNotFoundError | SheetNotFoundError | NoEvidenceError> => {
  const labels: Array<string> = []

  for (const name of request.labels) {
    const label = labelFromName({ session, name })

    if (label === undefined) {
      return Result.fail(
        new LabelNotFoundError({ label: name, labels: session.labels.map((entry) => labelDisplayName(entry.label)) }),
      )
    }

    if (!labels.includes(label)) labels.push(label)
  }

  const all = evidenceSheetsFromSession(session).flatMap((sheet) => Option.toArray(sheetForLabels(sheet, labels)))

  if (all.length === 0) return Result.fail(new NoEvidenceError({ labels: labels.map(labelDisplayName) }))

  const notes = Object.entries(request.notes)
  const needles = [...request.sheets, ...notes.map(([needle]) => needle)]

  for (const needle of needles) {
    if (!all.some((sheet) => titleMatches(sheet.title, needle))) {
      return Result.fail(new SheetNotFoundError({ sheet: needle, titles: all.map((sheet) => sheet.title) }))
    }
  }

  const picked =
    needles.length === 0 ? all : all.filter((sheet) => needles.some((needle) => titleMatches(sheet.title, needle)))

  return Result.succeed({
    session: session.name,
    sheets: picked.map((sheet) => ({
      ...sheet,
      note: notes
        .filter(([needle]) => titleMatches(sheet.title, needle))
        .map(([, note]) => note.trim())
        .join(' '),
    })),
  })
}

/** A heading over a column or a run of columns; a mode heading carries its mode, for its icon. */
export interface SheetHeading {
  readonly title: string
  readonly mode: Option.Option<Mode>
  readonly span: number
}

/**
 * A sheet as drawn: optional group headings over runs of columns, column headings, then rows of a label and its cells.
 * A row's label is `''` when the sheet has one row: the column headings say it all.
 */
export interface SheetGrid {
  readonly groups: ReadonlyArray<SheetHeading>
  readonly columns: ReadonlyArray<SheetHeading>
  readonly rows: ReadonlyArray<SheetRow>
}

const heading = (title: string, mode: Option.Option<Mode> = Option.none(), span = 1): SheetHeading => ({
  title,
  mode,
  span,
})

const uniqueBy = <A>(items: ReadonlyArray<A>, keyOf: (item: A) => string): ReadonlyArray<A> =>
  items.filter((item, index) => items.findIndex((other) => keyOf(other) === keyOf(item)) === index)

const sheetSizes = (sheet: EvidenceSheet) =>
  uniqueBy(
    sheet.variants.map((variant) => variant.size),
    sizeDescription,
  )

const sheetModes = (sheet: EvidenceSheet) =>
  uniqueBy(
    sheet.variants.map((variant) => variant.mode),
    (mode) => mode,
  )

/**
 * One variant keeps labels side by side (C11). Several put labels in rows and variants in columns: sizes, modes, or
 * sizes over their modes (E20).
 */
export const sheetGridFromSheet = (sheet: EvidenceSheet): SheetGrid => {
  if (sheet.variants.length === 1) {
    const variant = sheet.variants[0]!

    return {
      groups: [heading(sizeDescription(variant.size), Option.some(variant.mode), sheet.rows.length)],
      columns: sheet.rows.map((row) => heading(row.label)),
      rows: [{ label: '', cells: sheet.rows.map((row) => row.cells[0]!) }],
    }
  }

  const sizes = sheetSizes(sheet)
  const byMode = sheetModes(sheet).length > 1
  const modeHeading = (variant: SheetVariant) => heading(variant.mode, Option.some(variant.mode))
  const sizeHeading = (variant: SheetVariant) => heading(sizeDescription(variant.size), Option.some(variant.mode))

  return {
    groups:
      byMode && sizes.length > 1
        ? sizes.map((size) =>
            heading(
              sizeDescription(size),
              Option.none(),
              sheet.variants.filter((variant) => sizeDescription(variant.size) === sizeDescription(size)).length,
            ),
          )
        : [],
    columns: sheet.variants.map((variant) => (byMode ? modeHeading(variant) : sizeHeading(variant))),
    rows: sheet.rows.map((row) => ({
      label: sheet.rows.length === 1 ? '' : row.label,
      cells: row.cells,
    })),
  }
}

export const variantDescription = (variant: SheetVariant): string => `${sizeDescription(variant.size)}, ${variant.mode}`

/**
 * The report as markdown: per sheet its heading, the agent's note and the image, by its project-relative path, which
 * `gh --attach` replaces. Labels, sizes and modes are drawn on the image.
 */
export const evidenceMarkdownFromReport = (report: EvidenceReport): string =>
  report.sheets
    .map((sheet) =>
      [`**${sheet.heading}**`, ...(sheet.note === '' ? [] : [sheet.note]), `![${sheet.key}](${sheet.file})`].join(
        '\n\n',
      ),
    )
    .join('\n\n')

/** Every local file the markdown references: what `gh --attach` uploads. */
export const evidenceFilesFromReport = (report: EvidenceReport): ReadonlyArray<string> =>
  report.sheets.map((sheet) => sheet.file)
