import {
  ArtifactStore,
  CapturedResult,
  CaptureResult,
  defaultShootFlags,
  FlowResult,
  type Mode,
  overlays,
  LogInService,
  outlineText,
  PublishEvidenceService,
  RecordFlowService,
  ReviewFeedback,
  ReviewService,
  ShootTargetService,
  type ShootFlags,
  type Size,
  defaultSize,
  sizeAliases,
  sizeFromText,
  playwrightDevices,
} from '../index.ts'
import { Effect, Option, Predicate, Schema } from 'effect'
import { Argument, CliError, Command, Flag } from 'effect/cli'
import { readFileSync } from 'node:fs'

import { FillValue, LabelValue, stepsFromArgv } from './flags.ts'
import { anyErrorFinding, displayPath, printCaptureResults, printLine } from './output.ts'

const asFlag = Flag.String('as').pipe(
  Flag.withDescription('the user: an alias from the config, or an email'),
  Flag.optional,
)

const paramFlag = Flag.KeyValuePair('param').pipe(
  Flag.withDescription('a login param for the logIn hook, name=value (e.g. org=acme); repeatable'),
  Flag.withDefault({}),
)

const labelFlag = Flag.String('label').pipe(
  Flag.withSchema(LabelValue),
  Flag.withDescription('write into .shots/<session>/<label>/ (before, after); same keys across labels'),
  Flag.withDefault(''),
)

const jsonFlag = Flag.Boolean('json').pipe(Flag.withDescription('print results as JSON'), Flag.withDefault(false))

const steps = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.atLeast(0))

const optionalNumber = (name: string, description: string) =>
  Flag.Finite(name).pipe(Flag.withDescription(description), Flag.optional)

const optionalCount = (name: string, description: string) =>
  Flag.Int(name).pipe(
    Flag.withSchema(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
    Flag.withDescription(description),
    Flag.optional,
  )

const sizeText = (description: string) =>
  Flag.String('size').pipe(
    Flag.mapEffect((text) =>
      Effect.fromResult(sizeFromText({ text, devices: playwrightDevices })).pipe(
        Effect.mapError(
          ({ closest }) =>
            new CliError.InvalidValue({
              option: 'size',
              value: text,
              expected: `phone, tablet, laptop, desktop, WxH or a Playwright device; closest: ${closest.join(', ')}`,
              kind: 'flag',
            }),
        ),
      ),
    ),
    Flag.withDescription(description),
  )

const sizeFlags = sizeText(
  'phone, tablet, laptop (default), desktop, WxH (390x844) or a Playwright device ("Pixel 8"); repeatable',
).pipe(Flag.atLeast(0))

const modesFromFlag: Record<'light' | 'dark' | 'both', ReadonlyArray<Mode>> = {
  light: ['light'],
  dark: ['dark'],
  both: ['light', 'dark'],
}

const shootFlags = {
  target: Argument.String('target').pipe(
    Argument.withDescription('an app path (/settings, /app/persons/abc) or a URL'),
  ),
  as: asFlag,
  param: paramFlag,
  label: labelFlag,
  json: jsonFlag,
  mode: Flag.Literals('mode', ['light', 'dark', 'both']).pipe(
    Flag.withDescription('color scheme'),
    Flag.withDefault('light'),
  ),
  size: sizeFlags,
  mobile: Flag.Boolean('mobile').pipe(Flag.withDescription('same as --size phone'), Flag.withDefault(false)),
  scale: optionalNumber('scale', 'device scale factor for every size (default 2 on devices, 1 on WxH)'),
  reducedMotion: Flag.Boolean('reduced-motion').pipe(
    Flag.withDescription('prefers-reduced-motion: reduce'),
    Flag.withDefault(false),
  ),
  click: steps('click', 'scene step, in command-line order'),
  fill: Flag.String('fill').pipe(
    Flag.withSchema(FillValue),
    Flag.withDescription('scene step: <css>=<text>'),
    Flag.atLeast(0),
  ),
  key: steps('key', 'scene step: a key (Enter, Escape)'),
  hover: steps('hover', 'scene step, runs last and holds'),
  focus: steps('focus', 'scene step, runs last and holds; checks the focus ring with --check'),
  press: steps('press', 'scene step: mouse down, runs last and holds'),
  wait: Flag.Finite('wait').pipe(Flag.withDescription('scene step: wait <ms>'), Flag.atLeast(0)),
  section: Flag.String('section').pipe(
    Flag.withDescription('a section by title (exact, else unique substring; "Title >> nth=1"); repeatable'),
    Flag.atLeast(0),
  ),
  select: Flag.String('select').pipe(
    Flag.withDescription('the first visible match, 16px around it; repeatable'),
    Flag.atLeast(0),
  ),
  viewport: Flag.Boolean('viewport').pipe(Flag.withDescription('only the viewport'), Flag.withDefault(false)),
  overlay: Flag.Literals('overlay', overlays).pipe(
    Flag.withDescription('draw measurements on the still; repeatable'),
    Flag.atLeast(0),
  ),
  loupe: optionalCount('loupe', 'the part at n×, nearest-neighbour'),
  frames: optionalCount('frames', "n frames from the scene's last step, on one sheet"),
  every: optionalNumber('every', 'ms of animation time between frames (default 50)'),
  slow: optionalNumber('slow', 'animation speed for frames (0.1 = 10× slower)'),
  measure: Flag.Boolean('measure').pipe(
    Flag.withDescription('JSON per match: box, spacing, radius, font'),
    Flag.withDefault(false),
  ),
  style: Flag.String('style').pipe(Flag.withDescription('a computed style for --measure; repeatable'), Flag.atLeast(0)),
  all: Flag.Boolean('all').pipe(Flag.withDescription('--measure every match, not the first'), Flag.withDefault(false)),
  aria: Flag.Boolean('aria').pipe(
    Flag.withDescription("the part's accessibility tree as text"),
    Flag.withDefault(false),
  ),
  check: Flag.Boolean('check').pipe(
    Flag.withDescription("run the checks (overflow, target, focus, align, plugins')"),
    Flag.withDefault(false),
  ),
  name: Flag.String('name').pipe(Flag.withDescription('name the files instead of the generated slug'), Flag.optional),
}

type ShootInput = Command.Command.Config.Infer<typeof shootFlags>

/** `--mobile` adds a phone; without any size, the default (E16). */
const sizesFromInput = (input: ShootInput): ReadonlyArray<Size> => {
  const sizes = [...input.size, ...(input.mobile ? [sizeAliases.phone] : [])]

  return sizes.length === 0 ? defaultShootFlags.sizes : sizes
}

const shootFlagsFromInput = (input: ShootInput): ShootFlags => ({
  ...defaultShootFlags,
  modes: modesFromFlag[input.mode],
  sizes: sizesFromInput(input),
  scale: input.scale,
  reducedMotion: input.reducedMotion,
  steps: stepsFromArgv(process.argv.slice(2)),
  sections: input.section,
  selects: input.select,
  viewport: input.viewport,
  overlays: input.overlay,
  loupe: input.loupe,
  frames: Option.map(input.frames, (count) => ({
    count,
    everyMs: Option.getOrElse(input.every, () => 50),
    slow: Option.getOrElse(input.slow, () => 1),
  })),
  measure: input.measure ? Option.some({ styles: input.style, all: input.all }) : Option.none(),
  aria: input.aria,
  name: input.name,
})

const encodeResultsJson = Schema.encodeSync(Schema.toCodecJson(Schema.Array(CaptureResult)))

/** The element map is for `shot review`, in the manifest: printing it would bury the results an agent reads. */
const withoutElementMap = (result: CaptureResult): CaptureResult =>
  Predicate.isTagged(result, 'CapturedResult')
    ? CapturedResult.make({
        capture: result.capture,
        key: result.key,
        file: result.file,
        measurements: result.measurements,
        findings: result.findings,
      })
    : result

const encodeFlowJson = Schema.encodeSync(Schema.toCodecJson(FlowResult))

export const shot = Command.make('shot', shootFlags, (input) =>
  Effect.gen(function* () {
    const service = yield* ShootTargetService

    const results = yield* service.shootTarget({
      raw: input.target,
      as: input.as,
      params: input.param,
      label: input.label,
      flags: shootFlagsFromInput(input),
      runChecks: input.check,
    })

    if (input.json) yield* printLine(JSON.stringify(encodeResultsJson(results.map(withoutElementMap)), null, 2))
    else yield* printCaptureResults(results)

    if (anyErrorFinding(results)) process.exitCode = 1
  }),
).pipe(
  Command.withDescription('Shoot an app path or a URL: stills, overlays, measurements, checks.'),
  Command.withExamples([
    { command: 'shot /app/persons --as admin --mode dark', description: 'one still per section, dark' },
    {
      command: 'shot /app/persons --as admin --size phone --size desktop',
      description: 'each section on a phone and a desktop',
    },
    {
      command: "shot /settings --as admin --fill '#name=Test' --key Enter --section Profile",
      description: 'a scene, then one section',
    },
    {
      command: 'git stash -u && shot /app/persons --as admin --label before',
      description: 'the state before your change',
    },
    {
      command: 'shot /settings --as admin --select "#save" --overlay boxes --overlay gaps --check',
      description: 'measure and check one control',
    },
  ]),
)

const outline = Command.make(
  'outline',
  {
    target: Argument.String('target'),
    as: asFlag,
    param: paramFlag,
    size: sizeText('the size to read the sections at (default laptop)').pipe(Flag.optional),
  },
  ({ target, as, param, size }) =>
    Effect.gen(function* () {
      const service = yield* ShootTargetService

      const { outline } = yield* service.readTargetOutline({
        raw: target,
        as,
        params: param,
        size: Option.getOrElse(size, () => defaultSize),
      })

      yield* printLine(outline.length === 0 ? '(no titled sections: shoot the page or --select)' : outlineText(outline))
    }),
).pipe(Command.withDescription('Section titles of a target, for --section.'))

const flow = Command.make(
  'flow',
  {
    flow: Argument.String('flow').pipe(Argument.withDescription('a name (shots/<name>.flow.ts) or a file')),
    label: labelFlag,
    json: jsonFlag,
    size: sizeText("the size to run at, instead of the flow header's (default laptop)").pipe(Flag.optional),
  },
  ({ flow: raw, label, json, size }) =>
    Effect.gen(function* () {
      const service = yield* RecordFlowService
      const result = yield* service.recordFlow({ flow: raw, label, size })

      if (json) yield* printLine(JSON.stringify(encodeFlowJson(result), null, 2))
      else {
        for (const still of result.stills) yield* printLine(yield* displayPath(still.file))
        yield* printLine(yield* displayPath(result.video))
        yield* printLine(yield* displayPath(result.trace))
      }

      if (Predicate.isTagged(result, 'StoppedFlow')) {
        yield* printLine(`error flow     ${result.flow.name}: step ${result.failedStep}: ${result.reason}`)
        process.exitCode = 1
      }
    }),
).pipe(
  Command.withDescription('Record a flow: a still per step, a video and a trace.'),
  Command.withExamples([
    { command: 'shot flow invite-parent --label after', description: 'runs shots/invite-parent.flow.ts' },
    { command: 'shot flow invite-parent --size phone', description: "on a phone, instead of the header's size" },
  ]),
)

const publish = Command.make(
  'publish',
  {
    pr: Flag.Int('pr').pipe(Flag.withDescription("the PR number (default: the current branch's)"), Flag.optional),
    publisher: Flag.String('publisher').pipe(
      Flag.withDescription('a configured publisher (default: the first)'),
      Flag.optional,
    ),
  },
  ({ pr, publisher }) =>
    Effect.gen(function* () {
      const service = yield* PublishEvidenceService
      const { reportFile, published } = yield* service.publishEvidence({ pr, publisher })
      yield* printLine(yield* displayPath(reportFile))
      yield* printLine(`published ${published.attachments} files to ${published.url}`)
    }),
).pipe(Command.withDescription("Publish the session's evidence to the PR body, replacing the last publish."))

const encodeFeedbackJson = Schema.encodeSync(Schema.toCodecJson(ReviewFeedback))

const review = Command.make(
  'review',
  {
    labels: Argument.String('label').pipe(
      Argument.withDescription('a label to put up for review, in the order shown; at least one'),
      Argument.atLeast(1),
    ),
    base: Flag.String('base').pipe(
      Flag.withDescription('a label to compare against: shown first, takes no vote'),
      Flag.optional,
    ),
    sheet: Flag.String('sheet').pipe(
      Flag.withDescription('only sheets whose title contains this (case-insensitive); repeatable'),
      Flag.atLeast(0),
    ),
    size: sizeText('only this size; repeatable').pipe(Flag.atLeast(0)),
    ask: Flag.String('ask').pipe(Flag.withDescription('the question shown at the top'), Flag.optional),
    describe: Flag.KeyValuePair('describe').pipe(
      Flag.withDescription('a line under a label, label=text (its direction and cost); repeatable'),
      Flag.withDefault({}),
    ),
    noOpen: Flag.Boolean('no-open').pipe(
      Flag.withDescription('print the URL instead of opening the browser'),
      Flag.withDefault(false),
    ),
    json: jsonFlag,
  },
  ({ labels, base, sheet, size, ask, describe, noOpen, json }) =>
    Effect.gen(function* () {
      const service = yield* ReviewService

      const outcome = yield* service.reviewLabels({
        request: { labels, base, sheets: sheet, sizes: size, ask, describe },
        open: !noOpen,
        onListening: (url) =>
          Effect.sync(() => process.stderr.write(`review at ${url}\nwaiting for the user to send or close it…\n`)),
      })

      if (Option.isNone(outcome.round)) {
        if (json) yield* printLine(JSON.stringify({ decision: outcome.decision }))
        process.stderr.write('closed without feedback\n')
        process.exitCode = 1

        return
      }

      const round = outcome.round.value

      if (json) {
        yield* printLine(JSON.stringify(encodeFeedbackJson(round.feedback), null, 2))

        return
      }

      yield* printLine(`# ${yield* displayPath(round.markdownFile)}`)
      yield* printLine(round.markdown.trimEnd())
    }),
).pipe(
  Command.withDescription(
    'Put labels up for the user: side by side, votes, drawings; blocks until they send it, prints their feedback.',
  ),
  Command.withExamples([
    {
      command: 'shot review quiet editorial dense --base before --ask "Pick a density for People"',
      description: 'three labels against before',
    },
    {
      command: 'shot review quiet dense --sheet People --size phone --describe quiet="Lowest weight; least memorable"',
      description: 'one sheet at one size, with a line under quiet',
    },
  ]),
)

const login = Command.make(
  'login',
  { as: Flag.String('as').pipe(Flag.withDescription('an alias from the config, or an email')), param: paramFlag },
  ({ as, param }) =>
    Effect.gen(function* () {
      const service = yield* LogInService
      const { url, host, user } = yield* service.logIn({ as, params: param })
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
).pipe(Command.withDescription("Delete this session's files (--all: every session; login defaults stay)."))

// `src/cli/` and `dist/cli/` both sit two levels below the package root.
const skillFile = new URL('../../skill/SKILL.md', import.meta.url)

const skill = Command.make('skill', {}, () => printLine(readFileSync(skillFile, 'utf8').trimEnd())).pipe(
  Command.withDescription('Print the agent instructions.'),
)

const packageJson: { version: string } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
)

export const cliVersion = packageJson.version

export const shotCommand = shot.pipe(
  Command.withSubcommands([outline, flow, publish, review, login, logout, clean, skill]),
)
