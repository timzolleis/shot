import { Context, Effect, Layer, Match, Option, Result, Schema, SchemaIssue } from 'effect'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ArtifactStore } from '../../artifact/artifact-store.ts'
import {
  type OpenSourceError,
  type ResolveSourceError,
  SourceProviders,
} from '../../capture/application/source-providers.ts'
import { slugFromText } from '../../capture/domain/capture-key.ts'
import type { UnknownSizeError } from '../../capture/domain/capture-error.ts'
import { defaultSize, type Size, sizeFromText } from '../../capture/domain/size.ts'
import { VideoEncoder } from '../../evidence/application/video-encoder.ts'
import type { VideoTooLargeError } from '../../evidence/domain/evidence-error.ts'
import { playwrightDevices, settlePage } from '../../infrastructure/page-lifecycle.ts'
import { effectFromHook, type Hook, messageFromCause } from '../../plugin/hook.ts'
import { ShotConfig } from '../../plugin/shot-config.ts'
import { CompletedFlow, type Flow, type FlowResult, type FlowStill, StoppedFlow } from '../domain/flow.ts'
import { FlowInvalidError, FlowNotFoundError } from '../domain/flow-error.ts'
import { FlowDefinition } from './define-flow.ts'
import { writeProgress } from '../../infrastructure/progress.ts'

export interface RecordFlowCommand {
  /** A flow name (`shots/<name>.flow.ts`) or a file. */
  readonly flow: string
  readonly label: string
  /** `--size`: wins over the header's (E21). */
  readonly size: Option.Option<Size>
}

/** B: one flow file to stills, a video and a trace. */
export class RecordFlowService extends Context.Service<
  RecordFlowService,
  {
    recordFlow(
      command: RecordFlowCommand,
    ): Effect.Effect<
      FlowResult,
      | FlowNotFoundError
      | FlowInvalidError
      | UnknownSizeError
      | ResolveSourceError
      | OpenSourceError
      | VideoTooLargeError
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

const decodeFlowModule = Schema.decodeUnknownEffect(Schema.Struct({ default: FlowDefinition }))

const formatIssue = SchemaIssue.makeFormatterDefault()

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

        if (file === undefined)
          return yield* new FlowNotFoundError({
            flow: raw,
            looked: looked.map((candidate) => path.relative(process.cwd(), candidate)),
          })

        const module = yield* Effect.tryPromise({
          try: () => import(pathToFileURL(file).href),
          catch: (cause) => new FlowInvalidError({ file, reason: messageFromCause(cause) }),
        })

        const decoded = yield* decodeFlowModule(module).pipe(
          Effect.mapError(
            (error) =>
              new FlowInvalidError({
                file,
                reason: `the default export is not defineFlow(...): ${formatIssue(error.issue)}`,
              }),
          ),
        )

        return { file, definition: decoded.default }
      })

    return RecordFlowService.of({
      recordFlow: Effect.fn('RecordFlowService.recordFlow')(function* ({ flow: raw, label, size: sizeFlag }) {
        const { file, definition } = yield* loadFlow(raw)
        const { header, body } = definition
        const name = path.basename(file).replace(/\.flow\.ts$|\.ts$/, '')
        const params = header.params ?? {}

        const source = yield* providers.resolveSource({
          raw: header.start,
          as: Option.fromNullishOr(header.as),
          params,
        })

        const headerSize = yield* Effect.fromResult(
          header.size === undefined
            ? Result.succeed(defaultSize)
            : sizeFromText({ text: header.size, devices: playwrightDevices }),
        )

        const size = Option.getOrElse(sizeFlag, () => headerSize)

        const flow: Flow = {
          name,
          file: path.relative(store.projectRoot, file),
          start: header.start,
          as: Match.valueTags(source, { RouteSource: ({ user }) => user, UrlSource: () => '' }),
          params,
          size,
        }

        const dir = yield* store.makeFlowDir({ label, flow })
        const recordingDir = store.absolutePath(path.join(dir, 'recording'))

        // Scale 1: the video's size follows the viewport, and the budget counts pixels (B9).
        const variant = { mode: header.mode ?? 'light', size, scale: 1, reducedMotion: false } as const

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

            const step = async <A>(stepName: string, action: () => Hook<A>) => {
              if (Option.isSome(stopped)) throw new FlowStopped()
              writeProgress(`step ${stepName}`)

              try {
                await Effect.runPromise(effectFromHook(action, (message) => new Error(message)))
              } catch (error) {
                stopped = Option.some({ step: stepName, reason: messageFromCause(error) })
                throw new FlowStopped()
              }

              await Effect.runPromise(settlePage(page))

              const still = path.join(
                dir,
                `${String(stills.length + 1).padStart(2, '0')}-${slugFromText(stepName)}.png`,
              )

              await page.screenshot({ path: store.absolutePath(still), animations: 'disabled' })
              stills.push({ step: stepName, file: still })
            }

            yield* Effect.promise(async () => {
              try {
                await Effect.runPromise(
                  effectFromHook(
                    () => body({ page, step }),
                    (message) => new Error(message),
                  ),
                )
              } catch (error) {
                if (Option.isNone(stopped) && !(error instanceof FlowStopped)) {
                  stopped = Option.some({ step: '(outside a step)', reason: messageFromCause(error) })
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

          writeProgress(`video: ${sizeText(encoded.bytes)} at ${encoded.width} wide`)
          yield* Effect.promise(() => rm(recordingDir, { recursive: true, force: true }))
        }

        const flowResult: FlowResult = Option.match(recorded.stopped, {
          onNone: () => CompletedFlow.make({ flow, stills: recorded.stills, video: videoFile, trace: recorded.trace }),
          onSome: ({ step, reason }) =>
            StoppedFlow.make({
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
