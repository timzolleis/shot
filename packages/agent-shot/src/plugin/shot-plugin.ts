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

/** A plugin is data plus a layer. The core concatenates the arrays and merges the layers: no registry, no order. */
export interface ShotPlugin<R = never> {
  readonly name: string
  readonly checks?: ReadonlyArray<CaptureCheck<R>>
  readonly publishers?: ReadonlyArray<EvidencePublisher<R>>
  /** Provides what Effect checks and publishers need beyond the platform; plain functions need none. */
  readonly layer?: Layer.Layer<Exclude<R, ShotPlatform>, never, ShotPlatform>
}

/** Types a plugin in its own file; inline in `defineConfig`, the config types it. */
export const definePlugin = <R = never>(plugin: ShotPlugin<R>): ShotPlugin<R> => plugin
