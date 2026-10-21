import { Context, Effect, Layer, Option, type Scope } from 'effect'

import type { AppHookFailedError, AppHookMissingError, AppNotRunningError, SessionLockTimeoutError } from '../../app/app-error.ts'
import { openRouteSource, resolveRouteSource, type RouteSourceDeps } from '../../app/route-source-provider.ts'
import type { Source, Variant } from '../domain/capture.ts'
import {
  SourceNotFoundError,
  type SourceRedirectedError,
  type SourceRenderFailedError,
  type SourceTimedOutError,
  type UnknownDeviceError,
  type UserMissingError,
} from '../domain/capture-error.ts'
import { ArtifactStore } from '../../artifact/artifact-store.ts'
import { AppHooks } from '../../app/app-hooks.ts'
import { AppSessions } from '../../app/app-sessions.ts'
import { Browser } from '../../infrastructure/browser.ts'
import type { ReadyPage } from '../../infrastructure/page-lifecycle.ts'
import { PageRuntime } from '../../infrastructure/page-runtime.ts'
import { openUrlSource } from '../../infrastructure/url-source-provider.ts'
import { ShotConfig } from '../../plugin/shot-config.ts'

export type ResolveSourceError =
  | SourceNotFoundError
  | UserMissingError
  | AppHookMissingError
  | AppHookFailedError
  | AppNotRunningError

export type OpenSourceError =
  | SourceRenderFailedError
  | SourceTimedOutError
  | SourceRedirectedError
  | UnknownDeviceError
  | AppHookMissingError
  | AppHookFailedError
  | AppNotRunningError
  | SessionLockTimeoutError

export interface OpenSourceOptions {
  /** Settle after ready: fonts, finite animations, two frames. Frames start unsettled. */
  readonly settle: boolean
  /** Install the slow clock for `--frames --slow`. */
  readonly slowClock: boolean
  /** Record a video into this directory (flows). */
  readonly recordVideoDir: Option.Option<string>
}

/** URL and app route sources: from raw input to a `Source`, and to a ready page. */
export class SourceProviders extends Context.Service<
  SourceProviders,
  {
    resolveSource(input: {
      readonly raw: string
      readonly as: Option.Option<string>
      readonly params: Readonly<Record<string, string>>
    }): Effect.Effect<Source, ResolveSourceError>
    openSource(input: {
      readonly source: Source
      readonly variant: Variant
      readonly options: OpenSourceOptions
    }): Effect.Effect<ReadyPage, OpenSourceError, Scope.Scope>
  }
>()('shot/SourceProviders') {}

export const SourceProvidersLayer = Layer.effect(
  SourceProviders,
  Effect.gen(function* () {
    const deps: RouteSourceDeps = {
      hooks: yield* AppHooks,
      sessions: yield* AppSessions,
      browser: yield* Browser,
      runtime: yield* PageRuntime,
      store: yield* ArtifactStore,
      config: yield* ShotConfig,
    }
    return SourceProviders.of({
      resolveSource: ({ raw, as, params }) => {
        if (/^https?:\/\//.test(raw)) return Effect.succeed({ _tag: 'UrlSource' as const, url: raw })
        if (raw.startsWith('/')) return resolveRouteSource({ deps, path: raw, as, params })
        return new SourceNotFoundError({ raw, reason: 'pass a URL (https://…) or an app path (/settings)' })
      },
      openSource: ({ source, variant, options }) =>
        source._tag === 'UrlSource'
          ? openUrlSource({ deps, source, variant, options })
          : openRouteSource({ deps, source, variant, options }),
    })
  }),
)
