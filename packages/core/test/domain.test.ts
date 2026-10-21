import { describe, expect, it } from '@effect/vitest'
import { Option, Predicate, Result } from 'effect'

import { userFromAlias } from '../src/app/app-user.ts'
import { captureFileFromKey } from '../src/artifact/session.ts'
import type { Session } from '../src/artifact/session.ts'
import { type Capture, Click, Focus, Key, RouteSource, Section } from '../src/capture/domain/capture.ts'
import { captureKey, sheetKey } from '../src/capture/domain/capture-key.ts'
import {
  defaultShootFlags,
  planCapturesFromFlags,
  planDefaultCaptures,
  variantsFromFlags,
} from '../src/capture/domain/capture-plan.ts'
import { CapturedResult, type CaptureResult, FailedCaptureResult } from '../src/capture/domain/capture-result.ts'
import {
  defaultSize,
  DeviceSize,
  ScreenSize,
  type Size,
  sizeAliases,
  sizeDescription,
  sizeFromText,
} from '../src/capture/domain/size.ts'
import { evidenceReportFromSession, sheetGridFromSheet } from '../src/evidence/domain/evidence-report.ts'
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
    expect(captureKey(onlyCapture(flags))).toMatch(/^route-app-persons--admin-1280x900-dark-[0-9a-f]{6}$/)
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
    {
      name: '--frames and --measure',
      flags: { ...defaultShootFlags, frames, measure },
      expected: 'ConflictingOutputsError',
    },
    {
      name: '--aria and --overlay',
      flags: { ...defaultShootFlags, aria: true, overlays: ['boxes' as const] },
      expected: 'ConflictingOutputsError',
    },
    { name: '--frames alone', flags: { ...defaultShootFlags, frames }, expected: 'ok' },
  ])('$name → $expected', ({ flags, expected }) => {
    expect(failureTag(planCapturesFromFlags({ source: persons, flags }))).toBe(expected)
  })

  it('hover, focus and press run after the other steps', () => {
    const capture = onlyCapture({
      ...defaultShootFlags,
      steps: [Focus.make({ selector: '#a' }), Click.make({ selector: '#b' }), Key.make({ key: 'Enter' })],
    })

    expect(capture.scene.map((step) => step._tag)).toEqual(['Click', 'Key', 'Focus'])
  })
})

describe('planDefaultCaptures', () => {
  it('one still per section; repeated titles get nth', () => {
    const plan = planDefaultCaptures({
      source: persons,
      flags: defaultShootFlags,
      outlines: [{ size: defaultSize, sections: ['Profile', 'Sizes', 'Sizes'] }],
    })

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
    expect(
      Result.getOrThrow(videoEncodingForBudget({ ...recording, bytes: 4 * megabyte, limitBytes: 10 * megabyte })),
    ).toEqual({
      width: 1280,
      bitrate: undefined,
    })
  })
  it('31 MB at 1280 wide, limit 10 MB → 960 wide', () => {
    const encoding = Result.getOrThrow(
      videoEncodingForBudget({ ...recording, bytes: 31 * megabyte, limitBytes: 10 * megabyte }),
    )

    expect(encoding.width).toBe(960)
    expect((encoding.bitrate! * 42) / 8).toBeLessThan(10 * megabyte)
  })
  it('no resolution reaches the limit → VideoTooLargeError', () => {
    expect(
      failureTag(
        videoEncodingForBudget({
          ...recording,
          durationMs: 20 * 60_000,
          bytes: 400 * megabyte,
          limitBytes: 10 * megabyte,
        }),
      ),
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
    expect(report.sheets[0]!.rows.map((row) => row.label)).toEqual(['before', 'after'])
    expect(report.sheets[0]!.file).toBe(`.shots/s/report/${sheetKey(capture)}.png`)
  })
})

const devices = [
  { name: 'iPhone 15', width: 393, height: 659 },
  { name: 'iPhone 15 landscape', width: 734, height: 343 },
  { name: 'iPhone 14', width: 390, height: 664 },
  { name: 'iPad Mini', width: 768, height: 1024 },
  { name: 'Pixel 7', width: 412, height: 839 },
]

const phone = sizeAliases.phone
const desktop = sizeAliases.desktop

describe('sizeFromText (16)', () => {
  it.each([
    { text: 'phone', expected: 'iPhone 15' },
    { text: 'iphone 15', expected: 'iPhone 15' },
    { text: 'Tablet', expected: 'iPad Mini' },
    { text: 'desktop', expected: '1440×900' },
    { text: '390x844', expected: '390×844' },
    { text: 'iPhone 15 landscape', expected: 'iPhone 15 landscape' },
  ])('$text → $expected', ({ text, expected }) => {
    expect(sizeDescription(Result.getOrThrow(sizeFromText({ text, devices })))).toBe(expected)
  })

  it.each(['0x844', '390x', 'iphone'])('%s → UnknownSizeError', (text) => {
    expect(failureTag(sizeFromText({ text, devices }))).toBe('UnknownSizeError')
  })

  it('closest leaves out landscape devices', () => {
    const result = sizeFromText({ text: 'iphone', devices })
    expect(Result.isFailure(result) && result.failure.closest).not.toContain('iPhone 15 landscape')
  })
})

describe('sizes in the plan (17, 18)', () => {
  it('sizes [phone, desktop] × modes [light, dark] → 4 variants, size first', () => {
    const variants = variantsFromFlags({ ...defaultShootFlags, sizes: [phone, desktop], modes: ['light', 'dark'] })
    expect(variants.map((variant) => `${sizeDescription(variant.size)} ${variant.mode} ${variant.scale}x`)).toEqual([
      'iPhone 15 light 2x',
      'iPhone 15 dark 2x',
      '1440×900 light 1x',
      '1440×900 dark 1x',
    ])
  })

  it('phone and DeviceSize iPhone 15 → shot once', () => {
    expect(
      variantsFromFlags({
        ...defaultShootFlags,
        sizes: [phone, DeviceSize.make({ device: 'iPhone 15', width: 393, height: 659 })],
      }),
    ).toHaveLength(1)
  })

  it('same capture at phone and desktop → different captureKey, same sheetKey; light and dark → different sheetKey', () => {
    const [atPhone, atDesktop] = Result.getOrThrow(
      planCapturesFromFlags({ source: persons, flags: { ...defaultShootFlags, sizes: [phone, desktop] } }),
    )

    expect(captureKey(atPhone!)).toMatch(/^route-app-persons--admin-iphone-15-light-[0-9a-f]{6}$/)
    expect(captureKey(atDesktop!)).toMatch(/^route-app-persons--admin-1440x900-light-[0-9a-f]{6}$/)
    expect(sheetKey(atPhone!)).toBe(sheetKey(atDesktop!))
    expect(sheetKey(atPhone!)).toMatch(/^route-app-persons--admin-light-[0-9a-f]{6}$/)
    expect(sheetKey(onlyCapture({ ...defaultShootFlags, modes: ['dark'] }))).not.toBe(
      sheetKey(onlyCapture(defaultShootFlags)),
    )
  })

  it('each size shoots its own outline (19)', () => {
    const plan = planDefaultCaptures({
      source: persons,
      flags: defaultShootFlags,
      outlines: [
        { size: phone, sections: ['Filters', 'Persons'] },
        { size: desktop, sections: ['Filters', 'Sidebar', 'Persons'] },
      ],
    })

    expect(
      plan.map(
        (capture) =>
          `${sizeDescription(capture.variant.size)} ${Predicate.isTagged(capture.part, 'Section') ? capture.part.title : ''}`,
      ),
    ).toEqual(['iPhone 15 Filters', 'iPhone 15 Persons', '1440×900 Filters', '1440×900 Sidebar', '1440×900 Persons'])
  })
})

describe('sheets across sizes (20)', () => {
  const atSize = (size: Size, mode: 'light' | 'dark' = 'light') =>
    onlyCapture({ ...defaultShootFlags, sizes: [size], modes: [mode] })

  const captured = ({ label, capture }: { readonly label: string; readonly capture: Capture }): CaptureResult => {
    const key = captureKey(capture)

    return CapturedResult.make({ capture, key, file: `.shots/s/${label}/${key}.png`, measurements: null, findings: [] })
  }

  const failed = (capture: Capture): CaptureResult =>
    FailedCaptureResult.make({ capture, key: captureKey(capture), findings: [] })

  const sessionOf = (labels: Session['labels']): Session => ({ name: 's', dir: '.shots/s', labels })

  const cellTags = (session: Session) =>
    evidenceReportFromSession(session).sheets.map((sheet) => ({
      sizes: sheet.sizes.map(sizeDescription),
      rows: sheet.rows.map((row) => `${row.label}: ${row.cells.map((cell) => cell._tag).join(' ')}`),
    }))

  it('before and after at phone and desktop → 1 sheet, rows [before, after], columns [iPhone 15, 1440×900]', () => {
    const shots = (label: string) => [atSize(phone), atSize(desktop)].map((capture) => captured({ label, capture }))

    const session = sessionOf([
      { label: 'before', captures: shots('before'), flows: [] },
      { label: 'after', captures: shots('after'), flows: [] },
    ])

    expect(cellTags(session)).toEqual([
      { sizes: ['iPhone 15', '1440×900'], rows: ['before: ShotCell ShotCell', 'after: ShotCell ShotCell'] },
    ])

    const report = evidenceReportFromSession(session)
    expect(report.summary.captures).toBe(2)
    expect(sheetGridFromSheet(report.sheets[0]!).columns).toEqual(['iPhone 15', '1440×900'])
  })

  it('before at desktop only, after phone failed → MissingCell and FailedCell', () => {
    const session = sessionOf([
      { label: 'before', captures: [captured({ label: 'before', capture: atSize(desktop) })], flows: [] },
      {
        label: 'after',
        captures: [failed(atSize(phone)), captured({ label: 'after', capture: atSize(desktop) })],
        flows: [],
      },
    ])

    expect(cellTags(session)).toEqual([
      { sizes: ['iPhone 15', '1440×900'], rows: ['before: MissingCell ShotCell', 'after: FailedCell ShotCell'] },
    ])
  })

  it('one size, before and after → labels side by side, as before sizes', () => {
    const session = sessionOf([
      { label: 'before', captures: [captured({ label: 'before', capture: atSize(defaultSize) })], flows: [] },
      { label: 'after', captures: [captured({ label: 'after', capture: atSize(defaultSize) })], flows: [] },
    ])

    const grid = sheetGridFromSheet(evidenceReportFromSession(session).sheets[0]!)
    expect(grid.columns).toEqual(['before', 'after'])
    expect(grid.rows.map((row) => row.label)).toEqual(['1280×900'])
  })

  it('light and dark at phone → 2 sheets', () => {
    const session = sessionOf([
      {
        label: '',
        captures: [atSize(phone), atSize(phone, 'dark')].map((capture) => captured({ label: '', capture })),
        flows: [],
      },
    ])

    expect(evidenceReportFromSession(session).sheets).toHaveLength(2)
  })

  it('a 1440×900 still is drawn at scale 1, an iPhone 15 still at 2', () => {
    const session = sessionOf([
      {
        label: '',
        captures: [atSize(phone), atSize(ScreenSize.make({ width: 1440, height: 900 }))].map((capture) =>
          captured({ label: '', capture }),
        ),
        flows: [],
      },
    ])

    expect(
      evidenceReportFromSession(session).sheets[0]!.rows[0]!.cells.map((cell) =>
        Predicate.isTagged(cell, 'ShotCell') ? cell.scale : 0,
      ),
    ).toEqual([2, 1])
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
