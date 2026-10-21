import { Context, Effect, Layer, Option, Ref, Semaphore, type Scope } from 'effect'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { type Browser as PlaywrightBrowser, type BrowserContext, type BrowserContextOptions, chromium } from 'playwright'

/** Playwright Chromium, launched on first use and closed with the layer; contexts scoped to their use. */
export class Browser extends Context.Service<
  Browser,
  {
    newContext(options: BrowserContextOptions): Effect.Effect<BrowserContext, never, Scope.Scope>
  }
>()('shot/Browser') {}

const launchChromium = Effect.promise(async () => {
  try {
    return await chromium.launch()
  } catch (error) {
    if (!String(error).includes("Executable doesn't exist")) throw error
    process.stderr.write('Installing Playwright Chromium (one time)…\n')
    const cli = createRequire(import.meta.url).resolve('playwright/cli')
    execFileSync(process.execPath, [cli, 'install', 'chromium'], { stdio: ['ignore', 'inherit', 'inherit'] })
    return chromium.launch()
  }
})

export const PlaywrightBrowserLayer = Layer.effect(
  Browser,
  Effect.gen(function* () {
    const launched = yield* Ref.make(Option.none<PlaywrightBrowser>())
    const launching = yield* Semaphore.make(1)
    yield* Effect.addFinalizer(() =>
      Ref.get(launched).pipe(
        Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (browser) => Effect.promise(() => browser.close()) })),
      ),
    )
    const browser = Semaphore.withPermit(
      launching,
      Effect.gen(function* () {
        const current = yield* Ref.get(launched)
        if (Option.isSome(current)) return current.value
        const started = yield* launchChromium
        yield* Ref.set(launched, Option.some(started))
        return started
      }),
    )
    return Browser.of({
      newContext: (options) =>
        Effect.acquireRelease(
          Effect.flatMap(browser, (started) => Effect.promise(() => started.newContext(options))),
          (context) => Effect.promise(() => context.close().catch(() => undefined)),
        ),
    })
  }),
)
