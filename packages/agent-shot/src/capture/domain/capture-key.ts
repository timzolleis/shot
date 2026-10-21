import { Match, Option, Predicate, Schema } from 'effect'
import { createHash } from 'node:crypto'

import { Capture, type Output, type Part, Source, Step, Variant } from './capture.ts'
import type { Size } from './size.ts'

/** A capture's file name without extension: `<sourceSlug>--<readable>-<hash6>`. Equal captures get equal keys (A2). */
export type CaptureKey = string

const encodeCaptureJson = Schema.encodeSync(Schema.toCodecJson(Capture))

const encodeGroupJson = Schema.encodeSync(
  Schema.toCodecJson(Schema.Struct({ source: Source, variant: Variant, scene: Schema.Array(Step) })),
)

const isJsonArray = (value: Schema.JsonArray | Schema.JsonObject): value is Schema.JsonArray => Array.isArray(value)

const sortedJson = (value: Schema.Json): Schema.Json => {
  if (value === null || Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value))
    return value

  if (isJsonArray(value)) return value.map(sortedJson)

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortedJson(entry)]),
  )
}

/** JSON with sorted keys: equal values give equal strings. */
export const canonicalJson = (value: Schema.Json): string => JSON.stringify(sortedJson(value))

const hashOfText = (text: string, length = 6): string =>
  createHash('sha256').update(text).digest('hex').slice(0, length)

export const slugFromText = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 40)

/** A file URL's last path segment, query and hash: `compare.html?variant=c`. The directories stay local. */
const fileNameOfUrl = (url: string): string | undefined => {
  if (!url.startsWith('file://')) return undefined
  const { pathname, search, hash } = new URL(url)

  return `${decodeURIComponent(pathname.split('/').at(-1) ?? '')}${search}${hash}`
}

/** `route-app-persons`, `url-example-com-docs`, `file-compare-html`. */
export const sourceSlug = (source: Source): string =>
  Match.valueTags(source, {
    RouteSource: ({ path }) => ['route', slugFromText(path)].filter((part) => part !== '').join('-'),
    UrlSource: ({ url }) => {
      const fileName = fileNameOfUrl(url)

      return (
        fileName === undefined
          ? ['url', slugFromText(url.replace(/^https?:\/\//, ''))]
          : ['file', slugFromText(fileName)]
      )
        .filter((part) => part !== '')
        .join('-')
    },
  })

const partSlug = (part: Part): string | undefined =>
  Match.valueTags(part, {
    WholePage: () => undefined,
    Viewport: () => 'viewport',
    Section: ({ title, nth }) =>
      Option.match(nth, {
        onNone: () => slugFromText(title),
        onSome: (index) => `${slugFromText(title)}-${index + 1}`,
      }),
    Selected: ({ within }) => [...Option.toArray(Option.map(within, slugFromText)), 'select'].join('-'),
  })

const outputSlugs = (output: Output): ReadonlyArray<string> =>
  Match.valueTags(output, {
    Still: ({ overlays, loupe }) => [...overlays, ...Option.toArray(Option.map(loupe, (factor) => `loupe${factor}`))],
    Frames: () => ['frames'],
    Measure: () => ['measure'],
    AriaTree: () => ['aria'],
  })

const sourceSlugParts = (source: Source): ReadonlyArray<string> =>
  Match.valueTags(source, {
    RouteSource: ({ user, params }) => [
      slugFromText(user.split('@')[0] ?? user),
      ...Object.keys(params)
        .sort()
        .map((name) => slugFromText(params[name] ?? '')),
    ],
    UrlSource: () => [],
  })

const leadingSlugParts = (capture: Capture): ReadonlyArray<string | undefined> => [
  Option.getOrElse(Option.map(capture.name, slugFromText), () => partSlug(capture.part)),
  ...(Option.isSome(capture.name) ? [] : capture.scene.map((step) => step._tag.toLowerCase())),
  ...sourceSlugParts(capture.source),
]

const trailingSlugParts = (capture: Capture): ReadonlyArray<string> => [
  ...outputSlugs(capture.output),
  capture.variant.mode,
]

const slugFromParts = (parts: ReadonlyArray<string | undefined>): string =>
  parts.filter((part) => part !== undefined && part !== '').join('-')

/** `iphone-15`, `1440x900` (E18). */
export const sizeSlug = (size: Size): string =>
  Match.valueTags(size, {
    DeviceSize: ({ device }) => slugFromText(device),
    ScreenSize: ({ width, height }) => `${width}x${height}`,
  })

/** The readable part of the key: name or part, steps, user and params, size, output, mode. */
export const captureSlug = (capture: Capture): string =>
  slugFromParts([...leadingSlugParts(capture), sizeSlug(capture.variant.size), ...trailingSlugParts(capture)])

export const captureKey = (capture: Capture): CaptureKey =>
  `${sourceSlug(capture.source)}--${captureSlug(capture)}-${hashOfText(canonicalJson(encodeCaptureJson(capture)))}`

/** A sheet's file name: the capture key without size and mode, so one capture in every size and mode shares it (E20). */
export type SheetKey = string

/** A capture without its size and mode: the scale follows the size, so it goes too. */
const SheetCapture = Schema.Struct({
  ...Capture.fields,
  variant: Schema.Struct({ reducedMotion: Schema.Boolean }),
})

const encodeSheetCaptureJson = Schema.encodeSync(Schema.toCodecJson(SheetCapture))

export const sheetKey = (capture: Capture): SheetKey =>
  `${sourceSlug(capture.source)}--${slugFromParts([...leadingSlugParts(capture), ...outputSlugs(capture.output)])}-${hashOfText(
    canonicalJson(encodeSheetCaptureJson({ ...capture, variant: { reducedMotion: capture.variant.reducedMotion } })),
  )}`

/**
 * Captures sharing (source, variant, scene) share one page load. Frames need a load of their own: they start before
 * the page settles.
 */
export const captureGroupKey = (capture: Capture): string =>
  canonicalJson({
    group: encodeGroupJson({ source: capture.source, variant: capture.variant, scene: capture.scene }),
    frames: Predicate.isTagged(capture.output, 'Frames') ? encodeCaptureJson(capture) : null,
  })

export const captureFileExtension = (output: Output): 'png' | 'json' | 'txt' =>
  Match.valueTags(output, {
    Still: () => 'png' as const,
    Frames: () => 'png' as const,
    Measure: () => 'json' as const,
    AriaTree: () => 'txt' as const,
  })

/** For people: `/path as user`, the URL, or a file's name. */
export const sourceDescription = (source: Source): string =>
  Match.valueTags(source, {
    RouteSource: ({ path, user, params }) =>
      [`${path} as ${user}`, ...Object.entries(params).map(([name, value]) => `${name}=${value}`)].join(' '),
    UrlSource: ({ url }) => fileNameOfUrl(url) ?? url,
  })

export const partDescription = (part: Part): string =>
  Match.valueTags(part, {
    WholePage: () => 'page',
    Viewport: () => 'viewport',
    Section: ({ title, nth }) =>
      Option.match(nth, { onNone: () => title, onSome: (index) => `${title} >> nth=${index}` }),
    Selected: ({ selector, within }) =>
      Option.match(within, { onNone: () => selector, onSome: (title) => `${title} › ${selector}` }),
  })
