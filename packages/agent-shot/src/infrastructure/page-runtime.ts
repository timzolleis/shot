import type { RuntimeFinding } from '../runtime/index.ts'
import { pageRuntimeEntry } from '../runtime/index.ts'
import { Context, Effect, Layer, Match, Option, Schema } from 'effect'
import { build } from 'esbuild'
import type { Locator, Page } from 'playwright'

import type { Overlay, Part, Rect, Selected } from '../capture/domain/capture.ts'
import { AmbiguousSectionError, SectionNotFoundError, SelectionNotFoundError } from '../capture/domain/capture-error.ts'
import { partDescription } from '../capture/domain/capture-key.ts'
import { sectionFromTitle } from '../capture/domain/capture-plan.ts'
import type { Finding } from '../capture/domain/finding.ts'

export interface OutlineEntry {
  readonly title: string
  readonly depth: number
}

/** Where a part is: the page area to screenshot (padded), and the elements overlays, measurements and checks run on. */
export interface ResolvedPart {
  readonly clip: Option.Option<Rect>
  readonly roots: ReadonlyArray<Locator>
}

/** Indented by nesting. */
export const outlineText = (entries: ReadonlyArray<OutlineEntry>): string =>
  entries.map((entry) => `${'  '.repeat(entry.depth)}${entry.title}`).join('\n')

/** The bundled in-page runtime (`src/runtime`) and the calls into it. */
export class PageRuntime extends Context.Service<
  PageRuntime,
  {
    injectRuntime(page: Page): Effect.Effect<void>
    readOutline(page: Page): Effect.Effect<ReadonlyArray<OutlineEntry>>
    /** `all`: a selection keeps every match, for `--measure --all`. */
    resolvePart(input: {
      readonly page: Page
      readonly part: Part
      readonly all: boolean
    }): Effect.Effect<ResolvedPart, SectionNotFoundError | AmbiguousSectionError | SelectionNotFoundError>
    drawOverlays(input: {
      readonly roots: ReadonlyArray<Locator>
      readonly overlays: ReadonlyArray<Overlay>
    }): Effect.Effect<Schema.Json>
    clearOverlays(page: Page): Effect.Effect<void>
    measureElements(input: {
      readonly roots: ReadonlyArray<Locator>
      readonly styles: ReadonlyArray<string>
    }): Effect.Effect<Schema.Json>
    runRuntimeChecks(input: {
      readonly roots: ReadonlyArray<Locator>
      readonly checks: ReadonlyArray<string>
    }): Effect.Effect<ReadonlyArray<Finding>>
  }
>()('shot/PageRuntime') {}

const partPadding = 16

/** What the in-page runtime measured: JSON, since it crossed `page.evaluate`. Anything else is a runtime bug. */
const decodePageJson = Schema.decodeUnknownEffect(Schema.Json)

const bundleRuntime = Effect.promise(async () => {
  const result = await build({
    entryPoints: [pageRuntimeEntry],
    bundle: true,
    format: 'iife',
    write: false,
    target: 'chrome120',
    logLevel: 'silent',
  })

  return result.outputFiles[0]!.text
})

const pageBox = (locator: Locator): Promise<Rect> =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()

    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height }
  })

const paddedClip = async (page: Page, rects: ReadonlyArray<Rect>): Promise<Rect> => {
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }))

  const x = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.x)) - partPadding))
  const y = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.y)) - partPadding))
  const right = Math.min(size.width, Math.ceil(Math.max(...rects.map((rect) => rect.x + rect.width)) + partPadding))
  const bottom = Math.min(size.height, Math.ceil(Math.max(...rects.map((rect) => rect.y + rect.height)) + partPadding))

  return { x, y, width: right - x, height: bottom - y }
}

const findingFromRuntime = (finding: RuntimeFinding): Finding => ({
  check: finding.check,
  severity: finding.severity,
  message: finding.message,
  selector: finding.selector,
  rect: Option.fromNullishOr(finding.rect),
})

export const PageRuntimeLayer = Layer.effect(
  PageRuntime,
  Effect.gen(function* () {
    const source = yield* bundleRuntime
    let markCount = 0

    const readOutline = (page: Page) => Effect.promise(() => page.evaluate(() => window.__shot.outline()))

    const sectionRoots = (page: Page, title: string, nth: Option.Option<number>) =>
      Effect.gen(function* () {
        const mark = `p${++markCount}`

        const marked = yield* Effect.promise(() =>
          page.evaluate(({ title, nth, mark }) => window.__shot.markSection(title, nth, mark), {
            title,
            nth: Option.getOrUndefined(nth),
            mark,
          }),
        )

        return yield* Match.valueTags(marked, {
          Ambiguous: ({ matches }) => new AmbiguousSectionError({ title, matches }),
          NotFound: () =>
            Effect.gen(function* () {
              const outline = outlineText(yield* readOutline(page))

              return yield* new SectionNotFoundError({ title, outline })
            }),
          Marked: () =>
            Effect.gen(function* () {
              const locator = page.locator(`[data-shot-part="${mark}"]`)
              const count = yield* Effect.promise(() => locator.count())

              return Array.from({ length: count }, (_, index) => locator.nth(index))
            }),
        })
      })

    const resolveSelected = ({
      page,
      part,
      all,
    }: {
      readonly page: Page
      readonly part: Selected
      readonly all: boolean
    }) =>
      Effect.gen(function* () {
        const scopes: ReadonlyArray<Locator> = yield* Option.match(part.within, {
          onNone: () => Effect.succeed([]),
          onSome: (within) => {
            const section = sectionFromTitle(within)

            return sectionRoots(page, section.title, section.nth)
          },
        })

        const pick = (locator: Locator) => (all ? locator : locator.filter({ visible: true }).first())
        const scoped = scopes.map((scope) => pick(scope.locator(part.selector)))

        const countMatches = <A>(count: () => Promise<A>) =>
          Effect.tryPromise({
            try: count,
            catch: (error) =>
              new SelectionNotFoundError({
                selector: part.selector,
                reason: (String(error).split('\n')[0] ?? '').replace(/^[\w.]+: /, ''),
              }),
          })

        const counts = yield* countMatches(() => Promise.all(scoped.map((root) => root.count())))

        if (scoped.length > 0 && counts.some((count) => count === 0)) {
          return yield* new SelectionNotFoundError({
            selector: part.selector,
            reason: `no element matches inside "${Option.getOrElse(part.within, () => '')}"; popups and dialogs render outside sections: drop --section`,
          })
        }

        const roots = scoped.length > 0 ? scoped : [pick(page.locator(part.selector))]
        const first = roots[0]!.first()
        // Content that renders after the scene (a toast, a popup) gets a moment to appear.
        yield* Effect.promise(() => first.waitFor({ state: 'attached', timeout: 2000 }).catch(() => undefined))

        if ((yield* countMatches(() => roots[0]!.count())) === 0) {
          return yield* new SelectionNotFoundError({
            selector: part.selector,
            reason: 'no element matches (waited 2s)',
          })
        }

        yield* Effect.promise(() => first.scrollIntoViewIfNeeded().catch(() => undefined))
        const rects = yield* Effect.promise(() => Promise.all(roots.map((root) => pageBox(root.first()))))

        if (rects.every((rect) => rect.width === 0 || rect.height === 0)) {
          return yield* new SelectionNotFoundError({
            selector: part.selector,
            reason: `not visible (${partDescription(part)})`,
          })
        }

        return { clip: Option.some(yield* Effect.promise(() => paddedClip(page, rects))), roots }
      })

    const resolvePart = ({ page, part, all }: { readonly page: Page; readonly part: Part; readonly all: boolean }) =>
      Match.valueTags(part, {
        WholePage: () => Effect.succeed<ResolvedPart>({ clip: Option.none(), roots: [page.locator('body')] }),
        Viewport: () =>
          Effect.promise(() =>
            page.evaluate(() => ({
              x: window.scrollX,
              y: window.scrollY,
              width: window.innerWidth,
              height: window.innerHeight,
            })),
          ).pipe(Effect.map((clip): ResolvedPart => ({ clip: Option.some(clip), roots: [page.locator('body')] }))),
        Section: (section) =>
          Effect.gen(function* () {
            const roots = yield* sectionRoots(page, section.title, section.nth)
            const rects = yield* Effect.promise(() => Promise.all(roots.map(pageBox)))

            return { clip: Option.some(yield* Effect.promise(() => paddedClip(page, rects))), roots }
          }),
        Selected: (selected) => resolveSelected({ page, part: selected, all }),
      })

    return PageRuntime.of({
      injectRuntime: (page) => Effect.promise(() => page.addScriptTag({ content: source })).pipe(Effect.asVoid),
      readOutline,
      resolvePart,
      drawOverlays: ({ roots, overlays }) =>
        Effect.promise(async () => {
          const measured = await Promise.all(
            roots.map((root) => root.evaluate((element, kinds) => window.__shot.overlay(kinds, element), overlays)),
          )

          return measured.length === 1 ? measured[0] : measured
        }).pipe(Effect.flatMap(decodePageJson), Effect.orDie),
      clearOverlays: (page) =>
        Effect.promise(() => page.evaluate(() => window.__shot.clearOverlay())).pipe(Effect.asVoid),
      measureElements: ({ roots, styles }) =>
        Effect.promise(async () =>
          (
            await Promise.all(
              roots.map((root) =>
                root.evaluateAll((elements, styles) => window.__shot.measure(elements.slice(0, 50), styles), styles),
              ),
            )
          ).flat(),
        ).pipe(Effect.flatMap(decodePageJson), Effect.orDie),
      runRuntimeChecks: ({ roots, checks }) =>
        Effect.promise(async () =>
          (
            await Promise.all(
              roots.map((root) => root.evaluate((element, names) => window.__shot.check(names, element), checks)),
            )
          )
            .flat()
            .map(findingFromRuntime),
        ),
    })
  }),
)
