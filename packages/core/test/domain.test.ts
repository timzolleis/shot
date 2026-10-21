import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'

import { userFromAlias } from '../src/app/app-user.ts'
import { captureFileFromKey } from '../src/artifact/session.ts'
import type { Session } from '../src/artifact/session.ts'
import { type Capture, Click, Focus, Key, RouteSource, Section } from '../src/capture/domain/capture.ts'
import { captureKey } from '../src/capture/domain/capture-key.ts'
import { defaultShootFlags, planCapturesFromFlags, planDefaultCaptures } from '../src/capture/domain/capture-plan.ts'
import { CapturedResult, type CaptureResult } from '../src/capture/domain/capture-result.ts'
import { evidenceReportFromSession } from '../src/evidence/domain/evidence-report.ts'
import { evidenceEndMarker, evidenceStartMarker, prBodyWithEvidence } from '../src/evidence/domain/pr-body.ts'
import { megabyte, videoEncodingForBudget } from '../src/evidence/domain/video-budget.ts'

const persons = RouteSource.make({ path: '/app/persons', user: 'admin@example.org', params: {} })

const failureTag = (result: Result.Result<unknown, { readonly _tag: string }>) =>
  Result.isFailure(result) ? result.failure._tag : 'ok'

const onlyCapture = (flags: typeof defaultShootFlags): Capture => {
  const plan = Result.getOrThrow(planCapturesFromFlags({ source: persons, flags }))
  expect(plan).toHaveLength(1)

  return plan[0]!
}

describe('captureKey', () => {
  it('same capture planned twice → same key (2)', () => {
    const flags = { ...defaultShootFlags, modes: ['dark' as const] }
    expect(captureKey(onlyCapture(flags))).toBe(captureKey(onlyCapture(flags)))
    expect(captureKey(onlyCapture(flags))).toMatch(/^route-app-persons--admin-dark-[0-9a-f]{6}$/)
  })

  it('a different variant → a different key', () => {
    expect(captureKey(onlyCapture(defaultShootFlags))).not.toBe(
      captureKey(onlyCapture({ ...defaultShootFlags, modes: ['dark'] })),
    )
  })

  it('same capture, labels before and after → same key, two paths (6)', () => {
    const key = captureKey(onlyCapture(defaultShootFlags))
    const before = captureFileFromKey({ sessionDir: '.shots/s', label: 'before', key, extension: 'png' })
    const after = captureFileFromKey({ sessionDir: '.shots/s', label: 'after', key, extension: 'png' })
    expect(before).toBe(`.shots/s/before/${key}.png`)
    expect(after).toBe(`.shots/s/after/${key}.png`)
  })
})

describe('planCapturesFromFlags', () => {
  const frames = Option.some({ count: 4, everyMs: 50, slow: 1 })
  const measure = Option.some({ styles: [], all: false })
  it.each([
    { name: '--frames and --measure', flags: { ...defaultShootFlags, frames, measure }, expected: 'ConflictingOutputsError' },
    { name: '--aria and --overlay', flags: { ...defaultShootFlags, aria: true, overlays: ['boxes' as const] }, expected: 'ConflictingOutputsError' },
    { name: '--frames alone', flags: { ...defaultShootFlags, frames }, expected: 'ok' },
  ])('$name → $expected', ({ flags, expected }) => {
    expect(failureTag(planCapturesFromFlags({ source: persons, flags }))).toBe(expected)
  })

  it('hover, focus and press run after the other steps', () => {
    const capture = onlyCapture({
      ...defaultShootFlags,
      steps: [
        Focus.make({ selector: '#a' }),
        Click.make({ selector: '#b' }),
        Key.make({ key: 'Enter' }),
      ],
    })

    expect(capture.scene.map((step) => step._tag)).toEqual(['Click', 'Key', 'Focus'])
  })
})

describe('planDefaultCaptures', () => {
  it('one still per section; repeated titles get nth', () => {
    const plan = planDefaultCaptures({ source: persons, flags: defaultShootFlags, sections: ['Profile', 'Sizes', 'Sizes'] })
    expect(plan.map((capture) => capture.part)).toEqual([
      Section.make({ title: 'Profile', nth: Option.none() }),
      Section.make({ title: 'Sizes', nth: Option.some(0) }),
      Section.make({ title: 'Sizes', nth: Option.some(1) }),
    ])
  })
})

describe('videoEncodingForBudget (9)', () => {
  const recording = { file: 'invite-parent.mp4', durationMs: 42_000, width: 1280, height: 900 }
  it('fits → native width, no bitrate cap', () => {
    expect(Result.getOrThrow(videoEncodingForBudget({ ...recording, bytes: 4 * megabyte, limitBytes: 10 * megabyte }))).toEqual({
      width: 1280,
      bitrate: undefined,
    })
  })
  it('31 MB at 1280 wide, limit 10 MB → 960 wide', () => {
    const encoding = Result.getOrThrow(videoEncodingForBudget({ ...recording, bytes: 31 * megabyte, limitBytes: 10 * megabyte }))
    expect(encoding.width).toBe(960)
    expect((encoding.bitrate! * 42) / 8).toBeLessThan(10 * megabyte)
  })
  it('no resolution reaches the limit → VideoTooLargeError', () => {
    expect(
      failureTag(videoEncodingForBudget({ ...recording, durationMs: 20 * 60_000, bytes: 400 * megabyte, limitBytes: 10 * megabyte })),
    ).toBe('VideoTooLargeError')
  })
})

describe('prBodyWithEvidence (12)', () => {
  it('body without markers → section appended', () => {
    expect(prBodyWithEvidence({ body: 'Fixes the list.', evidenceMarkdown: 'A' })).toBe(
      `Fixes the list.\n\n${evidenceStartMarker}\nA\n${evidenceEndMarker}\n`,
    )
  })
  it('with markers → only the section replaced', () => {
    const body = `Intro\n\n${evidenceStartMarker}\nold\n${evidenceEndMarker}\n\nOutro`
    expect(prBodyWithEvidence({ body, evidenceMarkdown: 'new' })).toBe(
      `Intro\n\n${evidenceStartMarker}\nnew\n${evidenceEndMarker}\n\nOutro`,
    )
  })
})

describe('evidenceReportFromSession (11)', () => {
  it('same capture key under before and after → one sheet, two columns', () => {
    const capture = onlyCapture(defaultShootFlags)
    const key = captureKey(capture)

    const captured = (label: string): CaptureResult =>
      CapturedResult.make({ capture, key, file: `.shots/s/${label}/${key}.png`, measurements: null, findings: [] })

    const session: Session = {
      name: 's',
      dir: '.shots/s',
      labels: [
        { label: 'before', captures: [captured('before')], flows: [] },
        { label: 'after', captures: [captured('after')], flows: [] },
      ],
    }

    const report = evidenceReportFromSession(session)
    expect(report.sheets).toHaveLength(1)
    expect(report.sheets[0]!.columns.map((column) => column.label)).toEqual(['before', 'after'])
    expect(report.sheets[0]!.file).toBe(`.shots/s/report/${key}.png`)
  })
})

describe('userFromAlias (15)', () => {
  it.each([
    { as: 'admin', expected: 'admin@example.org' },
    { as: 'parent@example.org', expected: 'parent@example.org' },
  ])('--as $as → $expected', ({ as, expected }) => {
    expect(userFromAlias({ as, users: { admin: 'admin@example.org' } })).toBe(expected)
  })
})
