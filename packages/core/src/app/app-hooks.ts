import { Context, Effect, Layer, Option } from 'effect'
import { type BrowserContext, type Page, request } from 'playwright'

import type { Mode } from '../capture/domain/capture.ts'
import { effectFromHook } from '../plugin/hook.ts'
import { type AppConfig, ShotConfig } from '../plugin/shot-config.ts'
import { AppHookFailedError, AppHookMissingError, AppNotRunningError } from './app-error.ts'

/** The project's app hooks, normalized once: the core only sees Effects (D13). */
export class AppHooks extends Context.Service<
  AppHooks,
  {
    /** The app's URL, checked for health once per run. */
    appUrl(): Effect.Effect<string, AppHookMissingError | AppHookFailedError | AppNotRunningError>
    readonly users: Readonly<Record<string, string>>
    logIn(input: {
      readonly page: Page
      readonly url: string
      readonly user: string
      readonly params: Readonly<Record<string, string>>
    }): Effect.Effect<void, AppHookMissingError | AppHookFailedError>
    isLoginPage(url: URL): boolean
    /** `waitForLoad` is the default: load, then the network quiet. */
    waitUntilReady(input: { readonly page: Page; readonly waitForLoad: Effect.Effect<void> }): Effect.Effect<void, AppHookFailedError>
    applyTheme(input: { readonly context: BrowserContext; readonly url: string; readonly mode: Mode }): Effect.Effect<void, AppHookFailedError>
    readonly writes: 'block' | 'allow'
  }
>()('shot/AppHooks') {}

const appHealthy = (url: string) =>
  Effect.promise(async () => {
    const context = await request.newContext({ ignoreHTTPSErrors: true })

    try {
      const response = await context.get(url, { timeout: 5000, maxRedirects: 0 })

      return { reachable: true, ok: response.ok() }
    } catch {
      return { reachable: false, ok: false }
    } finally {
      await context.dispose()
    }
  })

const hookOf = <K extends keyof AppConfig>(app: Option.Option<AppConfig>, hook: K) =>
  Option.match(Option.flatMap(app, (config) => Option.fromNullishOr(config[hook])), {
    onNone: () => new AppHookMissingError({ hook: `app.${hook}` }),
    onSome: (value) => Effect.succeed(value),
  })

export const AppHooksLayer = Layer.effect(
  AppHooks,
  Effect.gen(function* () {
    const config = yield* ShotConfig
    const app = config.app

    const failed = (hook: string, user: Option.Option<string>) => (message: string) =>
      new AppHookFailedError({ hook, user, message })

    const resolveAppUrl = Effect.gen(function* () {
      const urlHook = yield* hookOf(app, 'url')
      const url = (yield* effectFromHook(() => urlHook(), failed('url', Option.none()))).replace(/\/$/, '')
      const health = Option.flatMap(app, (config) => Option.fromNullishOr(config.health))
      const checked = yield* appHealthy(`${url}${Option.getOrElse(health, () => '')}`)
      const running = Option.isSome(health) ? checked.ok : checked.reachable

      if (!running) return yield* new AppNotRunningError({ url })

      return url
    })

    // One URL and health check per run, not one per page.
    const appUrl = yield* Effect.cached(resolveAppUrl)

    return AppHooks.of({
      appUrl: () => appUrl,
      users: Option.match(app, { onNone: () => ({}), onSome: (config) => config.users ?? {} }),
      logIn: ({ page, url, user, params }) =>
        Effect.gen(function* () {
          const logIn = yield* hookOf(app, 'logIn')
          yield* effectFromHook(() => logIn({ page, url, user, params }), failed('logIn', Option.some(user)))
        }),
      isLoginPage: (url) =>
        Option.match(Option.flatMap(app, (config) => Option.fromNullishOr(config.isLoginPage)), {
          onNone: () => url.pathname.startsWith('/login'),
          onSome: (isLoginPage) => isLoginPage(url),
        }),
      waitUntilReady: ({ page, waitForLoad }) =>
        Option.match(Option.flatMap(app, (config) => Option.fromNullishOr(config.waitUntilReady)), {
          onNone: () => waitForLoad,
          onSome: (waitUntilReady) => effectFromHook(() => waitUntilReady(page), failed('waitUntilReady', Option.none())),
        }),
      applyTheme: ({ context, url, mode }) =>
        Option.match(Option.flatMap(app, (config) => Option.fromNullishOr(config.applyTheme)), {
          onNone: () => Effect.void,
          onSome: (applyTheme) => effectFromHook(() => applyTheme({ context, url, mode }), failed('applyTheme', Option.none())),
        }),
      writes: Option.match(app, { onNone: () => 'block' as const, onSome: (config) => config.writes ?? 'block' }),
    })
  }),
)
