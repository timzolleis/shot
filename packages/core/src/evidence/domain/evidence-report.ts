import { Option } from 'effect'

import type { Session } from '../../artifact/session.ts'
import { labelDisplayName } from '../../artifact/session.ts'
import { partDescription, sourceDescription } from '../../capture/domain/capture-key.ts'
import type { Finding } from '../../capture/domain/finding.ts'
import type { FlowStill } from '../../flow/domain/flow.ts'

/** One column of a sheet: a label and its still, if that label shot the capture. */
export interface SheetColumn {
  readonly label: string
  readonly still: Option.Option<string>
}

/**
 * One capture key across labels (C11). `file` is the image to show: the still when one label has it, else the sheet
 * composed of every label's still. A label whose capture failed keeps its column, without a still.
 */
export interface EvidenceSheet {
  readonly key: string
  readonly title: string
  readonly file: string
  readonly columns: ReadonlyArray<SheetColumn>
}

export interface EvidenceFlow {
  readonly label: string
  readonly name: string
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
  readonly summary: { readonly captures: number; readonly flows: number; readonly errors: number; readonly warnings: number }
}

/** Composed sheets live next to the report. */
export const sheetFileFromKey = ({ dir, key }: { readonly dir: string; readonly key: string }): string =>
  `${dir}/report/${key}.png`

/** Stills grouped by capture key, one column per label in session order; findings and flows per label (C11). */
export const evidenceReportFromSession = (session: Session): EvidenceReport => {
  const keys = [
    ...new Set(
      session.labels.flatMap((entry) =>
        entry.captures.filter((result) => result.capture.output._tag === 'Still').map((result) => result.key),
      ),
    ),
  ]
  const sheets = keys.flatMap((key): ReadonlyArray<EvidenceSheet> => {
    const results = session.labels.flatMap((entry) => entry.captures.filter((result) => result.key === key))
    const capture = results[0]!.capture
    const columns = session.labels
      .filter((entry) => entry.captures.some((result) => result.key === key))
      .map(
        (entry): SheetColumn => {
          const result = entry.captures.find((candidate) => candidate.key === key)
          return {
            label: entry.label,
            still: result?._tag === 'CapturedResult' ? Option.some(result.file) : Option.none(),
          }
        },
      )
    const stills = columns.flatMap((column) => Option.toArray(column.still))
    if (stills.length === 0) return []
    return [
      {
        key,
        title: `${sourceDescription(capture.source)} › ${Option.getOrElse(capture.name, () => partDescription(capture.part))} (${capture.variant.mode})`,
        file: stills.length === 1 ? stills[0]! : sheetFileFromKey({ dir: session.dir, key }),
        columns,
      },
    ]
  })
  const flows = session.labels.flatMap((entry) =>
    entry.flows.map(
      (flow): EvidenceFlow => ({
        label: entry.label,
        name: flow.flow.name,
        video: flow.video,
        stills: flow.stills,
        stoppedAt:
          flow._tag === 'StoppedFlow' ? Option.some({ step: flow.failedStep, reason: flow.reason }) : Option.none(),
      }),
    ),
  )
  const findings = session.labels
    .map(
      (entry): EvidenceFindings => ({
        label: entry.label,
        findings: [
          ...entry.captures.flatMap((result) =>
            result.findings.map((finding) => ({
              subject: `${sourceDescription(result.capture.source)} › ${partDescription(result.capture.part)} (${result.capture.variant.mode})`,
              finding,
            })),
          ),
          ...entry.flows.flatMap((flow) =>
            flow._tag === 'StoppedFlow'
              ? [
                  {
                    subject: `flow ${flow.flow.name}`,
                    finding: {
                      check: 'flow',
                      severity: 'error' as const,
                      message: `step ${flow.failedStep}: ${flow.reason}`,
                      selector: '',
                      rect: Option.none(),
                    },
                  },
                ]
              : [],
          ),
        ],
      }),
    )
    .filter((group) => group.findings.length > 0)
  const all = findings.flatMap((group) => group.findings)
  return {
    session: session.name,
    sheets,
    flows,
    findings,
    summary: {
      captures: keys.length,
      flows: flows.length,
      errors: all.filter(({ finding }) => finding.severity === 'error').length,
      warnings: all.filter(({ finding }) => finding.severity === 'warn').length,
    },
  }
}

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

/** The report as markdown; images and videos by their project-relative paths, which `gh --attach` replaces. */
export const evidenceMarkdownFromReport = (report: EvidenceReport): string => {
  const lines: Array<string> = ['## Shot evidence', '']
  lines.push(
    `${plural(report.sheets.length, 'capture')}, ${plural(report.flows.length, 'flow')}; ${plural(report.summary.errors, 'error')}, ${plural(report.summary.warnings, 'warning')}.`,
    '',
  )
  for (const sheet of report.sheets) {
    const header = sheet.columns
      .map((column) => `${labelDisplayName(column.label)}${Option.isNone(column.still) ? ' (failed)' : ''}`)
      .join(' | ')
    lines.push(`**${sheet.title}** · ${header}`, '', `![${sheet.key}](${sheet.file})`, '')
  }
  for (const flow of report.flows) {
    const outcome = Option.match(flow.stoppedAt, {
      onNone: () => `${plural(flow.stills.length, 'step')} passed`,
      onSome: ({ step, reason }) => `stopped at ${step}: ${reason}`,
    })
    lines.push(`**Flow ${flow.name}** (${labelDisplayName(flow.label)}) · ${outcome}`, '', flow.video, '')
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
