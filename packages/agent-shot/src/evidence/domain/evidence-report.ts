import { Match, Option, Predicate, Schema } from 'effect'

import type { Session } from '../../artifact/session.ts'
import { labelDisplayName } from '../../artifact/session.ts'
import { partDescription, type SheetKey, sheetKey, sourceDescription } from '../../capture/domain/capture-key.ts'
import type { Mode } from '../../capture/domain/capture.ts'
import type { CaptureResult } from '../../capture/domain/capture-result.ts'
import { type Size, sizeDescription, sizeOrder } from '../../capture/domain/size.ts'
import type { Finding } from '../../capture/domain/finding.ts'
import type { FlowStill } from '../../flow/domain/flow.ts'

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
 * One capture across labels, sizes and modes (C11, E20). `file` is the image to show: the still when the sheet has one,
 * else the sheet composed of every still.
 */
export interface EvidenceSheet {
  readonly key: SheetKey
  readonly title: string
  readonly file: string
  readonly variants: ReadonlyArray<SheetVariant>
  readonly rows: ReadonlyArray<SheetRow>
}

export interface EvidenceFlow {
  readonly label: string
  readonly name: string
  readonly size: Size
  readonly video: string
  readonly stills: ReadonlyArray<FlowStill>
  readonly stoppedAt: Option.Option<{ readonly step: string; readonly reason: string }>
}

export interface LabelledFinding {
  readonly subject: string
  readonly finding: Finding
}

export interface EvidenceFindings {
  readonly label: string
  readonly findings: ReadonlyArray<LabelledFinding>
}

export interface EvidenceReport {
  readonly session: string
  readonly sheets: ReadonlyArray<EvidenceSheet>
  readonly flows: ReadonlyArray<EvidenceFlow>
  readonly findings: ReadonlyArray<EvidenceFindings>
  readonly summary: {
    readonly captures: number
    readonly flows: number
    readonly errors: number
    readonly warnings: number
  }
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

const modeOrder: ReadonlyArray<Mode> = ['light', 'dark']

const variantName = (variant: SheetVariant): string => `${sizeDescription(variant.size)} ${variant.mode}`

/** Narrowest size first, light before dark (E20). */
const uniqueVariants = (variants: ReadonlyArray<SheetVariant>): ReadonlyArray<SheetVariant> =>
  variants
    .filter((variant, index) => variants.findIndex((other) => variantName(other) === variantName(variant)) === index)
    .toSorted((a, b) => sizeOrder(a.size, b.size) || modeOrder.indexOf(a.mode) - modeOrder.indexOf(b.mode))

const variantOfResult = (result: CaptureResult): SheetVariant => ({
  size: result.capture.variant.size,
  mode: result.capture.variant.mode,
})

/**
 * Stills grouped by sheet key: a row per label in session order, a column per size and mode, narrowest first, light
 * before dark; findings and flows per label (C11, E20).
 */
export const evidenceReportFromSession = (session: Session): EvidenceReport => {
  const stills = session.labels.map((entry) => ({
    label: entry.label,
    results: entry.captures.filter((result) => Predicate.isTagged(result.capture.output, 'Still')),
  }))

  const all = stills.flatMap((entry) => entry.results)
  const captureKeys = new Set(all.map((result) => result.key))
  const keys = [...new Set(all.map((result) => sheetKey(result.capture)))]

  const sheets = keys.flatMap((key): ReadonlyArray<EvidenceSheet> => {
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

    const shot = rows.flatMap((row) => row.cells.filter((cell) => Predicate.isTagged(cell, 'ShotCell')))

    if (shot.length === 0) return []

    return [
      {
        key,
        title: `${sourceDescription(capture.source)} › ${Option.getOrElse(capture.name, () => partDescription(capture.part))}`,
        file: shot.length === 1 ? shot[0]!.file : sheetFileFromKey({ dir: session.dir, key }),
        variants,
        rows,
      },
    ]
  })

  const flows = session.labels.flatMap((entry) =>
    entry.flows.map((flow): EvidenceFlow => ({
      label: entry.label,
      name: flow.flow.name,
      size: flow.flow.size,
      video: flow.video,
      stills: flow.stills,
      stoppedAt: Match.valueTags(flow, {
        StoppedFlow: ({ failedStep, reason }) => Option.some({ step: failedStep, reason }),
        CompletedFlow: () => Option.none(),
      }),
    })),
  )

  const findings = session.labels
    .map((entry): EvidenceFindings => ({
      label: entry.label,
      findings: [
        ...entry.captures.flatMap((result) =>
          result.findings.map((finding) => ({
            subject: `${sourceDescription(result.capture.source)} › ${partDescription(result.capture.part)} (${sizeDescription(result.capture.variant.size)}, ${result.capture.variant.mode})`,
            finding,
          })),
        ),
        ...entry.flows.flatMap((flow) =>
          Match.valueTags(flow, {
            StoppedFlow: ({ failedStep, reason }) => [
              {
                subject: `flow ${flow.flow.name} (${sizeDescription(flow.flow.size)})`,
                finding: {
                  check: 'flow',
                  severity: 'error' as const,
                  message: `step ${failedStep}: ${reason}`,
                  selector: '',
                  rect: Option.none(),
                },
              },
            ],
            CompletedFlow: () => [],
          }),
        ),
      ],
    }))
    .filter((group) => group.findings.length > 0)

  const listed = findings.flatMap((group) => group.findings)

  return {
    session: session.name,
    sheets,
    flows,
    findings,
    summary: {
      captures: captureKeys.size,
      flows: flows.length,
      errors: listed.filter(({ finding }) => finding.severity === 'error').length,
      warnings: listed.filter(({ finding }) => finding.severity === 'warn').length,
    },
  }
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
    return {
      groups: [],
      columns: sheet.rows.map((row) => heading(labelDisplayName(row.label))),
      rows: [{ label: '', cells: sheet.rows.map((row) => row.cells[0]!) }],
    }
  }

  const sizes = sheetSizes(sheet)
  const byMode = sheetModes(sheet).length > 1
  const modeHeading = (variant: SheetVariant) => heading(variant.mode, Option.some(variant.mode))

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
    columns: sheet.variants.map((variant) => (byMode ? modeHeading(variant) : heading(sizeDescription(variant.size)))),
    rows: sheet.rows.map((row) => ({
      label: sheet.rows.length === 1 ? '' : labelDisplayName(row.label),
      cells: row.cells,
    })),
  }
}

const variantDescription = (variant: SheetVariant): string => `${sizeDescription(variant.size)}, ${variant.mode}`

const cellNote = (cell: EvidenceCell): Option.Option<string> =>
  Match.valueTags(cell, {
    ShotCell: () => Option.none(),
    FailedCell: () => Option.some('failed'),
    MissingCell: () => Option.some('not shot'),
  })

/**
 * What the image does not show: the size and mode all its stills share, e.g. `1280×900, dark`. A sheet of one still
 * also names its label and the stills that failed or were not shot: `after · 1280×900, light · before failed`.
 */
const sheetCaption = (sheet: EvidenceSheet): string => {
  const sizes = sheetSizes(sheet)
  const modes = sheetModes(sheet)
  const shared = [...(sizes.length === 1 ? [sizeDescription(sizes[0]!)] : []), ...(modes.length === 1 ? modes : [])]
  const cells = sheet.rows.flatMap((row) => row.cells.map((cell, index) => ({ label: row.label, cell, index })))
  const still = cells.find(({ cell }) => Predicate.isTagged(cell, 'ShotCell') && cell.file === sheet.file)

  if (still === undefined) return shared.join(', ')

  const notes = cells.flatMap(({ label, cell, index }) =>
    Option.toArray(
      Option.map(cellNote(cell), (note) =>
        [
          labelDisplayName(label),
          ...(sheet.variants.length > 1 ? [`at ${variantDescription(sheet.variants[index]!)}`] : []),
          note,
        ].join(' '),
      ),
    ),
  )

  return [
    ...(still.label === '' ? [] : [still.label]),
    ...(sheet.variants.length > 1 ? [variantDescription(sheet.variants[still.index]!)] : [shared.join(', ')]),
    ...notes,
  ].join(' · ')
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

/**
 * The report as markdown; images and videos by their project-relative paths, which `gh --attach` replaces. No heading,
 * and the counts only when there are findings: a clean run is its sheets.
 */
export const evidenceMarkdownFromReport = (report: EvidenceReport): string => {
  const lines: Array<string> = []
  const { errors, warnings } = report.summary

  if (errors + warnings > 0) lines.push(`${plural(errors, 'error')}, ${plural(warnings, 'warning')}.`, '')

  for (const sheet of report.sheets) {
    const caption = sheetCaption(sheet)
    lines.push(`**${sheet.title}**${caption === '' ? '' : ` · ${caption}`}`, '', `![${sheet.key}](${sheet.file})`, '')
  }

  for (const flow of report.flows) {
    const outcome = Option.match(flow.stoppedAt, {
      onNone: () => `${plural(flow.stills.length, 'step')} passed`,
      onSome: ({ step, reason }) => `stopped at ${step}: ${reason}`,
    })

    lines.push(
      `**Flow ${flow.name}** (${labelDisplayName(flow.label)}, ${sizeDescription(flow.size)}) · ${outcome}`,
      '',
      flow.video,
      '',
    )

    if (flow.stills.length > 0) {
      lines.push('<details><summary>Steps</summary>', '')

      for (const still of flow.stills) lines.push(`${still.step}`, '', `![${still.step}](${still.file})`, '')
      lines.push('</details>', '')
    }
  }

  for (const group of report.findings) {
    lines.push(`<details><summary>Findings · ${labelDisplayName(group.label)} (${group.findings.length})</summary>`, '')

    for (const { subject, finding } of group.findings) {
      const selector = finding.selector === '' ? '' : ` (\`${finding.selector}\`)`
      lines.push(`- ${finding.severity} ${finding.check} · ${subject}: ${finding.message}${selector}`)
    }

    lines.push('', '</details>', '')
  }

  return lines.join('\n').trimEnd()
}

/** Every local file the markdown references: what `gh --attach` uploads. */
export const evidenceFilesFromReport = (report: EvidenceReport): ReadonlyArray<string> => [
  ...report.sheets.map((sheet) => sheet.file),
  ...report.flows.flatMap((flow) => [flow.video, ...flow.stills.map((still) => still.file)]),
]
