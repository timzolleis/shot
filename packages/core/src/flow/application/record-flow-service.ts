import { Context, Effect, Layer, Option } from 'effect'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ArtifactStore } from '../../artifact/artifact-store.ts'
import { type OpenSourceError, type ResolveSourceError, SourceProviders } from '../../capture/application/source-providers.ts'
import { slugFromText } from '../../capture/domain/capture-key.ts'
import { VideoEncoder } from '../../evidence/application/video-encoder.ts'
import type { VideoTooLargeError } from '../../evidence/domain/evidence-error.ts'
import { settlePage } from '../../infrastructure/page-lifecycle.ts'
import { effectFromHook, messageFromUnknown } from '../../plugin/hook.ts'
import { ShotConfig } from '../../plugin/shot-config.ts'
import type { Flow, FlowResult, FlowStill } from '../domain/flow.ts'
import { FlowInvalidError, FlowNotFoundError } from '../domain/flow-error.ts'
import type { FlowDefinition } from './define-flow.ts'

export interface RecordFlowCommand {
  /** A flow name (`shots/<name>.flow.ts`) or a file. */
  readonly flow: string
  readonly label: string
}

/** B: one flow file to stills, a video and a trace. */
export class RecordFlowService extends Context.Service<
  RecordFlowService,
  {
    recordFlow(
      command: RecordFlowCommand,
    ): Effect.Effect<
      FlowResult,
      FlowNotFoundError | FlowInvalidError | ResolveSourceError | OpenSourceError | VideoTooLargeError
    >
  }
>()('shot/RecordFlowService') {}

const sizeText = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Thrown inside the flow body to stop it after a failed step. */
class FlowStopped extends Error {}

const flowCandidates = ({ raw, projectRoot }: { readonly raw: string; readonly projectRoot: string }) => [
  path.resolve(raw),
  path.join(projectRoot, 'shots', `${raw}.flow.ts`),
  path.join(projectRoot, 'shots', raw),
]

const isFlowDefinition = (value: unknown): value is FlowDefinition =>
  typeof value === 'object' && value !== null && (value as { _tag?: unknown })._tag === 'FlowDefinition'

export const RecordFlowServiceLayer = Layer.effect(
  RecordFlowService,
  Effect.gen(function* () {
    const providers = yield* SourceProviders
    const store = yield* ArtifactStore
    const encoder = yield* VideoEncoder
    const config = yield* ShotConfig

    const loadFlow = (raw: string) =>
      Effect.gen(function* () {
        const looked = flowCandidates({ raw, projectRoot: config.projectRoot })
        const file = looked.find((candidate) => existsSync(candidate) && candidate.endsWith('.ts'))
        if (file === undefined) return yield* new FlowNotFoundError({ flow: raw, looked: looked.map((candidate) => path.relative(process.cwd(), candidate)) })
        const module = yield* Effect.tryPromise({
          try: () => import(pathToFileURL(file).href) as Promise<{ default?: unknown }>,
          catch: (error) => new FlowInvalidError({ file, reason: messageFromUnknown(error) }),
        })
        if (!isFlowDefinition(module.default)) {
          return yield* new FlowInvalidError({ file, reason: 'the default export is not defineFlow(...)' })
        }
        return { file, definition: module.default }
      })

    return RecordFlowService.of({
      recordFlow: Effect.fn('RecordFlowService.recordFlow')(function* ({ flow: raw, label }) {
        const { file, definition } = yield* loadFlow(raw)
        const { header, body } = definition
        const name = path.basename(file).replace(/\.flow\.ts$|\.ts$/, '')
        const params = header.params ?? {}
        const source = yield* providers.resolveSource({ raw: header.start, as: Option.fromNullishOr(header.as), params })
        const flow: Flow = {
          name,
          file: path.relative(store.projectRoot, file),
          start: header.start,
          as: source._tag === 'RouteSource' ? source.user : '',
          params,
        }
        const dir = yield* store.makeFlowDir({ label, name })
        const recordingDir = store.absolutePath(path.join(dir, 'recording'))
        const variant = {
          mode: header.mode ?? 'light',
          device: Option.fromNullishOr(header.device),
          width: Option.fromNullishOr(header.width),
          height: Option.fromNullishOr(header.height),
          scale: 1,
          reducedMotion: false,
        } as const
        const recorded = yield* Effect.scoped(
          Effect.gen(function* () {
            const startedAt = Date.now()
            const ready = yield* providers.openSource({
              source,
              variant,
              options: { settle: true, slowClock: false, recordVideoDir: Option.some(recordingDir) },
            })
            const { page, context } = ready
            yield* Effect.promise(() => context.tracing.start({ screenshots: true, snapshots: true }))
            const stills: Array<FlowStill> = []
            let stopped: Option.Option<{ step: string; reason: string }> = Option.none()
            const step = async (stepName: string, action: () => unknown) => {
              if (Option.isSome(stopped)) throw new FlowStopped()
              process.stderr.write(`step ${stepName}\n`)
              try {
                await Effect.runPromise(effectFromHook(() => action() as never, (message) => new Error(message)))
              } catch (error) {
                stopped = Option.some({ step: stepName, reason: messageFromUnknown(error) })
                throw new FlowStopped()
              }
              await Effect.runPromise(settlePage(page))
              const still = path.join(dir, `${String(stills.length + 1).padStart(2, '0')}-${slugFromText(stepName)}.png`)
              await page.screenshot({ path: store.absolutePath(still), animations: 'disabled' })
              stills.push({ step: stepName, file: still })
            }
            yield* Effect.promise(async () => {
              try {
                await Effect.runPromise(effectFromHook(() => body({ page, step }) as never, (message) => new Error(message)))
              } catch (error) {
                if (Option.isNone(stopped) && !(error instanceof FlowStopped)) {
                  stopped = Option.some({ step: '(outside a step)', reason: messageFromUnknown(error) })
                }
              }
            })
            const trace = path.join(dir, 'trace.zip')
            yield* Effect.promise(() => context.tracing.stop({ path: store.absolutePath(trace) }))
            const video = page.video()
            const viewport = page.viewportSize() ?? { width: 1280, height: 900 }
            // The video file is complete once its context closes.
            yield* Effect.promise(() => context.close())
            const recording = video === null ? undefined : yield* Effect.promise(() => video.path())
            return { stills, stopped, trace, recording, viewport, durationMs: Date.now() - startedAt }
          }),
        )
        const videoFile = path.join(dir, `${name}.mp4`)
        if (recorded.recording !== undefined) {
          const encoded = yield* encoder.encodeVideo({
            recording: recorded.recording,
            output: store.absolutePath(videoFile),
            durationMs: recorded.durationMs,
            width: recorded.viewport.width,
            height: recorded.viewport.height,
            limitBytes: config.videoLimitBytes,
          })
          process.stderr.write(`video: ${sizeText(encoded.bytes)} at ${encoded.width} wide\n`)
          yield* Effect.promise(() => rm(recordingDir, { recursive: true, force: true }))
        }
        const flowResult: FlowResult = Option.match(recorded.stopped, {
          onNone: () => ({ _tag: 'CompletedFlow' as const, flow, stills: recorded.stills, video: videoFile, trace: recorded.trace }),
          onSome: ({ step, reason }) => ({
            _tag: 'StoppedFlow' as const,
            flow,
            stills: recorded.stills,
            video: videoFile,
            trace: recorded.trace,
            failedStep: step,
            reason,
          }),
        })
        yield* store.writeFlowResult({ label, flowResult })
        return flowResult
      }),
    })
  }),
)
