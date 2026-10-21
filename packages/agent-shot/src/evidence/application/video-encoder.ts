import { Context, type Effect } from 'effect'

import type { VideoTooLargeError } from '../domain/evidence-error.ts'

export interface EncodedVideo {
  readonly file: string
  readonly bytes: number
  readonly width: number
}

/** A recording to H.264 within the publish limit: lower resolution and bitrate first, else refused (B9). */
export class VideoEncoder extends Context.Service<
  VideoEncoder,
  {
    encodeVideo(input: {
      /** Absolute paths. */
      readonly recording: string
      readonly output: string
      readonly durationMs: number
      readonly width: number
      readonly height: number
      readonly limitBytes: number
    }): Effect.Effect<EncodedVideo, VideoTooLargeError>
  }
>()('shot/VideoEncoder') {}
