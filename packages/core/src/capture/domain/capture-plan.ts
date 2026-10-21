import { Option, Result } from 'effect'

import {
  AriaTree,
  type Capture,
  Frames,
  type HoldingStep,
  Measure,
  type Mode,
  type Output,
  type Overlay,
  type Part,
  type Plan,
  Section,
  Selected,
  type Source,
  Step,
  Still,
  type Variant,
  Viewport,
  WholePage,
} from './capture.ts'
import { ConflictingOutputsError } from './capture-error.ts'

/** What the flags of `shot <target>` say about the plan. */
export interface ShootFlags {
  readonly modes: ReadonlyArray<Mode>
  readonly device: Option.Option<string>
  readonly width: Option.Option<number>
  readonly height: Option.Option<number>
  readonly scale: Option.Option<number>
  readonly reducedMotion: boolean
  readonly steps: ReadonlyArray<Step>
  readonly sections: ReadonlyArray<string>
  readonly selects: ReadonlyArray<string>
  readonly viewport: boolean
  readonly overlays: ReadonlyArray<Overlay>
  readonly loupe: Option.Option<number>
  readonly frames: Option.Option<{ readonly count: number; readonly everyMs: number; readonly slow: number }>
  readonly measure: Option.Option<{ readonly styles: ReadonlyArray<string>; readonly all: boolean }>
  readonly aria: boolean
  readonly name: Option.Option<string>
}

export const defaultShootFlags: ShootFlags = {
  modes: ['light'],
  device: Option.none(),
  width: Option.none(),
  height: Option.none(),
  scale: Option.none(),
  reducedMotion: false,
  steps: [],
  sections: [],
  selects: [],
  viewport: false,
  overlays: [],
  loupe: Option.none(),
  frames: Option.none(),
  measure: Option.none(),
  aria: false,
  name: Option.none(),
}

/** True when the flags pick a part, a scene or an output: then they are the plan, not the source's default. */
export const isPlanInFlags = (flags: ShootFlags): boolean =>
  flags.steps.length > 0 ||
  flags.sections.length > 0 ||
  flags.selects.length > 0 ||
  flags.viewport ||
  flags.overlays.length > 0 ||
  Option.isSome(flags.loupe) ||
  Option.isSome(flags.frames) ||
  Option.isSome(flags.measure) ||
  flags.aria

/** `Sizes`, or `Sizes >> nth=1` for a title that appears more than once. */
export const sectionFromTitle = (text: string): Section => {
  const match = /^(.*?)\s*>>\s*nth=(\d+)$/.exec(text)

  return match === null
    ? Section.make({ title: text, nth: Option.none() })
    : Section.make({ title: match[1] ?? '', nth: Option.some(Number(match[2])) })
}

export const variantsFromFlags = (flags: ShootFlags): ReadonlyArray<Variant> =>
  flags.modes.map((mode) => ({
    mode,
    device: flags.device,
    width: flags.width,
    height: flags.height,
    scale: Option.getOrElse(flags.scale, () => (Option.isSome(flags.device) ? 2 : 1)),
    reducedMotion: flags.reducedMotion,
  }))

const outputFromFlags = (flags: ShootFlags): Result.Result<Output, ConflictingOutputsError> => {
  const picked = [
    ...(Option.isSome(flags.frames) ? ['--frames'] : []),
    ...(Option.isSome(flags.measure) ? ['--measure'] : []),
    ...(flags.aria ? ['--aria'] : []),
  ]

  const stillOnly = [
    ...(flags.overlays.length > 0 ? ['--overlay'] : []),
    ...(Option.isSome(flags.loupe) ? ['--loupe'] : []),
  ]

  if (picked.length > 1 || (picked.length === 1 && stillOnly.length > 0)) {
    return Result.fail(new ConflictingOutputsError({ outputs: [...picked, ...stillOnly] }))
  }

  if (Option.isSome(flags.frames)) return Result.succeed(Frames.make(flags.frames.value))

  if (Option.isSome(flags.measure)) return Result.succeed(Measure.make(flags.measure.value))

  if (flags.aria) return Result.succeed(AriaTree.make({}))

  return Result.succeed(Still.make({ overlays: flags.overlays, loupe: flags.loupe }))
}

const partsFromFlags = (flags: ShootFlags): ReadonlyArray<Part> => {
  if (flags.selects.length > 0) {
    const scopes = flags.sections.length > 0 ? flags.sections.map((title) => Option.some(title)) : [Option.none()]

    return flags.selects.flatMap((selector) => scopes.map((within): Part => Selected.make({ selector, within })))
  }

  if (flags.sections.length > 0) return flags.sections.map(sectionFromTitle)

  return [flags.viewport ? Viewport.make({}) : WholePage.make({})]
}

const isHoldingStep: (step: Step) => step is HoldingStep = Step.isAnyOf(['Hover', 'Focus', 'Press'])

/** Hover, focus and press hold the state the still shows: they run after the other steps, in their order. */
export const sceneFromSteps = (steps: ReadonlyArray<Step>): ReadonlyArray<Step> => [
  ...steps.filter((step) => !isHoldingStep(step)),
  ...steps.filter(isHoldingStep),
]

const crossCaptures = (input: {
  readonly source: Source
  readonly name: Option.Option<string>
  readonly variants: ReadonlyArray<Variant>
  readonly scene: ReadonlyArray<Step>
  readonly parts: ReadonlyArray<Part>
  readonly output: Output
}): Plan =>
  input.variants.flatMap((variant) =>
    input.parts.map((part): Capture => ({
      source: input.source,
      name: input.name,
      variant,
      scene: input.scene,
      part,
      output: input.output,
    })),
  )

export const planCapturesFromFlags = ({
  source,
  flags,
}: {
  readonly source: Source
  readonly flags: ShootFlags
}): Result.Result<Plan, ConflictingOutputsError> =>
  Result.map(outputFromFlags(flags), (output) =>
    crossCaptures({
      source,
      name: flags.name,
      variants: variantsFromFlags(flags),
      scene: sceneFromSteps(flags.steps),
      parts: partsFromFlags(flags),
      output,
    }),
  )

/** One still per section in the outline, else the page. */
export const planDefaultCaptures = ({
  source,
  flags,
  sections,
}: {
  readonly source: Source
  readonly flags: ShootFlags
  readonly sections: ReadonlyArray<string>
}): Plan =>
  crossCaptures({
    source,
    name: Option.none(),
    variants: variantsFromFlags(flags),
    scene: [],
    parts:
      sections.length === 0
        ? [WholePage.make({})]
        : sections.map((title, index): Part => {
            const repeats = sections.filter((other) => other === title).length
            const nth = sections.slice(0, index).filter((other) => other === title).length

            return Section.make({ title, nth: repeats > 1 ? Option.some(nth) : Option.none() })
          }),
    output: Still.make({ overlays: [], loupe: Option.none() }),
  })
