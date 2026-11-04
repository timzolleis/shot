import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'

import type { SessionLabel } from '../src/artifact/session.ts'
import { RouteSource } from '../src/capture/domain/capture.ts'
import { captureKey } from '../src/capture/domain/capture-key.ts'
import { defaultShootFlags, planCapturesFromFlags } from '../src/capture/domain/capture-plan.ts'
import { CapturedResult, type CaptureResult, FailedCaptureResult } from '../src/capture/domain/capture-result.ts'
import { type Finding, findingsNewSinceBase } from '../src/capture/domain/finding.ts'
import { findingLines, findingsReportAgainstBase, isFailingReport, summaryLine } from '../src/cli/output.ts'

const finding = (check: string, message: string, severity: Finding['severity'] = 'warn'): Finding => ({
  check,
  severity,
  message,
  selector: '#a',
  rect: Option.none(),
})

const capture = Result.getOrThrow(
  planCapturesFromFlags({
    source: RouteSource.make({ path: '/app', user: 'admin@example.org', params: {} }),
    flags: defaultShootFlags,
  }),
)[0]!

const shot = ({ findings, checked }: { readonly findings: ReadonlyArray<Finding>; readonly checked: boolean }) =>
  CapturedResult.make({ capture, key: captureKey(capture), file: 'x.png', measurements: null, findings, checked })

const before = (results: ReadonlyArray<CaptureResult>): SessionLabel => ({
  label: 'before',
  captures: results,
  flows: [],
})

const messages = (results: ReadonlyArray<CaptureResult>) =>
  results.flatMap((result) => result.findings.map((f) => f.message))

describe('findingsNewSinceBase', () => {
  it('a finding the base has, with another repeat count → not new', () => {
    const fresh = findingsNewSinceBase({
      findings: [finding('target', 'under 44×44 (×10)'), finding('align', 'edges 2px apart')],
      base: [finding('target', 'under 44×44 (×9)')],
    })

    expect(fresh.findings.map((item) => item.message)).toEqual(['edges 2px apart'])
    expect(fresh.inBase).toBe(1)
  })

  it('render findings stay, even when the base failed the same way', () => {
    const render = finding('render', 'redirected to /login', 'error')
    expect(findingsNewSinceBase({ findings: [render], base: [render] }).findings).toEqual([render])
  })
})

describe('findingsReportAgainstBase', () => {
  const old = finding('target', 'under 24×24', 'error')
  const fresh = finding('overflow', 'text overflows by 5px')

  it('checked base → only new findings; a pre-existing error no longer fails the run', () => {
    const report = findingsReportAgainstBase({
      results: [shot({ findings: [old, fresh], checked: true })],
      base: before([shot({ findings: [old], checked: true })]),
    })

    expect(messages(report.results)).toEqual(['text overflows by 5px'])
    expect(report.inBase).toBe(1)
    expect(isFailingReport({ report, strict: true })).toBe(false)
  })

  it('base shot without --check → nothing compared, and it says so', () => {
    const report = findingsReportAgainstBase({
      results: [shot({ findings: [old], checked: true })],
      base: before([shot({ findings: [], checked: false })]),
    })

    expect(messages(report.results)).toEqual(['under 24×24'])
    expect(report.baseUnchecked).toBe(true)
    expect(isFailingReport({ report, strict: true })).toBe(true)
  })

  it('an error finding fails the run only with --strict', () => {
    const report = findingsReportAgainstBase({ results: [shot({ findings: [old], checked: true })], base: undefined })

    expect(isFailingReport({ report, strict: false })).toBe(false)
    expect(isFailingReport({ report, strict: true })).toBe(true)
  })

  it('no base, or a failed capture → unchanged; a failed capture fails the run', () => {
    const failed = FailedCaptureResult.make({ capture, key: captureKey(capture), findings: [] })
    const report = findingsReportAgainstBase({ results: [failed], base: undefined })

    expect(report).toEqual({ results: [failed], inBase: 0, baseUnchecked: false })
    expect(isFailingReport({ report, strict: false })).toBe(true)
  })
})

describe('findingLines', () => {
  it('one source and size → the part only, with severity for hiding warnings', () => {
    expect(findingLines([shot({ findings: [finding('align', 'edges 2px apart')], checked: true })])).toEqual([
      { severity: 'warn', line: 'warn align page: edges 2px apart (#a)' },
    ])
  })
})

describe('summaryLine', () => {
  it('counts captures, failures, findings, the base and hidden warnings in one line', () => {
    const failed = FailedCaptureResult.make({ capture, key: captureKey(capture), findings: [] })

    const report = findingsReportAgainstBase({
      results: [
        shot({ findings: [finding('target', 'under 24×24', 'error'), finding('align', 'off')], checked: true }),
        failed,
      ],
      base: before([shot({ findings: [finding('align', 'off')], checked: true })]),
    })

    expect(summaryLine({ report, base: 'before', lines: [{ severity: 'error' }], hiddenWarnings: 2 })).toBe(
      'shot: 1 capture · 1 failed · 1 finding (1 error) · 1 also in before · 2 warnings hidden (--warnings lists them)',
    )
  })

  it('a clean run still ends with the line', () => {
    const report = findingsReportAgainstBase({ results: [shot({ findings: [], checked: true })], base: undefined })

    expect(summaryLine({ report, base: 'before', lines: [], hiddenWarnings: 0 })).toBe(
      'shot: 1 capture · 0 failed · 0 findings (0 errors)',
    )
  })
})
