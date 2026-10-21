import { Effect, Option } from 'effect'

import type { ArtifactStore } from '../artifact/artifact-store.ts'
import type { OpenSourceOptions } from '../capture/application/source-providers.ts'
import type { RouteSource, Variant } from '../capture/domain/capture.ts'
import {
  SourceNotFoundError,
  SourceRedirectedError,
  SourceRenderFailedError,
  SourceTimedOutError,
  UserMissingError,
} from '../capture/domain/capture-error.ts'
import type { Browser } from '../infrastructure/browser.ts'
import {
  blockWrites,
  collectPageErrors,
  contextOptionsFromVariant,
  makeErrorLog,
  prepareContext,
  type ReadyPage,
  renderTimeoutMs,
  settlePage,
  trackNetwork,
} from '../infrastructure/page-lifecycle.ts'
import type { PageRuntime } from '../infrastructure/page-runtime.ts'
import type { ShotConfig } from '../plugin/shot-config.ts'
import type { AppHooks } from './app-hooks.ts'
import type { AppSessions } from './app-sessions.ts'
import { userFromAlias } from './app-user.ts'

export interface RouteSourceDeps {
  readonly hooks: AppHooks['Service']
  readonly sessions: AppSessions['Service']
  readonly browser: Browser['Service']
  readonly runtime: PageRuntime['Service']
  readonly store: ArtifactStore['Service']
  readonly config: ShotConfig['Service']
}

/** `/path` as `--as` (an alias or email), else the host's default user from `shot login` (D15). */
export const resolveRouteSource = ({
  deps,
  path,
  as,
  params,
}: {
  readonly deps: RouteSourceDeps
  readonly path: string
  readonly as: Option.Option<string>
  readonly params: Readonly<Record<string, string>>
}) =>
  Effect.gen(function* () {
    if (path.includes('/:')) {
      return yield* new SourceNotFoundError({ raw: path, reason: 'the path has a :param; fill it with a real id' })
    }
    const url = yield* deps.hooks.appUrl()
    const defaults = yield* deps.store.readHostDefaults(new URL(url).host)
    const user = Option.match(as, {
      onNone: () => Option.map(defaults, (found) => found.user),
      onSome: (alias) => Option.some(userFromAlias({ as: alias, users: deps.hooks.users })),
    })
    if (Option.isNone(user)) return yield* new UserMissingError({ path })
    const defaultParams = Option.isNone(as) ? Option.getOrElse(Option.map(defaults, (found) => found.params), () => ({})) : {}
    return { _tag: 'RouteSource', path, user: user.value, params: { ...defaultParams, ...params } } satisfies RouteSource
  })

/**
 * An app route as a user:
 *
 *   session ──goto──▶ waitUntilReady ──▶ landed on the target ──network quiet──▶ settled
 *      ├─ 4xx/5xx, a failing waitUntilReady ──▶ SourceRenderFailedError
 *      ├─ landed on the login page ──▶ renew the session once ──▶ again: SourceRedirectedError (A5)
 *      ├─ landed elsewhere ──▶ SourceRedirectedError (a 404 page, a permission redirect)
 *      └─ not ready in 20s ──▶ SourceTimedOutError
 */
export const openRouteSource = ({
  deps,
  source,
  variant,
  options,
}: {
  readonly deps: RouteSourceDeps
  readonly source: RouteSource
  readonly variant: Variant
  readonly options: OpenSourceOptions
}) =>
  Effect.gen(function* () {
    const url = yield* deps.hooks.appUrl()
    const target = new URL(source.path, url)
    const contextOptions = yield* contextOptionsFromVariant(variant)
    for (let attempt = 1; ; attempt++) {
      const session = { user: source.user, params: source.params }
      const storageState = attempt === 1 ? yield* deps.sessions.getAppSession(session) : yield* deps.sessions.renewAppSession(session)
      const context = yield* deps.browser.newContext({
        ...contextOptions,
        storageState,
        ...Option.match(options.recordVideoDir, {
          onNone: () => ({}),
          onSome: (dir) => ({ recordVideo: { dir, size: contextOptions.viewport ?? { width: 1280, height: 900 } } }),
        }),
      })
      yield* deps.hooks.applyTheme({ context, url, mode: variant.mode })
      yield* prepareContext({
        context,
        slow: options.slowClock,
        determinism: deps.config.determinism.routes === true ? Option.some(deps.config.determinism) : Option.none(),
      })
      const log = makeErrorLog()
      if (deps.hooks.writes === 'block') yield* blockWrites({ context, origin: target.origin, log })
      const page = yield* Effect.promise(() => context.newPage())
      collectPageErrors(page, log)
      const networkQuiet = trackNetwork(page, target.origin)

      const response = yield* Effect.tryPromise({
        try: () => page.goto(target.href, { waitUntil: 'commit', timeout: renderTimeoutMs }),
        catch: (error) =>
          new SourceRenderFailedError({ source, reason: `could not load the page (${String(error).split('\n')[0]})` }),
      })
      if (response !== null && response.status() >= 400) {
        return yield* new SourceRenderFailedError({ source, reason: `the server answered ${response.status()}` })
      }
      const waitForLoad = Effect.promise(async () => {
        await page.waitForLoadState('load', { timeout: renderTimeoutMs }).catch(() => undefined)
        await networkQuiet()
      })
      const ready = yield* deps.hooks.waitUntilReady({ page, waitForLoad }).pipe(
        Effect.timeoutOption(renderTimeoutMs),
        Effect.result,
      )
      const landed = new URL(page.url())
      if (deps.hooks.isLoginPage(landed)) {
        if (attempt === 1) {
          yield* Effect.promise(() => context.close())
          continue
        }
        return yield* new SourceRedirectedError({ source, landedOn: `${landed.pathname}${landed.search}` })
      }
      if (ready._tag === 'Failure') return yield* new SourceRenderFailedError({ source, reason: ready.failure.message })
      if (Option.isNone(ready.success)) {
        return yield* new SourceTimedOutError({ source, waitedMs: renderTimeoutMs, consoleErrors: [...log.errors] })
      }
      if (landed.pathname !== target.pathname) {
        return yield* new SourceRedirectedError({ source, landedOn: `${landed.pathname}${landed.search}` })
      }
      yield* Effect.promise(networkQuiet)
      yield* deps.runtime.injectRuntime(page)
      if (options.settle) yield* settlePage(page)
      return { page, context, source, variant, consoleErrors: log.errors } satisfies ReadyPage
    }
  })
