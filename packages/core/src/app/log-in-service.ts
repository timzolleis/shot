import { Context, Effect, Layer, Option } from 'effect'

import { ArtifactStore } from '../artifact/artifact-store.ts'
import type { AppHookFailedError, AppHookMissingError, AppNotRunningError, SessionLockTimeoutError } from './app-error.ts'
import { AppHooks } from './app-hooks.ts'
import { AppSessions } from './app-sessions.ts'
import { userFromAlias } from './app-user.ts'

export interface LogInCommand {
  readonly as: string
  readonly params: Readonly<Record<string, string>>
}

/** D: a fresh session, and the user as the host's default for routes. */
export class LogInService extends Context.Service<
  LogInService,
  {
    logIn(
      command: LogInCommand,
    ): Effect.Effect<
      { readonly url: string; readonly host: string; readonly user: string },
      AppHookMissingError | AppHookFailedError | AppNotRunningError | SessionLockTimeoutError
    >
    /** Removes cached sessions on the app's host, for one user or all. */
    logOut(command: {
      readonly as: Option.Option<string>
    }): Effect.Effect<{ readonly host: string; readonly removed: number }, AppHookMissingError | AppHookFailedError | AppNotRunningError>
  }
>()('shot/LogInService') {}

export const LogInServiceLayer = Layer.effect(
  LogInService,
  Effect.gen(function* () {
    const hooks = yield* AppHooks
    const sessions = yield* AppSessions
    const store = yield* ArtifactStore

    return LogInService.of({
      logIn: Effect.fn('LogInService.logIn')(function* ({ as, params }) {
        const url = yield* hooks.appUrl()
        const host = new URL(url).host
        const user = userFromAlias({ as, users: hooks.users })
        yield* sessions.renewAppSession({ user, params })
        yield* store.writeHostDefaults({ host, user, params })

        return { url, host, user }
      }),
      logOut: Effect.fn('LogInService.logOut')(function* ({ as }) {
        const url = yield* hooks.appUrl()
        const host = new URL(url).host
        const user = Option.map(as, (alias) => userFromAlias({ as: alias, users: hooks.users }))

        return { host, removed: yield* store.removeAuthFiles({ host, user }) }
      }),
    })
  }),
)
