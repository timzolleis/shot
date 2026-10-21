import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Option } from 'effect'

import { findingsFromCheck } from '../src/checks/capture-checks.ts'
import { GhMissingError, PublishFailedError } from '../src/evidence/domain/evidence-error.ts'
import type { CheckFinding } from '../src/plugin/capture-check.ts'
import { effectFromPluginHook, type Hook } from '../src/plugin/hook.ts'

/** Plugins written without Effect: plain values, Promises, throws. */

const publishFailed = (message: string) => new PublishFailedError({ publisher: 'slack', message })

describe('effectFromPluginHook', () => {
  it.effect('a value or a Promise → its value', () =>
    Effect.gen(function* () {
      expect(yield* effectFromPluginHook(() => 1, publishFailed)).toBe(1)
      expect(yield* effectFromPluginHook(() => Promise.resolve(2), publishFailed)).toBe(2)
    }),
  )

  it.effect('a throw or a rejection → onError with the message', () =>
    Effect.gen(function* () {
      const thrown = yield* Effect.exit(
        effectFromPluginHook(() => {
          throw new Error('channel not found')
        }, publishFailed),
      )

      const rejected = yield* Effect.exit(
        effectFromPluginHook(() => Promise.reject(new Error('rate limited')), publishFailed),
      )

      expect(thrown).toStrictEqual(Exit.fail(publishFailed('channel not found')))
      expect(rejected).toStrictEqual(Exit.fail(publishFailed('rate limited')))
    }),
  )

  it.effect("an Effect's typed error passes through", () =>
    Effect.gen(function* () {
      const missing = new GhMissingError({ reason: 'gh is not installed' })
      const exit = yield* Effect.exit(effectFromPluginHook(() => Effect.fail(missing), publishFailed))
      expect(exit).toStrictEqual(Exit.fail(missing))
    }),
  )
})

const check = (runCheck: () => Hook<ReadonlyArray<CheckFinding>, never>) => ({ check: 'todo', runCheck })

describe('findingsFromCheck', () => {
  it.effect('a plain finding → check, selector and rect default', () =>
    Effect.gen(function* () {
      const findings = yield* findingsFromCheck({
        check: check(async () => [{ severity: 'warn', message: 'TODO left in the page' }]),
        input: undefined,
      })

      expect(findings).toStrictEqual([
        { check: 'todo', severity: 'warn', message: 'TODO left in the page', selector: '', rect: Option.none() },
      ])
    }),
  )

  it.effect('a throwing check → one error finding, the run goes on', () =>
    Effect.gen(function* () {
      const findings = yield* findingsFromCheck({
        check: check(() => {
          throw new Error('axe is not loaded')
        }),
        input: undefined,
      })

      expect(findings).toStrictEqual([
        {
          check: 'todo',
          severity: 'error',
          message: 'check failed: axe is not loaded',
          selector: '',
          rect: Option.none(),
        },
      ])
    }),
  )
})
