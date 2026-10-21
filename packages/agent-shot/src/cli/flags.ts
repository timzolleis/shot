import { Click, Fill, Focus, Hover, Key, Press, type Step, Wait } from '../index.ts'
import { Schema } from 'effect'

/** `<css>=<text>`, split at the last "=": the selector may hold one (`[name=email]=a@b.c`), the text may not. */
export const FillValue = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^=].*=/s, { message: 'expected <css>=<text>, e.g. #name=Ada' })),
)

/** Label names become directories next to `manifest/`, `flows/` and `report/`. */
export const LabelValue = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^(?!(manifest|flows|report)$)[a-z0-9][a-z0-9._-]*$/i, {
      message: 'letters, digits, ".", "_" and "-", not manifest, flows or report',
    }),
  ),
)

const stepFlags = new Set(['click', 'fill', 'key', 'hover', 'focus', 'press', 'wait'])

/**
 * Scene steps in command-line order. effect/cli parses and validates each step flag, but per flag: the order across
 * `--click` and `--fill` is lost, and the scene needs it.
 */
export const stepsFromArgv = (argv: ReadonlyArray<string>): ReadonlyArray<Step> =>
  argv.flatMap((token, index): ReadonlyArray<Step> => {
    const match = /^--([a-z]+)(?:=(.*))?$/s.exec(token)

    if (match === null || !stepFlags.has(match[1]!)) return []
    const value = match[2] ?? argv[index + 1] ?? ''

    switch (match[1]) {
      case 'click':
        return [Click.make({ selector: value })]
      case 'hover':
        return [Hover.make({ selector: value })]
      case 'focus':
        return [Focus.make({ selector: value })]
      case 'press':
        return [Press.make({ selector: value })]
      case 'key':
        return [Key.make({ key: value })]
      case 'wait':
        return [Wait.make({ ms: Number(value) })]
      default: {
        const separator = value.lastIndexOf('=')

        return [Fill.make({ selector: value.slice(0, separator), text: value.slice(separator + 1) })]
      }
    }
  })
