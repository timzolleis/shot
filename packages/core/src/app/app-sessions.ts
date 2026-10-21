import { Context, Duration, Effect, FileSystem, Layer, Schedule } from 'effect'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import { ArtifactStore } from '../artifact/artifact-store.ts'
import { Browser } from '../infrastructure/browser.ts'
import type { AppHookFailedError, AppHookMissingError, AppNotRunningError } from './app-error.ts'
import { SessionLockTimeoutError } from './app-error.ts'
import { AppHooks } from './app-hooks.ts'
import { appSessionKey } from './app-user.ts'

/** A logged-in user's Playwright storage state, as a file. */
export type StorageStateFile = string

export interface AppSessionInput {
  readonly user: string
  readonly params: Readonly<Record<string, string>>
}

/**
 * Cached app sessions per (app host, user, params), reused until the app rejects one (A5, D14). One login per key
 * runs at a time, across processes: a lock directory next to the session file.
 */
export class AppSessions extends Context.Service<
  AppSessions,
  {
    getAppSession(
      input: AppSessionInput,
    ): Effect.Effect<StorageStateFile, AppHookMissingError | AppHookFailedError | AppNotRunningError | SessionLockTimeoutError>
    /** Logs in fresh, even when a cached session exists. */
    renewAppSession(
      input: AppSessionInput,
    ): Effect.Effect<StorageStateFile, AppHookMissingError | AppHookFailedError | AppNotRunningError | SessionLockTimeoutError>
  }
>()('shot/AppSessions') {}

/** Sessions of most apps last a week; renew a day early. */
const sessionMaxAge = Duration.days(6)
const lockTimeout = Duration.seconds(90)

export const AppSessionsLayer = Layer.effect(
  AppSessions,
  Effect.gen(function* () {
    const hooks = yield* AppHooks
    const browser = yield* Browser
    const store = yield* ArtifactStore
    const fs = yield* FileSystem.FileSystem

    const isFresh = (file: string) =>
      Effect.promise(() =>
        stat(file)
          .then((info) => Date.now() - info.mtimeMs < Duration.toMillis(sessionMaxAge))
          .catch(() => false),
      )

    /** `mkdir` is atomic: whoever creates the lock directory holds it. */
    const withLock = <A, E>(key: string, file: string, body: Effect.Effect<A, E>) => {
      const lock = `${file}.lock`

      const acquire = Effect.tryPromise({
        try: async () => {
          await mkdir(path.dirname(lock), { recursive: true })
          await mkdir(lock)
        },
        catch: () => 'held' as const,
      }).pipe(
        Effect.retry(Schedule.spaced('250 millis')),
        // The retry never gives up; the timeout does.
        Effect.orDie,
        Effect.timeoutOrElse({ duration: lockTimeout, orElse: () => new SessionLockTimeoutError({ key }) }),
      )

      return Effect.acquireUseRelease(
        acquire,
        () => body,
        () => Effect.promise(() => rm(lock, { recursive: true, force: true })),
      )
    }

    const logInTo = ({ url, file, user, params }: { url: string; file: string } & AppSessionInput) =>
      Effect.scoped(
        Effect.gen(function* () {
          process.stderr.write(`login: ${user} at ${url}\n`)
          const context = yield* browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
          const page = yield* Effect.promise(() => context.newPage())
          yield* hooks.logIn({ page, url, user, params })
          yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.orDie)
          yield* Effect.promise(() => context.storageState({ path: file }))

          return file
        }),
      )

    const session = ({ user, params, fresh }: AppSessionInput & { readonly fresh: boolean }) =>
      Effect.gen(function* () {
        const url = yield* hooks.appUrl()
        const key = appSessionKey({ host: new URL(url).host, user, params })
        const file = store.authFile(key)

        if (!fresh && (yield* isFresh(file))) return file
        const startedAt = Date.now()

        return yield* withLock(
          key,
          file,
          Effect.gen(function* () {
            // Another process may have logged in while this one waited for the lock.
            const loggedInMeanwhile = yield* Effect.promise(() =>
              stat(file)
                .then((info) => info.mtimeMs >= startedAt)
                .catch(() => false),
            )

            if (loggedInMeanwhile || (!fresh && (yield* isFresh(file)))) return file

            return yield* logInTo({ url, file, user, params })
          }),
        )
      })

    return AppSessions.of({
      getAppSession: (input) => session({ ...input, fresh: false }),
      renewAppSession: (input) => session({ ...input, fresh: true }),
    })
  }),
)
