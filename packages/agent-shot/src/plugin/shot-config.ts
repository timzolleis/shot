import { Context, Data, Effect, Layer, Option, Predicate } from 'effect'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserContext, Page } from 'playwright'

import type { Mode } from '../capture/domain/capture.ts'
import {
  type ChecksSetting,
  checksSettingFromConfig,
  type CoreCheckName,
  coreCheckNames,
} from '../capture/domain/finding.ts'
import { videoLimitBytes } from '../evidence/domain/video-budget.ts'
import { type Hook, messageFromCause } from './hook.ts'
import type { AnyShotPlugin, CheckNameOfPlugin } from './shot-plugin.ts'

/** Where the project's app runs and how a user logs in (D13). Hooks return a Promise, an Effect or a value. */
export interface AppConfig {
  readonly url: () => Hook<string>
  /** A path; GET must answer 2xx. Without it, any answer means the app runs. */
  readonly health?: string
  /** Aliases for `--as` (D15). */
  readonly users?: Readonly<Record<string, string>>
  readonly logIn: (input: {
    readonly page: Page
    readonly url: string
    readonly user: string
    readonly params: Readonly<Record<string, string>>
  }) => Hook<void>
  /** Default: the pathname starts with /login (A5). */
  readonly isLoginPage?: (url: URL) => boolean
  /** Default: load, then the network quiet for 500 ms. */
  readonly waitUntilReady?: (page: Page) => Hook<void>
  /** Default: the context's colorScheme. */
  readonly applyTheme?: (input: {
    readonly context: BrowserContext
    readonly url: string
    readonly mode: Mode
  }) => Hook<void>
  /** Default 'block' (A4). */
  readonly writes?: 'block' | 'allow'
}

export interface Determinism {
  /** ISO instant the browser clock is fixed at. */
  readonly fixedTime?: string
  /** Seed for Math.random. */
  readonly seed?: number
  /** Also on app routes; off by default: the server renders dates, a frozen browser clock breaks hydration. */
  readonly routes?: boolean
}

export interface ShotConfigInput<Plugins extends ReadonlyArray<AnyShotPlugin> = ReadonlyArray<AnyShotPlugin>> {
  readonly app?: AppConfig
  readonly plugins?: Plugins
  /**
   * `'off'`: no check reports anything. Else a level per check, core (`console`, `overflow`, `target`, `focus`,
   * `align`) or a plugin's (`a11y`): `'off'`, or `'warn'`/`'error'` for all its findings. Render failures always count.
   */
  readonly checks?: ChecksSetting<CoreCheckName | CheckNameOfPlugin<Plugins[number]>>
  readonly determinism?: Determinism
  /** The repository owner's GitHub plan: picks the video limit, 10 MB or 100 MB (B9). Default free. */
  readonly githubPlan?: 'free' | 'paid'
}

/** Types the config; `checks` takes the core checks' names and those of the plugins in `plugins`. */
export const defineConfig = <const Plugins extends ReadonlyArray<AnyShotPlugin> = readonly []>(
  config: ShotConfigInput<Plugins>,
): ShotConfigInput => config

/** The loaded `shot.config.ts`, or the defaults when there is none. */
export class ShotConfig extends Context.Service<
  ShotConfig,
  {
    /** The config's directory, else the working directory: `.shots/` and flows live here. */
    readonly projectRoot: string
    readonly configFile: Option.Option<string>
    readonly app: Option.Option<AppConfig>
    readonly plugins: ReadonlyArray<AnyShotPlugin>
    readonly checks: ChecksSetting
    readonly determinism: Determinism
    readonly videoLimitBytes: number
  }
>()('shot/ShotConfig') {}

const configNames = ['shot.config.ts', 'shot.config.mts', 'shot.config.js', 'shot.config.mjs']

export const findConfigFile = (from: string): Option.Option<string> => {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const found = configNames.map((name) => path.join(dir, name)).find((file) => existsSync(file))

    if (found !== undefined) return Option.some(found)

    if (path.dirname(dir) === dir) return Option.none()
  }
}

/** The config throws on import, or exports no object. */
export class ShotConfigInvalidError extends Data.TaggedError('ShotConfigInvalidError')<{
  readonly file: string
  readonly reason: string
}> {}

/** Loads the nearest config above `cwd`. */
export const loadShotConfig = (cwd: string) =>
  Effect.gen(function* () {
    const configFile = findConfigFile(cwd)

    const loaded = yield* Option.match(configFile, {
      onNone: () => Effect.succeed<ShotConfigInput>({}),
      onSome: (file) =>
        Effect.tryPromise({
          try: () => import(pathToFileURL(file).href),
          catch: (cause) => new ShotConfigInvalidError({ file, reason: messageFromCause(cause) }),
        }).pipe(
          Effect.flatMap((module) =>
            Effect.gen(function* () {
              if (!Predicate.isObject(module.default)) {
                return yield* new ShotConfigInvalidError({
                  file,
                  reason: 'the default export is not defineConfig({...})',
                })
              }

              // SAFETY: `defineConfig` types the file; hooks and plugin layers cannot be decoded, so only "an object" is
              // checked here.
              return module.default as ShotConfigInput
            }),
          ),
        ),
    })

    const plugins = loaded.plugins ?? []

    const checks = yield* Effect.fromResult(
      checksSettingFromConfig({
        checks: loaded.checks,
        known: [...coreCheckNames, ...plugins.flatMap((plugin) => (plugin.checks ?? []).map((check) => check.check))],
      }),
    ).pipe(
      Effect.mapError(
        (reason) => new ShotConfigInvalidError({ file: Option.getOrElse(configFile, () => 'shot.config.ts'), reason }),
      ),
    )

    return ShotConfig.of({
      projectRoot: Option.match(configFile, { onNone: () => cwd, onSome: (file) => path.dirname(file) }),
      configFile,
      app: Option.fromNullishOr(loaded.app),
      plugins,
      checks,
      determinism: loaded.determinism ?? {},
      videoLimitBytes: videoLimitBytes(loaded.githubPlan ?? 'free'),
    })
  })

export const ShotConfigLayer = (cwd: string) => Layer.effect(ShotConfig, loadShotConfig(cwd))
