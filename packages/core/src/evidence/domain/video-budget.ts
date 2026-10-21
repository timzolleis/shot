import { Result } from 'effect'

import { VideoTooLargeError } from './evidence-error.ts'

/** How to encode a video: `width` (height follows), and a bitrate cap when the native encode is over the limit. */
export interface VideoEncoding {
  readonly width: number
  readonly bitrate: number | undefined
}

export const megabyte = 1024 * 1024

/** GitHub's limit for attached videos: 10 MB, or 100 MB when the repository owner is on a paid plan (B9). */
export const videoLimitBytes = (plan: 'free' | 'paid'): number => (plan === 'paid' ? 100 : 10) * megabyte

/** Playwright records at 25 fps. */
const framesPerSecond = 25

/** Below this many bits per pixel and frame, H.264 screen recordings smear text. */
const minimumBitsPerPixel = 0.1

/** Headroom for the container and rate-control overshoot. */
const budgetShare = 0.9
const widthLadder = [1920, 1440, 1280, 960, 720, 640, 480]

/**
 * The encoding that fits `limitBytes`: the native one when its `bytes` fit; else the widest width at which the
 * bitrate the budget allows still reads; else refused (B9).
 */
export const videoEncodingForBudget = (input: {
  readonly file: string
  readonly durationMs: number
  readonly width: number
  readonly height: number
  readonly bytes: number
  readonly limitBytes: number
}): Result.Result<VideoEncoding, VideoTooLargeError> => {
  if (input.bytes <= input.limitBytes) return Result.succeed({ width: input.width, bitrate: undefined })
  const bitrate = Math.floor((input.limitBytes * budgetShare * 8) / (input.durationMs / 1000))
  const aspect = input.height / input.width

  const width = [input.width, ...widthLadder.filter((candidate) => candidate < input.width)].find(
    (candidate) => bitrate / (candidate * candidate * aspect * framesPerSecond) >= minimumBitsPerPixel,
  )

  return width === undefined
    ? Result.fail(new VideoTooLargeError({ file: input.file, bytes: input.bytes, limitBytes: input.limitBytes }))
    : Result.succeed({ width, bitrate })
}
