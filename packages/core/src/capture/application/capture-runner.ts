import { Context, Effect, Layer, Match, Option, type Schema } from 'effect'
import type { Locator } from 'playwright'

import type { AppHookFailedError, AppHookMissingError, AppNotRunningError, SessionLockTimeoutError } from '../../app/app-error.ts'
import { ArtifactStore } from '../../artifact/artifact-store.ts'
import { CaptureChecks } from '../../checks/capture-checks.ts'
import { fitContent, type ReadyPage, runStep, settlePage } from '../../infrastructure/page-lifecycle.ts'
import { type OutlineEntry, PageRuntime } from '../../infrastructure/page-runtime.ts'
import { cropPng, paddedRect, pngSize } from '../../infrastructure/png.ts'
import { Sheets } from '../../infrastructure/sheets.ts'
import type { Capture, Plan, Rect, Source, Variant } from '../domain/capture.ts'
import type { CaptureFailure } from '../domain/capture-error.ts'
import { SelectionNotFoundError } from '../domain/capture-error.ts'
import { reasonFromCaptureFailure } from '../domain/capture-failure-reason.ts'
import {
  captureFileExtension,
  captureGroupKey,
  captureKey,
  captureSlug,
  partDescription,
  sourceDescription,
} from '../domain/capture-key.ts'
import type { CaptureResult } from '../domain/capture-result.ts'
import { collapsedFindings, consoleFindingsFromErrors, type Finding, renderFindingFromReason } from '../domain/finding.ts'
import { type OpenSourceError, SourceProviders } from './source-providers.ts'

/** Errors that end the whole run, not one capture: the app or its hooks. */
export type RunPlanError = AppHookMissingError | AppHookFailedError | AppNotRunningError | SessionLockTimeoutError

export class CaptureRunner extends Context.Service<
  CaptureRunner,
  {
    /** Groups four at a time; results in plan order. */
    runPlan(input: {
      readonly plan: Plan
      readonly label: string
      readonly runChecks: boolean
    }): Effect.Effect<ReadonlyArray<CaptureResult>, RunPlanError>
    /** Loads the source once and reads its sections. */
    readOutline(input: { readonly source: Source; readonly variant: Variant }): Effect.Effect<ReadonlyArray<OutlineEntry>, OpenSourceError>
  }
>()('shot/CaptureRunner') {}

const groupConcurrency = 4
const tallWarningPx = 2000

interface Produced {
  readonly content: Uint8Array | string
  readonly measurements: unknown
  readonly findings: ReadonlyArray<Finding>
}

export const isRunPlanError = (error: OpenSourceError): error is RunPlanError =>
  error._tag === 'AppHookMissingError' ||
  error._tag === 'AppHookFailedError' ||
  error._tag === 'AppNotRunningError' ||
  error._tag === 'SessionLockTimeoutError'

export const CaptureRunnerLayer = Layer.effect(
  CaptureRunner,
  Effect.gen(function* () {
    const providers = yield* SourceProviders
    const runtime = yield* PageRuntime
    const checks = yield* CaptureChecks
    const store = yield* ArtifactStore
    const sheets = yield* Sheets

    const still = (ready: ReadyPage, capture: Capture, runChecks: boolean, output: Extract<Capture['output'], { _tag: 'Still' }>) =>
      Effect.gen(function* () {
        const { page } = ready
        const resolved = yield* runtime.resolvePart({ page, part: capture.part, all: false })
        const findings = runChecks ? yield* checks.runCaptureChecks({ page: ready, capture, roots: resolved.roots }) : []
        const measurements =
          output.overlays.length === 0 ? undefined : yield* runtime.drawOverlays({ roots: resolved.roots, overlays: output.overlays })
        // Infinite animations cancel to their start: CSS and WAAPI through Playwright, SVG SMIL paused at 0 here.
        yield* Effect.promise(() =>
          page.evaluate(() => {
            for (const svg of document.querySelectorAll('svg')) {
              svg.pauseAnimations()
              svg.setCurrentTime(0)
            }
          }),
        )
        const screenshot = yield* Effect.promise(() =>
          page.screenshot({
            animations: 'disabled',
            ...Option.match(resolved.clip, {
              onNone: () => ({ fullPage: capture.part._tag === 'WholePage' }),
              onSome: (clip) => ({ fullPage: true, clip }),
            }),
          }),
        )
        if (output.overlays.length > 0) yield* runtime.clearOverlays(page)
        const png = yield* Option.match(output.loupe, {
          onNone: () => Effect.succeed(new Uint8Array(screenshot)),
          onSome: (factor) => sheets.loupe({ png: new Uint8Array(screenshot), factor }),
        })
        return { content: png, measurements, findings } satisfies Produced
      })

    /**
     * The scene's last step starts the clock; frames are viewport screenshots every `everyMs` of animation time, slowed
     * by `slow`. A section or selection is located in every frame; all frames are cropped to where it was.
     */
    const frames = (ready: ReadyPage, capture: Capture, output: Extract<Capture['output'], { _tag: 'Frames' }>) =>
      Effect.gen(function* () {
        const { page, context } = ready
        const { count, everyMs, slow } = output
        const part = capture.part
        const locator: Locator | undefined =
          part._tag === 'Section'
            ? (yield* runtime.resolvePart({ page, part, all: false })).roots[0]
            : part._tag === 'Selected'
              ? page.locator(part.selector).filter({ visible: true }).first()
              : undefined
        const last = capture.scene.at(-1)
        const shots = yield* Effect.promise(async () => {
          await locator?.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined)
          const cdp = await context.newCDPSession(page)
          await cdp.send('Animation.enable')
          await cdp.send('Animation.setPlaybackRate', { playbackRate: slow })
          await page.evaluate((rate) => (window as unknown as { __shotSetSlow?: (rate: number) => void }).__shotSetSlow?.(rate), slow)
          return { cdp }
        })
        if (last !== undefined) yield* runStep({ page, step: last })
        const taken = yield* Effect.promise(async () => {
          const start = Date.now()
          const list: Array<{ png: Uint8Array; ms: number }> = []
          const rects: Array<Rect> = []
          for (let index = 0; index < count; index++) {
            const due = start + (index * everyMs) / slow
            if (due > Date.now()) await new Promise((resolve) => setTimeout(resolve, due - Date.now()))
            const ms = Math.round((Date.now() - start) * slow)
            const [png, box] = await Promise.all([
              page.screenshot({ fullPage: false }),
              // No waiting: a part that is not there yet is simply not in this frame.
              locator === undefined
                ? undefined
                : locator.count().then((found) => (found === 0 ? null : locator.boundingBox({ timeout: 200 }).catch(() => null))),
            ])
            list.push({ png: new Uint8Array(png), ms })
            if (box !== null && box !== undefined && box.width > 0) rects.push(box)
          }
          await shots.cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
          return { list, rects }
        })
        if (locator !== undefined && taken.rects.length === 0) {
          return yield* new SelectionNotFoundError({
            selector: partDescription(part),
            reason: `never appeared during the ${count} frames`,
          })
        }
        const viewport = page.viewportSize() ?? { width: 1280, height: 900 }
        const rects = taken.rects
        const area =
          rects.length === 0
            ? undefined
            : paddedRect({
                rect: {
                  x: Math.min(...rects.map((rect) => rect.x)),
                  y: Math.min(...rects.map((rect) => rect.y)),
                  width: Math.max(...rects.map((rect) => rect.x + rect.width)) - Math.min(...rects.map((rect) => rect.x)),
                  height: Math.max(...rects.map((rect) => rect.y + rect.height)) - Math.min(...rects.map((rect) => rect.y)),
                },
                bounds: viewport,
              })
        const scale = capture.variant.scale
        const cells = taken.list.map(({ png, ms }, index) => ({
          png:
            area === undefined
              ? png
              : cropPng({
                  png,
                  rect: { x: area.x * scale, y: area.y * scale, width: area.width * scale, height: area.height * scale },
                }),
          label: `${index + 1} · ${ms}ms`,
        }))
        const sheet = yield* sheets.composeSheet({
          cells,
          title: `${sourceDescription(capture.source)} ${captureSlug(capture)} (every ${everyMs}ms, slow ${slow})`,
        })
        const measurements = { area, frames: taken.list.map(({ ms }, index) => ({ index: index + 1, ms })) }
        return { content: sheet, measurements, findings: [] } satisfies Produced
      })

    const produce = (ready: ReadyPage, capture: Capture, runChecks: boolean) =>
      Effect.gen(function* () {
        // Apps that scroll inside a shell: grow the viewport to the content, except for a viewport shot or frames.
        yield* fitContent({ page: ready.page, expand: capture.part._tag !== 'Viewport' && capture.output._tag !== 'Frames' })
        const output = capture.output
        return yield* Match.valueTags(output, {
          Still: (still_) => still(ready, capture, runChecks, still_),
          Frames: (frames_) => frames(ready, capture, frames_),
          Measure: ({ styles, all }) =>
            Effect.gen(function* () {
              const resolved = yield* runtime.resolvePart({ page: ready.page, part: capture.part, all })
              const data = yield* runtime.measureElements({ roots: resolved.roots, styles })
              return { content: JSON.stringify(data, null, 2), measurements: data, findings: [] } satisfies Produced
            }),
          AriaTree: () =>
            Effect.gen(function* () {
              const resolved = yield* runtime.resolvePart({ page: ready.page, part: capture.part, all: false })
              const snapshots = yield* Effect.promise(() => Promise.all(resolved.roots.map((root) => root.ariaSnapshot())))
              return { content: `${snapshots.join('\n\n')}\n`, measurements: undefined, findings: [] } satisfies Produced
            }),
        })
      })

    const failedResult = (capture: Capture, findings: ReadonlyArray<Finding>): CaptureResult => ({
      _tag: 'FailedCaptureResult',
      capture,
      key: captureKey(capture),
      findings,
    })

    const runGroup = (captures: ReadonlyArray<Capture>, label: string, runChecks: boolean) =>
      Effect.scoped(
        Effect.gen(function* () {
          const first = captures[0]!
          const isFrames = first.output._tag === 'Frames'
          const opened = yield* providers
            .openSource({
              source: first.source,
              variant: first.variant,
              options: { settle: !isFrames || first.scene.length > 1, slowClock: isFrames, recordVideoDir: Option.none() },
            })
            .pipe(Effect.result)
          if (opened._tag === 'Failure') {
            const error = opened.failure
            if (isRunPlanError(error)) return yield* error
            return captures.map((capture) => failedResult(capture, [renderFindingFromReason(reasonFromCaptureFailure(error))]))
          }
          const ready = opened.success
          if (first.scene.some((step) => step._tag === 'Press')) {
            yield* Effect.addFinalizer(() => Effect.promise(() => ready.page.mouse.up().catch(() => undefined)))
          }
          const scene = isFrames ? first.scene.slice(0, -1) : first.scene
          const sceneRun = yield* Effect.forEach(scene, (step) =>
            runStep({ page: ready.page, step }).pipe(Effect.andThen(settlePage(ready.page))),
          ).pipe(Effect.result)
          if (sceneRun._tag === 'Failure') {
            return captures.map((capture) =>
              failedResult(capture, [
                ...consoleFindingsFromErrors(ready.consoleErrors),
                renderFindingFromReason(reasonFromCaptureFailure(sceneRun.failure)),
              ]),
            )
          }
          return yield* Effect.forEach(captures, (capture, index) =>
            Effect.gen(function* () {
              const key = captureKey(capture)
              const produced = yield* produce(ready, capture, runChecks).pipe(Effect.result)
              if (produced._tag === 'Failure') {
                return failedResult(capture, [renderFindingFromReason(reasonFromCaptureFailure(produced.failure as CaptureFailure))])
              }
              const extension = captureFileExtension(capture.output)
              const { content, measurements, findings } = produced.success
              const file = yield* store.writeCaptureFile({ label, key, extension, content, measurements })
              if (typeof content !== 'string') {
                const { width, height } = pngSize(content)
                if (height > tallWarningPx) {
                  process.stderr.write(`warning: ${file} is ${width}×${height}px; reads downscale it. Shoot a --section or --select.\n`)
                }
              }
              return {
                _tag: 'CapturedResult',
                capture,
                key,
                file,
                measurements: (measurements ?? null) as Schema.Json,
                // Console errors belong to the page load: reported once, on its first capture.
                findings: index === 0 ? collapsedFindings([...consoleFindingsFromErrors(ready.consoleErrors), ...findings]) : findings,
              } satisfies CaptureResult
            }),
          )
        }),
      )

    return CaptureRunner.of({
      runPlan: Effect.fn('CaptureRunner.runPlan')(function* ({ plan, label, runChecks }) {
        const groups = new Map<string, Array<Capture>>()
        for (const capture of plan) {
          const id = captureGroupKey(capture)
          groups.set(id, [...(groups.get(id) ?? []), capture])
        }
        let done = 0
        const results = yield* Effect.forEach(
          [...groups.values()],
          (group) =>
            runGroup(group, label, runChecks).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  done++
                  if (groups.size > 1) {
                    process.stderr.write(`[${done}/${groups.size}] ${sourceDescription(group[0]!.source)} ${group[0]!.variant.mode}\n`)
                  }
                }),
              ),
            ),
          { concurrency: groupConcurrency },
        )
        const byKey = new Map(results.flat().map((result) => [result.key, result]))
        return plan.map((capture) => byKey.get(captureKey(capture))!)
      }),
      readOutline: Effect.fn('CaptureRunner.readOutline')(function* ({ source, variant }) {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const ready = yield* providers.openSource({
              source,
              variant,
              options: { settle: false, slowClock: false, recordVideoDir: Option.none() },
            })
            return yield* runtime.readOutline(ready.page)
          }),
        )
      }),
    })

  }),
)
