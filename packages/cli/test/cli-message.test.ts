import { describe, expect, it } from '@effect/vitest'
import * as core from '@shot/core'
import { Option } from 'effect'

import { cliMessageFromShotError, type ShotError } from '../src/cli-message.ts'

const source = core.RouteSource.make({ path: '/app/persons', user: 'admin@example.org', params: {} })

/** One of each tag; the compiler keeps the mapper exhaustive, this keeps every line one line. */
const errors: ReadonlyArray<ShotError> = [
  new core.SourceNotFoundError({ raw: 'components-button--board', reason: 'pass a URL or an app path' }),
  new core.UserMissingError({ path: '/app/persons' }),
  new core.SourceRenderFailedError({ source, reason: 'the server answered 500' }),
  new core.SourceTimedOutError({ source, waitedMs: 20_000, consoleErrors: ['TypeError: x is undefined\n  at y'] }),
  new core.SourceRedirectedError({ source, landedOn: '/404' }),
  new core.SectionNotFoundError({ title: 'Sizes', outline: 'People\n  Filters' }),
  new core.AmbiguousSectionError({ title: 'Card', matches: ['Card A', 'Card B'] }),
  new core.SelectionNotFoundError({ selector: '#go', reason: 'no element matches (waited 2s)' }),
  new core.StepFailedError({ step: 'submit', reason: 'no element matches' }),
  new core.ConflictingOutputsError({ outputs: ['--frames', '--measure'] }),
  new core.UnknownDeviceError({ device: 'iPhone 99', closest: ['iPhone 15'] }),
  new core.LoupeTooLargeError({ factor: 8, width: 4000, height: 300 }),
  new core.AppHookMissingError({ hook: 'app.logIn' }),
  new core.AppNotRunningError({ url: 'https://feat-x.app.localhost' }),
  new core.AppHookFailedError({ hook: 'logIn', user: Option.some('admin@example.org'), message: 'no account' }),
  new core.SessionLockTimeoutError({ key: 'host/admin--default' }),
  new core.FlowNotFoundError({ flow: 'nope', looked: ['shots/nope.flow.ts'] }),
  new core.FlowInvalidError({ file: 'shots/x.flow.ts', reason: 'the default export is not defineFlow(...)' }),
  new core.VideoTooLargeError({ file: 'x.mp4', bytes: 31 * core.megabyte, limitBytes: 10 * core.megabyte }),
  new core.GhMissingError({ reason: 'gh is not installed' }),
  new core.GhTooOldError({ version: '2.96.0' }),
  new core.GhCommandFailedError({ command: 'gh pr edit', stderr: 'HTTP 502\nretry' }),
  new core.NoPushAccessError({ repository: 'acme/shot', permission: 'READ' }),
  new core.NoPullRequestError({ branch: 'feat/x' }),
  new core.NoEvidenceError({ session: 'local' }),
  new core.PublisherNotFoundError({ publisher: '', available: [] }),
  new core.ShotConfigInvalidError({ file: 'shot.config.ts', reason: 'Unexpected token' }),
]

describe('cliMessageFromShotError', () => {
  it.each(errors.map((error) => ({ tag: error._tag, error })))('$tag → one line, no stack', ({ error }) => {
    const line = cliMessageFromShotError(error)
    expect(line).not.toContain('\n')
    expect(line).not.toMatch(/at .+:\d+:\d+/)
    expect(line.length).toBeGreaterThan(10)
  })

  it.each([
    {
      error: new core.AppHookFailedError({
        hook: 'logIn',
        user: Option.some('admin@example.org'),
        message: 'no account',
      }),
      line: 'logIn hook failed for admin@example.org: no account',
    },
    {
      error: new core.GhTooOldError({ version: '2.96' }),
      line: 'gh 2.96 cannot attach files; update to 2.99 or later',
    },
    { error: new core.NoPullRequestError({ branch: 'feat/x' }), line: 'no pull request for feat/x; create it first' },
  ])('$line', ({ error, line }) => {
    expect(cliMessageFromShotError(error)).toBe(line)
  })
})
