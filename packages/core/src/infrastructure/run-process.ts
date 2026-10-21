import { Effect, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export interface ProcessOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs a command to its end; a command that cannot start (not installed) exits 127 with the reason on stderr. */
export const runProcess = ({
  command,
  args,
  cwd,
}: {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
}): Effect.Effect<ProcessOutput, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, cwd === undefined ? {} : { cwd }))

    const [stdout, stderr] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
      { concurrency: 2 },
    )

    const exitCode = yield* handle.exitCode

    return { exitCode: Number(exitCode), stdout, stderr }
  }).pipe(
    Effect.scoped,
    Effect.catch((error) => Effect.succeed({ exitCode: 127, stdout: '', stderr: String(error.message ?? error) })),
  )
