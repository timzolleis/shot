import { Effect, FileSystem, Layer, Schema } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

import { VideoEncoder } from '../evidence/application/video-encoder.ts'
import { VideoTooLargeError } from '../evidence/domain/evidence-error.ts'
import { type VideoEncoding, videoEncodingForBudget } from '../evidence/domain/video-budget.ts'
import { writeProgress } from './progress.ts'

/** `ffmpeg-static` exports the binary's path, or null on a platform it has no binary for. */
const decodeBundledFfmpeg = Schema.decodeUnknownSync(Schema.String)

/** `$SHOT_FFMPEG`, else `ffmpeg` on the PATH, else the bundled `ffmpeg-static`. */
const ffmpegBinary = (): string => {
  const fromEnv = process.env['SHOT_FFMPEG']

  if (fromEnv !== undefined) return fromEnv

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })

    return 'ffmpeg'
  } catch {
    return decodeBundledFfmpeg(createRequire(import.meta.url)('ffmpeg-static'))
  }
}

const ffmpegArgs = ({
  recording,
  output,
  encoding,
}: {
  recording: string
  output: string
  encoding: VideoEncoding
}) => [
  '-y',
  '-loglevel',
  'error',
  '-i',
  recording,
  '-an',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-preset',
  'veryfast',
  '-movflags',
  '+faststart',
  // Even dimensions: yuv420p needs them.
  '-vf',
  `scale=${encoding.width - (encoding.width % 2)}:-2`,
  ...(encoding.bitrate === undefined
    ? ['-crf', '23']
    : ['-b:v', `${encoding.bitrate}`, '-maxrate', `${encoding.bitrate}`, '-bufsize', `${encoding.bitrate * 2}`]),
  output,
]

export const FfmpegVideoEncoderLayer = Layer.effect(
  VideoEncoder,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem
    const binary = ffmpegBinary()

    const encode = (input: { recording: string; output: string; encoding: VideoEncoding }) =>
      Effect.gen(function* () {
        yield* spawner.string(ChildProcess.make(binary, ffmpegArgs(input))).pipe(Effect.orDie)

        return Number((yield* fs.stat(input.output).pipe(Effect.orDie)).size)
      })

    return VideoEncoder.of({
      encodeVideo: Effect.fn('VideoEncoder.encodeVideo')(function* ({
        recording,
        output,
        durationMs,
        width,
        height,
        limitBytes,
      }) {
        const native = { width, bitrate: undefined }
        const bytes = yield* encode({ recording, output, encoding: native })

        const encoding = yield* Effect.fromResult(
          videoEncodingForBudget({ file: output, durationMs, width, height, bytes, limitBytes }),
        )

        if (encoding.bitrate === undefined) return { file: output, bytes, width }
        writeProgress(
          `video: ${(bytes / 1024 / 1024).toFixed(1)} MB at ${width} wide; re-encoding at ${encoding.width} wide`,
        )
        const reencoded = yield* encode({ recording, output, encoding })

        if (reencoded > limitBytes) return yield* new VideoTooLargeError({ file: output, bytes: reencoded, limitBytes })

        return { file: output, bytes: reencoded, width: encoding.width }
      }),
    })
  }),
)
