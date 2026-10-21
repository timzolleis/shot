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
  /** Absolute paths of in-page modules bundled into the page runtime (`RuntimeExtension` exports). */
  readonly runtimeModules?: ReadonlyArray<string>
  readonly layer: Layer.Layer<R, never, ShotPlatform>
}
