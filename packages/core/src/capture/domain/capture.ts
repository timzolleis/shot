import { Schema } from 'effect'

/**
 * What one capture is: a source, a variant, a scene, a part and an output (A1). Every command builds a `Plan` of
 * captures; naming, grouping and outputs follow from these fields.
 */

export const UrlSource = Schema.TaggedStruct('UrlSource', { url: Schema.String })
export type UrlSource = typeof UrlSource.Type

/** `path` is concrete, with query and no `:param`: `/app/persons/abc?tab=contacts`. `user` is an email. */
export const RouteSource = Schema.TaggedStruct('RouteSource', {
  path: Schema.String,
  user: Schema.String,
  params: Schema.Record(Schema.String, Schema.String),
})
export type RouteSource = typeof RouteSource.Type

export const Source = Schema.Union([UrlSource, RouteSource])
export type Source = typeof Source.Type

export const Mode = Schema.Literals(['light', 'dark'])
export type Mode = typeof Mode.Type

export const Variant = Schema.Struct({
  mode: Mode,
  /** A Playwright device name; none = desktop. */
  device: Schema.Option(Schema.String),
  /** Viewport overrides; none = the device's, or 1280×900. */
  width: Schema.Option(Schema.Number),
  height: Schema.Option(Schema.Number),
  scale: Schema.Number,
  reducedMotion: Schema.Boolean,
})
export type Variant = typeof Variant.Type

export const Click = Schema.TaggedStruct('Click', { selector: Schema.String })
export const Fill = Schema.TaggedStruct('Fill', { selector: Schema.String, text: Schema.String })
export const Key = Schema.TaggedStruct('Key', { key: Schema.String })
export const Hover = Schema.TaggedStruct('Hover', { selector: Schema.String })
export const Focus = Schema.TaggedStruct('Focus', { selector: Schema.String })
export const Press = Schema.TaggedStruct('Press', { selector: Schema.String })
export const Wait = Schema.TaggedStruct('Wait', { ms: Schema.Number })
export const Step = Schema.Union([Click, Fill, Key, Hover, Focus, Press, Wait])
export type Step = typeof Step.Type
/** Steps that hold a state the still shows: they run after the others. */
export type HoldingStep = typeof Hover.Type | typeof Focus.Type | typeof Press.Type

export const WholePage = Schema.TaggedStruct('WholePage', {})
export const Viewport = Schema.TaggedStruct('Viewport', {})
/** `nth`: which of several sections with this title (0-based); none = the title must be unique. */
export const Section = Schema.TaggedStruct('Section', { title: Schema.String, nth: Schema.Option(Schema.Number) })
export type Section = typeof Section.Type
/** `within`: a section title the selector is scoped to. */
export const Selected = Schema.TaggedStruct('Selected', { selector: Schema.String, within: Schema.Option(Schema.String) })
export type Selected = typeof Selected.Type
export const Part = Schema.Union([WholePage, Viewport, Section, Selected])
export type Part = typeof Part.Type

export const overlays = ['boxes', 'gaps', 'edges', 'type', 'grid'] as const
export const Overlay = Schema.Literals(overlays)
export type Overlay = typeof Overlay.Type

export const Still = Schema.TaggedStruct('Still', { overlays: Schema.Array(Overlay), loupe: Schema.Option(Schema.Number) })
export const Frames = Schema.TaggedStruct('Frames', { count: Schema.Number, everyMs: Schema.Number, slow: Schema.Number })
export const Measure = Schema.TaggedStruct('Measure', { styles: Schema.Array(Schema.String), all: Schema.Boolean })
export const AriaTree = Schema.TaggedStruct('AriaTree', {})
export const Output = Schema.Union([Still, Frames, Measure, AriaTree])
export type Output = typeof Output.Type

export const Capture = Schema.Struct({
  source: Source,
  /** From `--name`; replaces the generated part of the key. */
  name: Schema.Option(Schema.String),
  variant: Variant,
  scene: Schema.Array(Step),
  part: Part,
  output: Output,
})
export type Capture = typeof Capture.Type

export type Plan = ReadonlyArray<Capture>

export const Rect = Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number })
export type Rect = typeof Rect.Type
