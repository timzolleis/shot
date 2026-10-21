import {
  ArtifactStore,
  CaptureResult,
  defaultShootFlags,
  FlowResult,
  LogInService,
  outlineText,
  PublishEvidenceService,
  RecordFlowService,
  ShootTargetService,
  type ShootFlags,
} from '@shot/core'
import { Effect, Option, Schema } from 'effect'
import { Argument, Command, Flag } from 'effect/cli'
import { readFileSync } from 'node:fs'

import { labelFromFlag, listFromFlag, modesFromFlag, overlaysFromFlag, paramsFromFlags, stepsFromArgv } from './flags.ts'
import { anyErrorFinding, displayPath, printCaptureResults, printLine } from './output.ts'

const asFlag = Flag.String('as').pipe(Flag.withDescription('the user: an alias from the config, or an email'), Flag.optional)
const paramFlag = Flag.String('param').pipe(
  Flag.withDescription('a login param for the logIn hook, name=value (e.g. org=acme); repeatable'),
  Flag.atLeast(0),
)
const labelFlag = Flag.String('label').pipe(
  Flag.withDescription('write into .shots/<session>/<label>/ (before, after); same keys across labels'),
  Flag.optional,
)
const jsonFlag = Flag.Boolean('json').pipe(Flag.withDescription('print results as JSON'), Flag.withDefault(false))
const steps = (name: string, description: string) => Flag.String(name).pipe(Flag.withDescription(description), Flag.atLeast(0))
const optionalNumber = (name: string, description: string) =>
  Flag.Finite(name).pipe(Flag.withDescription(description), Flag.optional)

const shootFlags = {
  target: Argument.String('target').pipe(
    Argument.withDescription('an app path (/settings, /app/persons/abc) or a URL'),
    Argument.optional,
  ),
  as: asFlag,
  param: paramFlag,
  label: labelFlag,
  json: jsonFlag,
  mode: Flag.String('mode').pipe(Flag.withDescription('light, dark or both (default light)'), Flag.withDefault('light')),
  mobile: Flag.Boolean('mobile').pipe(Flag.withDescription('same as --device "iPhone 15"'), Flag.withDefault(false)),
  device: Flag.String('device').pipe(Flag.withDescription('a Playwright device: "Pixel 8", "iPad Mini"'), Flag.optional),
  width: optionalNumber('width', 'viewport width (default 1280, or the device\'s)'),
  height: optionalNumber('height', 'viewport height (default 900, or the device\'s)'),
  scale: optionalNumber('scale', 'device scale factor (default 1, 2 with a device)'),
  reducedMotion: Flag.Boolean('reduced-motion').pipe(Flag.withDescription('prefers-reduced-motion: reduce'), Flag.withDefault(false)),
  click: steps('click', 'scene step, in command-line order'),
  fill: steps('fill', 'scene step: <css>=<text>'),
  key: steps('key', 'scene step: a key (Enter, Escape)'),
  hover: steps('hover', 'scene step, runs last and holds'),
  focus: steps('focus', 'scene step, runs last and holds; checks the focus ring with --check'),
  press: steps('press', 'scene step: mouse down, runs last and holds'),
  wait: steps('wait', 'scene step: wait <ms>'),
  section: Flag.String('section').pipe(
    Flag.withDescription('a section by title (exact, else unique substring; "Title >> nth=1"); repeatable'),
    Flag.atLeast(0),
  ),
  select: Flag.String('select').pipe(Flag.withDescription('the first visible match, 16px around it; repeatable'), Flag.atLeast(0)),
  viewport: Flag.Boolean('viewport').pipe(Flag.withDescription('only the viewport'), Flag.withDefault(false)),
  overlay: Flag.String('overlay').pipe(Flag.withDescription('boxes,gaps,edges,type,grid'), Flag.optional),
  loupe: optionalNumber('loupe', 'the part at n×, nearest-neighbour'),
  frames: optionalNumber('frames', 'n frames from the scene\'s last step, on one sheet'),
  every: optionalNumber('every', 'ms of animation time between frames (default 50)'),
  slow: optionalNumber('slow', 'animation speed for frames (0.1 = 10× slower)'),
  measure: Flag.Boolean('measure').pipe(Flag.withDescription('JSON per match: box, spacing, radius, font'), Flag.withDefault(false)),
  style: Flag.String('style').pipe(Flag.withDescription('computed styles for --measure, comma-separated'), Flag.optional),
  all: Flag.Boolean('all').pipe(Flag.withDescription('--measure every match, not the first'), Flag.withDefault(false)),
  aria: Flag.Boolean('aria').pipe(Flag.withDescription('the part\'s accessibility tree as text'), Flag.withDefault(false)),
  check: Flag.Boolean('check').pipe(Flag.withDescription('run the checks (overflow, target, focus, align, plugins\')'), Flag.withDefault(false)),
  name: Flag.String('name').pipe(Flag.withDescription('name the files instead of the generated slug'), Flag.optional),
}

type ShootInput = Command.Command.Config.Infer<typeof shootFlags>

const shootFlagsFromInput = (input: ShootInput): ShootFlags => ({
  ...defaultShootFlags,
  modes: modesFromFlag(input.mode),
  device: Option.orElse(input.device, () => (input.mobile ? Option.some('iPhone 15') : Option.none())),
  width: input.width,
  height: input.height,
  scale: input.scale,
  reducedMotion: input.reducedMotion,
  steps: stepsFromArgv(process.argv.slice(2)),
  sections: input.section,
  selects: input.select,
  viewport: input.viewport,
  overlays: Option.match(input.overlay, { onNone: () => [], onSome: overlaysFromFlag }),
  loupe: input.loupe,
  frames: Option.map(input.frames, (count) => ({
    count,
    everyMs: Option.getOrElse(input.every, () => 50),
    slow: Option.getOrElse(input.slow, () => 1),
  })),
  measure: input.measure
    ? Option.some({ styles: Option.match(input.style, { onNone: () => [], onSome: listFromFlag }), all: input.all })
    : Option.none(),
  aria: input.aria,
  name: input.name,
})

const labelOf = (label: Option.Option<string>) => Option.match(label, { onNone: () => '', onSome: labelFromFlag })

const encodeResultsJson = Schema.encodeSync(Schema.toCodecJson(Schema.Array(CaptureResult)))
const encodeFlowJson = Schema.encodeSync(Schema.toCodecJson(FlowResult))

export const shot = Command.make('shot', shootFlags, (input) =>
  Effect.gen(function* () {
    if (Option.isNone(input.target)) return yield* printLine(readUsage())
    const service = yield* ShootTargetService
    const results = yield* service.shootTarget({
      raw: input.target.value,
      as: input.as,
      params: paramsFromFlags(input.param),
      label: labelOf(input.label),
      flags: shootFlagsFromInput(input),
      runChecks: input.check,
    })
    if (input.json) yield* printLine(JSON.stringify(encodeResultsJson(results), null, 2))
    else yield* printCaptureResults(results)
    if (anyErrorFinding(results)) process.exitCode = 1
  }),
).pipe(Command.withDescription('Shoot an app path or a URL: stills, overlays, measurements, checks.'))

const outline = Command.make(
  'outline',
  { target: Argument.String('target'), as: asFlag, param: paramFlag },
  ({ target, as, param }) =>
    Effect.gen(function* () {
      const service = yield* ShootTargetService
      const { outline } = yield* service.readTargetOutline({ raw: target, as, params: paramsFromFlags(param), flags: defaultShootFlags })
      yield* printLine(outline.length === 0 ? '(no titled sections: shoot the page or --select)' : outlineText(outline))
    }),
).pipe(Command.withDescription('Section titles of a target, for --section.'))

const flow = Command.make(
  'flow',
  { flow: Argument.String('flow').pipe(Argument.withDescription('a name (shots/<name>.flow.ts) or a file')), label: labelFlag, json: jsonFlag },
  ({ flow: raw, label, json }) =>
    Effect.gen(function* () {
      const service = yield* RecordFlowService
      const result = yield* service.recordFlow({ flow: raw, label: labelOf(label) })
      if (json) yield* printLine(JSON.stringify(encodeFlowJson(result), null, 2))
      else {
        for (const still of result.stills) yield* printLine(yield* displayPath(still.file))
        yield* printLine(yield* displayPath(result.video))
        yield* printLine(yield* displayPath(result.trace))
      }
      if (result._tag === 'StoppedFlow') {
        yield* printLine(`error flow     ${result.flow.name}: step ${result.failedStep}: ${result.reason}`)
        process.exitCode = 1
      }
    }),
).pipe(Command.withDescription('Record a flow: a still per step, a video and a trace.'))

const publish = Command.make(
  'publish',
  {
    pr: Flag.Int('pr').pipe(Flag.withDescription('the PR number (default: the current branch\'s)'), Flag.optional),
    publisher: Flag.String('publisher').pipe(Flag.withDescription('a configured publisher (default: the first)'), Flag.optional),
  },
  ({ pr, publisher }) =>
    Effect.gen(function* () {
      const service = yield* PublishEvidenceService
      const { reportFile, published } = yield* service.publishEvidence({ pr, publisher })
      yield* printLine(yield* displayPath(reportFile))
      yield* printLine(`published ${published.attachments} files to ${published.url}`)
    }),
).pipe(Command.withDescription('Publish the session\'s evidence to the PR body, replacing the last publish.'))

const login = Command.make(
  'login',
  { as: Flag.String('as').pipe(Flag.withDescription('an alias from the config, or an email')), param: paramFlag },
  ({ as, param }) =>
    Effect.gen(function* () {
      const service = yield* LogInService
      const { url, host, user } = yield* service.logIn({ as, params: paramsFromFlags(param) })
      yield* printLine(`logged in as ${user} at ${url}; default user for app paths on ${host}`)
    }),
).pipe(Command.withDescription('Log in fresh through the logIn hook and make the user the default.'))

const logout = Command.make('logout', { as: asFlag }, ({ as }) =>
  Effect.gen(function* () {
    const service = yield* LogInService
    const { host, removed } = yield* service.logOut({ as })
    yield* printLine(`removed ${removed} ${removed === 1 ? 'session' : 'sessions'} on ${host}`)
  }),
).pipe(Command.withDescription('Delete cached sessions.'))

const clean = Command.make(
  'clean',
  { all: Flag.Boolean('all').pipe(Flag.withDescription('every session and cached login'), Flag.withDefault(false)) },
  ({ all }) =>
    Effect.gen(function* () {
      const store = yield* ArtifactStore
      const removed = yield* store.clean({ all })
      yield* printLine(`removed ${yield* displayPath(removed)}`)
    }),
).pipe(Command.withDescription('Delete this session\'s files (--all: every session; login defaults stay).'))

const skillFile = new URL('../../../skill/SKILL.md', import.meta.url)

const skill = Command.make('skill', {}, () => printLine(readFileSync(skillFile, 'utf8').trimEnd())).pipe(
  Command.withDescription('Print the agent instructions.'),
)

const readUsage = () =>
  [
    'shot: agents prove UI work. Shoot what changed, before and after; record flows; publish evidence to the PR.',
    '',
    '  shot <path|url> [flags]       shoot (shot --help for flags)',
    '  shot outline <path|url>       section titles, for --section',
    '  shot flow <name|file>         record a flow: stills, video, trace',
    '  shot publish [--pr n]         the session\'s evidence into the PR body',
    '  shot login --as <user>        log in and make the user the default',
    '  shot logout [--as <user>]     delete cached sessions',
    '  shot clean [--all]            delete this session\'s files',
    '  shot skill                    the agent instructions',
  ].join('\n')

export const shotCommand = shot.pipe(Command.withSubcommands([outline, flow, publish, login, logout, clean, skill]))
