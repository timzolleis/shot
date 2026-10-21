import { type Mode, type Overlay, overlays, type Step } from '@shot/core'

/** A usage mistake in a flag value: exit 2, like effect/cli's own. */
export class UsageError extends Error {}

export const usage = (message: string): never => {
  throw new UsageError(message)
}

const stepFlags = new Set(['click', 'fill', 'key', 'hover', 'focus', 'press', 'wait'])

/** Scene steps in command-line order: effect/cli parses each flag on its own and loses the order across flags. */
export const stepsFromArgv = (argv: ReadonlyArray<string>): ReadonlyArray<Step> => {
  const steps: Array<Step> = []
  for (let index = 0; index < argv.length; index++) {
    const match = /^--([a-z]+)(?:=(.*))?$/s.exec(argv[index]!)
    if (match === null || !stepFlags.has(match[1]!)) continue
    const name = match[1]!
    const value = match[2] ?? argv[++index]
    if (value === undefined) return usage(`--${name} needs a value`)
    switch (name) {
      case 'click':
        steps.push({ _tag: 'Click', selector: value })
        break
      case 'hover':
        steps.push({ _tag: 'Hover', selector: value })
        break
      case 'focus':
        steps.push({ _tag: 'Focus', selector: value })
        break
      case 'press':
        steps.push({ _tag: 'Press', selector: value })
        break
      case 'key':
        steps.push({ _tag: 'Key', key: value })
        break
      case 'wait': {
        const ms = Number(value)
        if (!Number.isFinite(ms) || ms < 0) return usage(`--wait takes milliseconds, got "${value}"`)
        steps.push({ _tag: 'Wait', ms })
        break
      }
      case 'fill': {
        const separator = value.lastIndexOf('=')
        if (separator < 1) return usage(`--fill expects <css>=<text>, got "${value}"`)
        steps.push({ _tag: 'Fill', selector: value.slice(0, separator), text: value.slice(separator + 1) })
        break
      }
    }
  }
  return steps
}

export const modesFromFlag = (value: string): ReadonlyArray<Mode> =>
  value.split(',').flatMap((part): ReadonlyArray<Mode> => {
    switch (part.trim()) {
      case 'light':
        return ['light']
      case 'dark':
        return ['dark']
      case 'both':
        return ['light', 'dark']
      default:
        return usage(`--mode takes light, dark or both, got "${part}"`)
    }
  })

export const listFromFlag = (value: string): ReadonlyArray<string> =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')

export const overlaysFromFlag = (value: string): ReadonlyArray<Overlay> =>
  listFromFlag(value).map((overlay) =>
    (overlays as ReadonlyArray<string>).includes(overlay)
      ? (overlay as Overlay)
      : usage(`--overlay takes ${overlays.join(', ')}; got "${overlay}"`),
  )

/** `--param org=acme`, repeatable. */
export const paramsFromFlags = (values: ReadonlyArray<string>): Readonly<Record<string, string>> =>
  Object.fromEntries(
    values.map((value) => {
      const separator = value.indexOf('=')
      if (separator < 1) return usage(`--param expects <name>=<value>, got "${value}"`)
      return [value.slice(0, separator), value.slice(separator + 1)]
    }),
  )

/** Label names become directories. */
export const labelFromFlag = (value: string): string =>
  /^[a-z0-9][a-z0-9._-]*$/i.test(value) && value !== 'manifest' && value !== 'flows' && value !== 'report'
    ? value
    : usage(`--label takes letters, digits, ".", "_" and "-" (not manifest, flows or report), got "${value}"`)
