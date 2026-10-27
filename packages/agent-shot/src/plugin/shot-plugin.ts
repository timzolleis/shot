import type { FileSystem, Layer, Path } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'

import type { ArtifactStore } from '../artifact/artifact-store.ts'
import type { Browser } from '../infrastructure/browser.ts'
import type { CaptureCheck } from './capture-check.ts'
import type { EvidencePublisher } from './evidence-publisher.ts'

/** What a plugin's layer may use. */
export type ShotPlatform =
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
  | Browser
  | ArtifactStore

/**
 * A plugin is data plus a layer. The core concatenates the arrays and merges the layers: no registry, no order. `Check`
 * is the union of its check names, for `checks` in the config.
 */
export interface ShotPlugin<R = never, Check extends string = never> {
  readonly name: string
  readonly checks?: ReadonlyArray<CaptureCheck<R, Check>>
  readonly publishers?: ReadonlyArray<EvidencePublisher<R>>
  /** Provides what Effect checks and publishers need beyond the platform; plain functions need none. */
  readonly layer?: Layer.Layer<Exclude<R, ShotPlatform>, never, ShotPlatform>
}

/** Types a plugin in its own file; inline in `defineConfig`, the config types it. */
export const definePlugin = <R = never, Check extends string = never>(
  plugin: ShotPlugin<R, Check>,
): ShotPlugin<R, Check> => plugin

/**
 * Any plugin, whatever it needs and its checks are called. `Layer` is contravariant in what it provides, so a layer
 * providing anything fits `Layer<never>`; with `ShotPlugin<any>`, a plugin without needs (`ShotPlugin<never>`) did not.
 */
export interface AnyShotPlugin extends Omit<ShotPlugin<any, string>, 'layer'> {
  readonly layer?: Layer.Layer<never, never, ShotPlatform>
}

/** The check names of a plugin, or of a union of plugins. */
export type CheckNameOfPlugin<P> = P extends { readonly checks?: ReadonlyArray<{ readonly check: infer Check }> }
  ? Extract<Check, string>
  : never
