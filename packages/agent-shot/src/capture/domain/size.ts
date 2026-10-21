import { Match, Result, Schema } from 'effect'

import { UnknownSizeError } from './capture-error.ts'

/** What screen a capture is shot on (E16): a Playwright device, or a desktop browser of a width and height. */

/**
 * `device` is Playwright's name, in its casing: equal sizes give equal keys (E18). `width` and `height` are its
 * viewport in CSS pixels, so sheets order sizes narrowest first (E20).
 */
export const DeviceSize = Schema.TaggedStruct('DeviceSize', {
  device: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
})

export type DeviceSize = typeof DeviceSize.Type

export const ScreenSize = Schema.TaggedStruct('ScreenSize', { width: Schema.Number, height: Schema.Number })

export type ScreenSize = typeof ScreenSize.Type

export const Size = Schema.Union([DeviceSize, ScreenSize])

export type Size = typeof Size.Type

/** A device `--size` accepts: Playwright's name and viewport. */
export interface KnownDevice {
  readonly name: string
  readonly width: number
  readonly height: number
}

/** The viewports are Playwright's; a test keeps them equal. */
export const sizeAliases = {
  phone: DeviceSize.make({ device: 'iPhone 15', width: 393, height: 659 }),
  tablet: DeviceSize.make({ device: 'iPad Mini', width: 768, height: 1024 }),
  laptop: ScreenSize.make({ width: 1280, height: 900 }),
  desktop: ScreenSize.make({ width: 1440, height: 900 }),
} as const

/** Without `--size`: a laptop, the viewport shot used before sizes existed. */
export const defaultSize: Size = sizeAliases.laptop

const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }

    previous = current
  }

  return previous[b.length]!
}

/** The `count` candidates nearest to `needle`, for "did you mean". */
export const closestCandidates = (
  needle: string,
  candidates: ReadonlyArray<string>,
  count = 5,
): ReadonlyArray<string> =>
  candidates
    .map((candidate) => ({ candidate, distance: editDistance(needle.toLowerCase(), candidate.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map(({ candidate }) => candidate)

/**
 * An alias, `WxH` or a device name, case-insensitive (E16). `devices` are Playwright's device names: the domain gets
 * them without importing Playwright.
 */
export const sizeFromText = ({
  text,
  devices,
}: {
  readonly text: string
  readonly devices: ReadonlyArray<KnownDevice>
}): Result.Result<Size, UnknownSizeError> => {
  const wanted = text.trim().toLowerCase()
  const alias = Object.entries(sizeAliases).find(([name]) => name === wanted)

  if (alias !== undefined) return Result.succeed(alias[1])

  const screen = /^(\d+)x(\d+)$/.exec(wanted)

  if (screen !== null && Number(screen[1]) > 0 && Number(screen[2]) > 0) {
    return Result.succeed(ScreenSize.make({ width: Number(screen[1]), height: Number(screen[2]) }))
  }

  const device = devices.find(({ name }) => name.toLowerCase() === wanted)

  if (device !== undefined) {
    return Result.succeed(DeviceSize.make({ device: device.name, width: device.width, height: device.height }))
  }

  return Result.fail(
    new UnknownSizeError({
      text,
      closest: closestCandidates(text, [
        ...Object.keys(sizeAliases),
        ...devices.map(({ name }) => name).filter((name) => !name.endsWith('landscape')),
      ]),
    }),
  )
}

/** For people: `iPhone 15`, `1440×900`. */
export const sizeDescription = (size: Size): string =>
  Match.valueTags(size, {
    DeviceSize: ({ device }) => device,
    ScreenSize: ({ width, height }) => `${width}×${height}`,
  })

/** Narrowest first, as a layout grows (E20). */
export const sizeOrder = (a: Size, b: Size): number =>
  a.width - b.width || a.height - b.height || sizeDescription(a).localeCompare(sizeDescription(b))

/** Device sizes default to 2×, desktop screens to 1×. */
export const defaultScaleOfSize = (size: Size): number =>
  Match.valueTags(size, { DeviceSize: () => 2, ScreenSize: () => 1 })
