import { NodeRuntime } from '@effect/platform-node'
import { shotLayer } from '@shot/core'
import { Cause, Effect } from 'effect'
import { CliError, Command } from 'effect/cli'

import { cliMessageFromShotError, type ShotError } from './cli-message.ts'
import { shotCommand } from './commands.ts'
import { UsageError } from './flags.ts'

const version = '0.1.0'

const writeError = (line: string) => Effect.sync(() => process.stderr.write(`${line}\n`))

/** Domain errors are tagged; defects are not. */
const isShotError = (error: unknown): error is ShotError =>
  typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string'

/**
 * Exit 0 ok; 1 a domain error, a render finding or a stopped flow; 2 usage. A domain error is one line; a defect is
 * one line too, with the stack only under SHOT_DEBUG=1.
 */
export const main = () =>
  Command.runWith(shotCommand, { version })(process.argv.slice(2)).pipe(
    Effect.provide(shotLayer(process.cwd())),
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (Cause.hasInterruptsOnly(cause)) {
          process.exitCode = 130
          return
        }
        const error = Cause.squash(cause)
        if (error instanceof UsageError) {
          process.exitCode = 2
          return yield* writeError(error.message)
        }
        if (CliError.isCliError(error)) {
          // effect/cli already printed the usage error and the help.
          process.exitCode = 2
          return
        }
        process.exitCode = 1
        if (Cause.hasFails(cause) && isShotError(error)) return yield* writeError(cliMessageFromShotError(error))
        if (process.env['SHOT_DEBUG'] === '1') return yield* writeError(Cause.pretty(cause))
        const message = error instanceof Error ? error.message : String(error)
        return yield* writeError(`shot crashed: ${message.split('\n')[0]} (SHOT_DEBUG=1 shows the stack)`)
      }),
    ),
    NodeRuntime.runMain({ disableErrorReporting: true }),
  )
