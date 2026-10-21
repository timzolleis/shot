import { Effect, Match, Option } from 'effect'
import { type BrowserContext, type BrowserContextOptions, devices, type Page } from 'playwright'

import type { Source, Step, Variant } from '../capture/domain/capture.ts'
import { StepFailedError, UnknownDeviceError } from '../capture/domain/capture-error.ts'
import type { Determinism } from '../plugin/shot-config.ts'

/**
 * One page and its lifecycle, for any source:
 *
 *   loading ──ready, network quiet──▶ settling ──fonts, finite animations, two frames──▶ ready
 *
 * The caret and scrollbars are hidden. Routes keep the real clock unless the config's determinism says otherwise.
 */

export interface ReadyPage {
  readonly page: Page
  readonly context: BrowserContext
  readonly source: Source
  readonly variant: Variant
  /** Console and page errors and blocked writes, each once; live: steps add to it. */
  readonly consoleErrors: ReadonlyArray<string>
}

export const renderTimeoutMs = 20_000
const settleCapMs = 2_000

const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }

    previous = current
  }

  return previous[b.length]!
}

/** The `count` candidates nearest to `needle`, for "did you mean". */
export const closestCandidates = (needle: string, candidates: ReadonlyArray<string>, count = 5): ReadonlyArray<string> =>
  candidates
    .map((candidate) => ({ candidate, distance: editDistance(needle.toLowerCase(), candidate.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map(({ candidate }) => candidate)

export const contextOptionsFromVariant = (variant: Variant): Effect.Effect<BrowserContextOptions, UnknownDeviceError> =>
  Effect.gen(function* () {
    const device = yield* Option.match(variant.device, {
      onNone: () => Effect.succeed(undefined),
      onSome: (requested) => {
        const name = Object.keys(devices).find((candidate) => candidate.toLowerCase() === requested.toLowerCase())

        return name === undefined
          ? Effect.fail(
              new UnknownDeviceError({
                device: requested,
                closest: closestCandidates(requested, Object.keys(devices).filter((candidate) => !candidate.endsWith('landscape'))),
              }),
            )
          : Effect.succeed(devices[name])
      },
    })

    const viewport = device?.viewport ?? { width: 1280, height: 900 }

    return {
      ...(device === undefined ? {} : { userAgent: device.userAgent, isMobile: device.isMobile, hasTouch: device.hasTouch }),
      viewport: {
        width: Option.getOrElse(variant.width, () => viewport.width),
        height: Option.getOrElse(variant.height, () => viewport.height),
      },
      deviceScaleFactor: variant.scale,
      reducedMotion: variant.reducedMotion ? 'reduce' : 'no-preference',
      colorScheme: variant.mode,
      ignoreHTTPSErrors: true,
    }
  })

const hideCaretAndScrollbars = () => {
  const style = () => {
    const element = document.createElement('style')
    element.textContent =
      '*,*::before,*::after{caret-color:transparent!important;scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}'
    document.head.append(element)
  }

  if (document.head === null) document.addEventListener('DOMContentLoaded', style)
  else style()
}

/** Scales `performance.now` and `requestAnimationFrame` timestamps, so JS animations slow down with `--slow`. */
const slowClock = () => {
  const real = performance.now.bind(performance)
  let rate = 1
  let baseReal = 0
  let baseVirtual = 0
  const now = () => baseVirtual + (real() - baseReal) * rate
  performance.now = now
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => raf(() => callback(now()))
  ;(window as unknown as { __shotSetSlow: (next: number) => void }).__shotSetSlow = (next) => {
    baseVirtual = now()
    baseReal = real()
    rate = next
  }
}

/** A seeded Math.random (mulberry32). */
const seededRandom = (seed: number) => {
  let state = seed >>> 0
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const prepareContext = ({
  context,
  slow,
  determinism,
}: {
  readonly context: BrowserContext
  readonly slow: boolean
  readonly determinism: Option.Option<Determinism>
}) =>
  Effect.promise(async () => {
    await context.addInitScript(hideCaretAndScrollbars)

    if (slow) await context.addInitScript(slowClock)

    if (Option.isSome(determinism)) {
      const { fixedTime, seed } = determinism.value

      if (seed !== undefined) await context.addInitScript(seededRandom, seed)

      if (fixedTime !== undefined) await context.clock.setFixedTime(fixedTime)
    }
  })

/** Errors in the order they happened, each once. */
export const makeErrorLog = () => {
  const errors: Array<string> = []

  return { errors, add: (error: string) => (errors.includes(error) ? undefined : errors.push(error)) }
}

/** Console errors and page errors into `log`; the browser's echo of a blocked write is already reported. */
export const collectPageErrors = (page: Page, log: ReturnType<typeof makeErrorLog>) => {
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT')) log.add(message.text())
  })
  page.on('pageerror', (error) => log.add(error.message))
}

const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Aborts same-origin writes; each one is logged (A4). */
export const blockWrites = ({
  context,
  origin,
  log,
}: {
  readonly context: BrowserContext
  readonly origin: string
  readonly log: ReturnType<typeof makeErrorLog>
}) =>
  Effect.promise(() =>
    context.route(
      (url) => url.origin === origin,
      async (route) => {
        const request = route.request()

        if (!writeMethods.has(request.method())) return route.fallback()
        log.add(`blocked ${request.method()} ${new URL(request.url()).pathname}`)

        return route.abort('blockedbyclient')
      },
    ),
  )

/** Same-origin requests in flight, without long-lived streams; `waitForQuiet` resolves after 500ms with none (cap 10s). */
export const trackNetwork = (page: Page, origin: string) => {
  const inFlight = new Set<unknown>()
  let lastChange = Date.now()

  const counts = (request: { url: () => string; resourceType: () => string }) =>
    request.url().startsWith(origin) && !['eventsource', 'websocket'].includes(request.resourceType())

  page.on('request', (request) => {
    if (!counts(request)) return
    inFlight.add(request)
    lastChange = Date.now()
  })

  const done = (request: unknown) => {
    if (inFlight.delete(request)) lastChange = Date.now()
  }

  page.on('requestfinished', done)
  page.on('requestfailed', done)

  return async () => {
    const deadline = Date.now() + 10_000

    while (Date.now() < deadline && (inFlight.size > 0 || Date.now() - lastChange < 500)) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

/** Fonts loaded, finite animations finished (capped), then two frames. */
export const settlePage = (page: Page) =>
  Effect.promise(() =>
    page
      .evaluate(async (capMs) => {
        await document.fonts.ready
        const deadline = performance.now() + capMs

        const running = () =>
          document.getAnimations().filter((animation) => {
            const end = animation.effect?.getComputedTiming().endTime

            return animation.playState === 'running' && typeof end === 'number' && Number.isFinite(end)
          })

        for (let pending = running(); pending.length > 0 && performance.now() < deadline; pending = running()) {
          await Promise.race([
            Promise.all(pending.map((animation) => animation.finished.catch(() => undefined))),
            new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - performance.now()))),
          ])
        }

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, settleCapMs)
      .catch(() => undefined),
  )

const originalViewports = new WeakMap<Page, { readonly width: number; readonly height: number }>()

/**
 * Apps that scroll inside a shell stop a full-page screenshot at the viewport. `expand` grows the viewport until the
 * tallest scroller fits, so every part is on screen in page coordinates; otherwise the original viewport comes back.
 */
export const fitContent = ({ page, expand }: { readonly page: Page; readonly expand: boolean }) =>
  Effect.gen(function* () {
    const original = originalViewports.get(page) ?? page.viewportSize()

    if (original === null) return
    originalViewports.set(page, original)

    if (!expand) {
      if (page.viewportSize()?.height !== original.height) {
        yield* Effect.promise(() => page.setViewportSize(original))
        yield* settlePage(page)
      }

      return
    }

    for (let round = 0; round < 3; round++) {
      const hidden = yield* Effect.promise(() =>
        page.evaluate(() =>
          Math.max(
            0,
            ...Array.from(document.querySelectorAll('*')).map((element) => {
              const style = getComputedStyle(element)
              const scrolls = /(auto|scroll|hidden)/.test(style.overflowY) && element !== document.documentElement

              return scrolls && element !== document.body ? element.scrollHeight - element.clientHeight : 0
            }),
          ),
        ),
      )

      if (hidden <= 1) return
      const current = page.viewportSize() ?? original
      yield* Effect.promise(() => page.setViewportSize({ width: current.width, height: Math.min(12_000, current.height + hidden) }))
      yield* settlePage(page)
    }
  })

export const stepDescription = (step: Step): string =>
  Match.valueTags(step, {
    Click: ({ selector }) => `--click ${selector}`,
    Fill: ({ selector }) => `--fill ${selector}=…`,
    Key: ({ key }) => `--key ${key}`,
    Hover: ({ selector }) => `--hover ${selector}`,
    Focus: ({ selector }) => `--focus ${selector}`,
    Press: ({ selector }) => `--press ${selector}`,
    Wait: ({ ms }) => `--wait ${ms}`,
  })

const firstLine = (error: unknown) => (String(error).split('\n')[0] ?? '').replace(/^[\w.]+: /, '')

/** Runs one step on the first visible match; fails with one line naming the step. */
export const runStep = ({ page, step }: { readonly page: Page; readonly step: Step }): Effect.Effect<void, StepFailedError> =>
  Effect.gen(function* () {
    const fail = (reason: string) => new StepFailedError({ step: stepDescription(step), reason })

    if (step._tag === 'Key') {
      return yield* Effect.tryPromise({ try: () => page.keyboard.press(step.key), catch: (error) => fail(firstLine(error)) })
    }

    if (step._tag === 'Wait') return yield* Effect.sleep(step.ms)
    // Pages keep hidden copies of controls (mobile and desktop layouts, closed popups): the first visible match.
    const locator = page.locator(step.selector).filter({ visible: true }).first()
    yield* Effect.promise(() => locator.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined))
    // A selector Playwright cannot parse fails here, as the step's error.
    const counted = (count: () => Promise<number>) => Effect.tryPromise({ try: count, catch: (error) => fail(firstLine(error)) })

    if ((yield* counted(() => locator.count())) === 0) {
      const hidden = yield* counted(() => page.locator(step.selector).count())

      return yield* fail(`${hidden > 0 ? `${hidden} matching, none visible` : 'no element matches'} (waited 2s)`)
    }

    yield* Effect.tryPromise({
      try: () =>
        Match.valueTags(step, {
          Click: () => locator.click({ timeout: 5000 }),
          Hover: () => locator.hover({ timeout: 5000 }),
          // A keypress first puts Chrome in keyboard modality, so programmatic focus matches :focus-visible.
          Focus: async () => {
            await page.keyboard.press('Shift')
            await locator.focus({ timeout: 5000 })
          },
          Press: async () => {
            await locator.hover({ timeout: 5000 })
            await page.mouse.down()
          },
          Fill: ({ text }) => locator.fill(text, { timeout: 5000 }),
        }),
      catch: (error) => fail(firstLine(error)),
    })
  })
