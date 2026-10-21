import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'

import { AppHooksLayer } from './app/app-hooks.ts'
import { AppSessionsLayer } from './app/app-sessions.ts'
import { LogInServiceLayer } from './app/log-in-service.ts'
import { CaptureRunnerLayer } from './capture/application/capture-runner.ts'
import { ShootTargetServiceLayer } from './capture/application/shoot-target-service.ts'
import { SourceProvidersLayer } from './capture/application/source-providers.ts'
import { CaptureChecksLayer } from './checks/capture-checks.ts'
import {
  EvidencePublishersLayer,
  PublishEvidenceServiceLayer,
} from './evidence/application/publish-evidence-service.ts'
import { RecordFlowServiceLayer } from './flow/application/record-flow-service.ts'
import { PlaywrightBrowserLayer } from './infrastructure/browser.ts'
import { FfmpegVideoEncoderLayer } from './infrastructure/ffmpeg-video-encoder.ts'
import { FileArtifactStoreLayer } from './infrastructure/file-artifact-store.ts'
import { PageRuntimeLayer } from './infrastructure/page-runtime.ts'
import { SheetsLayer } from './infrastructure/sheets.ts'
import { ShotConfig, ShotConfigLayer } from './plugin/shot-config.ts'

/** Everything a command needs, for the project whose config is nearest `cwd`. The browser launches on first use. */
export const shotLayer = (cwd: string) => {
  const config = ShotConfigLayer(cwd)
  const platform = Layer.mergeAll(NodeServices.layer, config)
  const browser = PlaywrightBrowserLayer
  const sheets = SheetsLayer.pipe(Layer.provide(browser))
  const store = FileArtifactStoreLayer.pipe(Layer.provide([sheets, platform]))
  const shotPlatform = Layer.mergeAll(platform, browser, store)

  const plugins = Layer.unwrap(
    Effect.map(ShotConfig, (loaded) => Layer.mergeAll(Layer.empty, ...loaded.plugins.map((plugin) => plugin.layer))),
  ).pipe(Layer.provide(shotPlatform))

  const runtime = PageRuntimeLayer
  const hooks = AppHooksLayer.pipe(Layer.provide(config))
  const sessions = AppSessionsLayer.pipe(Layer.provide([hooks, shotPlatform]))
  const providers = SourceProvidersLayer.pipe(Layer.provide([hooks, sessions, runtime, shotPlatform]))
  const checks = CaptureChecksLayer.pipe(Layer.provide([runtime, plugins, config]))
  const runner = CaptureRunnerLayer.pipe(Layer.provide([providers, runtime, checks, sheets, shotPlatform]))
  const encoder = FfmpegVideoEncoderLayer.pipe(Layer.provide(platform))
  const publishers = EvidencePublishersLayer.pipe(Layer.provide([plugins, shotPlatform]))

  return Layer.mergeAll(
    ShootTargetServiceLayer.pipe(Layer.provide([providers, runner, shotPlatform])),
    RecordFlowServiceLayer.pipe(Layer.provide([providers, encoder, shotPlatform])),
    PublishEvidenceServiceLayer.pipe(Layer.provide([publishers, shotPlatform])),
    LogInServiceLayer.pipe(Layer.provide([hooks, sessions, shotPlatform])),
    shotPlatform,
  )
}
