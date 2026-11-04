import { Context, Duration, Effect, Layer, Option, Schedule } from 'effect'
import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type BrowserContext, type Page, request } from 'playwright'

import type { Mode } from '../capture/domain/capture.ts'
import type { ReadyWait } from '../capture/domain/capture-error.ts'
import { effectFromHook } from '../plugin/hook.ts'
import { type AllowedWrite, type AppConfig, ShotConfig } from '../plugin/shot-config.ts'
import { writeProgress } from '../infrastructure/progress.ts'
import { AppHookFailedError, AppHookMissingError, AppNotRunningError, AppStartTimedOutError } from './app-error.ts'

/** The project's app hooks, normalized once: the core only sees Effects (D13). */
export class AppHooks extends Context.Service<
  AppHooks,
  {
    /** The app's URL, checked for health once per run. */
    appUrl(): Effect.Effect<
      string,
      AppHookMissingError | AppHookFailedError | AppNotRunningError | AppStartTimedOutError
    >
    readonly users: Readonly<Record<string, string>>
    logIn(input: {
      readonly page: Page
      readonly url: string
      readonly user: string
      readonly params: Readonly<Record<string, string>>
    }): Effect.Effect<void, AppHookMissingError | AppHookFailedError>
    isLoginPage(url: URL): boolean
    /** What `waitUntilReady` waits for, to name it when it times out. */
    readonly waitsFor: ReadyWait
    /** `waitForLoad` is the default: load, then the network quiet. */
    waitUntilReady(input: {
      readonly page: Page
      readonly waitForLoad: Effect.Effect<void>
    }): Effect.Effect<void, AppHookFailedError>
    applyTheme(input: {
      readonly context: BrowserContext
      readonly url: string
      readonly mode: Mode
    }): Effect.Effect<void, AppHookFailedError>
    /** `'block'` is `{ allow: [] }`. */
    readonly writes: 'allow' | { readonly allow: ReadonlyArray<AllowedWrite> }
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

const defaultStartTimeoutMs = 120_000

const isAppRunning = ({ url, health }: { readonly url: string; readonly health: Option.Option<string> }) =>
  Effect.map(appHealthy(`${url}${Option.getOrElse(health, () => '')}`), (checked) =>
    Option.isSome(health) ? checked.ok : checked.reachable,
  )

const startLockDirectory = (url: string) =>
  path.join(tmpdir(), `agent-shot-start-${createHash('sha1').update(url).digest('hex').slice(0, 12)}.lock`)

const withStartLock = <A, E>({
  url,
  timeoutMs,
  body,
}: {
  readonly url: string
  readonly timeoutMs: number
  readonly body: Effect.Effect<A, E>
}) => {
  const lock = startLockDirectory(url)

  const acquire = Effect.tryPromise({ try: () => mkdir(lock), catch: () => 'held' as const }).pipe(
    Effect.retry(Schedule.spaced('250 millis')),
    Effect.orDie,
    Effect.timeoutOption(Duration.millis(timeoutMs)),
  )

  return Effect.acquireUseRelease(
    acquire,
    () => body,
    (held) => (Option.isSome(held) ? Effect.promise(() => rm(lock, { recursive: true, force: true })) : Effect.void),
  )
}

const hookOf = <K extends keyof AppConfig>(app: Option.Option<AppConfig>, hook: K) =>
  Option.match(
    Option.flatMap(app, (config) => Option.fromNullishOr(config[hook])),
    {
      onNone: () => new AppHookMissingError({ hook: `app.${hook}` }),
      onSome: (value) => Effect.succeed(value),
    },
  )

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

      if (yield* isAppRunning({ url, health })) return url

      const start = Option.flatMap(app, (config) => Option.fromNullishOr(config.start))

      if (Option.isNone(start)) return yield* new AppNotRunningError({ url })

      const timeoutMs = Option.getOrElse(
        Option.flatMap(app, (config) => Option.fromNullishOr(config.startTimeoutMs)),
        () => defaultStartTimeoutMs,
      )

      const waitUntilRunning = isAppRunning({ url, health }).pipe(
        Effect.flatMap((running) => (running ? Effect.void : Effect.fail('not running' as const))),
        Effect.retry(Schedule.spaced('1 second')),
        Effect.orDie,
        Effect.timeoutOrElse({
          duration: Duration.millis(timeoutMs),
          orElse: () => new AppStartTimedOutError({ url, timeoutMs }),
        }),
      )

      yield* withStartLock({
        url,
        timeoutMs,
        body: Effect.gen(function* () {
          if (yield* isAppRunning({ url, health })) return
          writeProgress(`app.start: ${url} did not answer; waiting up to ${timeoutMs / 1000}s`)
          yield* effectFromHook(() => start.value(), failed('start', Option.none()))
          yield* waitUntilRunning
        }),
      })

      return url
    })

    // One URL and health check per run, not one per page.
    const appUrl = yield* Effect.cached(resolveAppUrl)
    const writes = Option.match(app, { onNone: () => 'block' as const, onSome: (config) => config.writes ?? 'block' })

    return AppHooks.of({
      appUrl: () => appUrl,
      users: Option.match(app, { onNone: () => ({}), onSome: (config) => config.users ?? {} }),
      logIn: ({ page, url, user, params }) =>
        Effect.gen(function* () {
          const logIn = yield* hookOf(app, 'logIn')
          yield* effectFromHook(() => logIn({ page, url, user, params }), failed('logIn', Option.some(user)))
        }),
      isLoginPage: (url) =>
        Option.match(
          Option.flatMap(app, (config) => Option.fromNullishOr(config.isLoginPage)),
          {
            onNone: () => url.pathname.startsWith('/login'),
            onSome: (isLoginPage) => isLoginPage(url),
          },
        ),
      waitsFor: Option.isSome(Option.flatMap(app, (config) => Option.fromNullishOr(config.waitUntilReady)))
        ? 'waitUntilReady'
        : 'load',
      waitUntilReady: ({ page, waitForLoad }) =>
        Option.match(
          Option.flatMap(app, (config) => Option.fromNullishOr(config.waitUntilReady)),
          {
            onNone: () => waitForLoad,
            onSome: (waitUntilReady) =>
              effectFromHook(() => waitUntilReady(page), failed('waitUntilReady', Option.none())),
          },
        ),
      applyTheme: ({ context, url, mode }) =>
        Option.match(
          Option.flatMap(app, (config) => Option.fromNullishOr(config.applyTheme)),
          {
            onNone: () => Effect.void,
            onSome: (applyTheme) =>
              effectFromHook(() => applyTheme({ context, url, mode }), failed('applyTheme', Option.none())),
          },
        ),
      writes: writes === 'block' ? { allow: [] } : writes,
    })
  }),
)
