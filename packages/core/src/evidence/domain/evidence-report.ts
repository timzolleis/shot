import { Match, Option, Predicate, Schema } from 'effect'

import type { Session } from '../../artifact/session.ts'
import { labelDisplayName } from '../../artifact/session.ts'
import { partDescription, type SheetKey, sheetKey, sourceDescription } from '../../capture/domain/capture-key.ts'
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

/** A label's cells, one per size of the sheet, in its order. */
export interface SheetRow {
  readonly label: string
  readonly cells: ReadonlyArray<EvidenceCell>
}

/**
 * One capture across labels and sizes (C11, E20). `file` is the image to show: the still when the sheet has one, else
 * the sheet composed of every still.
 */
export interface EvidenceSheet {
  readonly key: SheetKey
  readonly title: string
  readonly file: string
  readonly sizes: ReadonlyArray<Size>
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

const uniqueSizes = (sizes: ReadonlyArray<Size>): ReadonlyArray<Size> =>
  sizes
    .filter((size, index) => sizes.findIndex((other) => sizeDescription(other) === sizeDescription(size)) === index)
    .toSorted(sizeOrder)

/**
 * Stills grouped by sheet key: a row per label in session order, a column per size, narrowest first; findings and
 * flows per label (C11, E20).
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
    const sizes = uniqueSizes(results.map((result) => result.capture.variant.size))

    const rows = stills
      .filter((entry) => entry.results.some((result) => sheetKey(result.capture) === key))
      .map((entry): SheetRow => ({
        label: entry.label,
        cells: sizes.map((size) =>
          cellFromResult(
            entry.results.find(
              (result) =>
                sheetKey(result.capture) === key &&
                sizeDescription(result.capture.variant.size) === sizeDescription(size),
            ),
          ),
        ),
      }))

    const shot = rows.flatMap((row) => row.cells.filter((cell) => Predicate.isTagged(cell, 'ShotCell')))

    if (shot.length === 0) return []

    return [
      {
        key,
        title: `${sourceDescription(capture.source)} › ${Option.getOrElse(capture.name, () => partDescription(capture.part))} (${capture.variant.mode})`,
        file: shot.length === 1 ? shot[0]!.file : sheetFileFromKey({ dir: session.dir, key }),
        sizes,
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

/** A sheet as drawn: column headers, then rows of a label and its cells. */
export interface SheetGrid {
  readonly columns: ReadonlyArray<string>
  readonly rows: ReadonlyArray<SheetRow>
}

/** One size keeps labels side by side (C11); several put labels in rows, sizes in columns (E20). */
export const sheetGridFromSheet = (sheet: EvidenceSheet): SheetGrid => {
  if (sheet.sizes.length === 1) {
    return {
      columns: sheet.rows.map((row) => labelDisplayName(row.label)),
      rows: [{ label: sizeDescription(sheet.sizes[0]!), cells: sheet.rows.map((row) => row.cells[0]!) }],
    }
  }

  return {
    columns: sheet.sizes.map(sizeDescription),
    rows: sheet.rows.map((row) => ({ label: labelDisplayName(row.label), cells: row.cells })),
  }
}

const cellNote = (cell: EvidenceCell): string =>
  Match.valueTags(cell, { ShotCell: () => '', FailedCell: () => ' (failed)', MissingCell: () => ' (not shot)' })

/** `before | after (failed)`; with sizes `before, after × iPhone 15 | 1440×900`. */
const sheetHeader = (sheet: EvidenceSheet): string => {
  if (sheet.sizes.length === 1) {
    return sheet.rows.map((row) => `${labelDisplayName(row.label)}${cellNote(row.cells[0]!)}`).join(' | ')
  }

  return `${sheet.rows.map((row) => labelDisplayName(row.label)).join(', ')} × ${sheet.sizes.map(sizeDescription).join(' | ')}`
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

/** The report as markdown; images and videos by their project-relative paths, which `gh --attach` replaces. */
export const evidenceMarkdownFromReport = (report: EvidenceReport): string => {
  const lines: Array<string> = ['## Shot evidence', '']
  lines.push(
    `${plural(report.summary.captures, 'capture')}, ${plural(report.flows.length, 'flow')}; ${plural(report.summary.errors, 'error')}, ${plural(report.summary.warnings, 'warning')}.`,
    '',
  )

  for (const sheet of report.sheets) {
    lines.push(`**${sheet.title}** · ${sheetHeader(sheet)}`, '', `![${sheet.key}](${sheet.file})`, '')
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
