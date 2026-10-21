import {
  ArtifactStore,
  evidenceFilesFromReport,
  evidenceMarkdownFromReport,
  GhCommandFailedError,
  GhMissingError,
  GhTooOldError,
  NoPullRequestError,
  NoPushAccessError,
  type ProcessOutput,
  prBodyWithEvidence,
  runProcess,
  type ShotPlugin,
} from '@shot/core'
import { Context, Effect, Layer, Schema } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** `gh` in the project's directory. */
export class GhCli extends Context.Service<
  GhCli,
  { runGh(args: ReadonlyArray<string>): Effect.Effect<ProcessOutput> }
>()('shot/github/GhCli') {}

export const GhCliLayer = Layer.effect(
  GhCli,
  Effect.gen(function* () {
    const store = yield* ArtifactStore
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    return GhCli.of({
      runGh: (args) =>
        runProcess({ command: 'gh', args, cwd: store.projectRoot }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
    })
  }),
)

/** `gh … --json` output; anything else is a gh bug, so it dies. */
const decodeGhJson =
  <S extends Schema.Top>(schema: S) =>
  (stdout: string) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(stdout).pipe(Effect.orDie)

const decodeRepoView = decodeGhJson(
  Schema.Struct({ nameWithOwner: Schema.String, viewerPermission: Schema.NullOr(Schema.String) }),
)

const decodePrView = decodeGhJson(Schema.Struct({ number: Schema.Number, body: Schema.String, url: Schema.String }))

/** `gh --attach` exists from 2.99 (C10). */
export const minimumGhVersion = [2, 99, 0] as const

export const ghVersionFromOutput = (output: string): string | undefined =>
  /gh version (\d+\.\d+\.\d+)/.exec(output)?.[1]

export const isGhVersionSupported = (version: string): boolean => {
  const parts = version.split('.').map(Number)

  for (let index = 0; index < minimumGhVersion.length; index++) {
    const part = parts[index] ?? 0

    if (part !== minimumGhVersion[index]) return part > minimumGhVersion[index]!
  }

  return true
}

const pushPermissions = new Set(['ADMIN', 'MAINTAIN', 'WRITE'])
const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

/**
 * The report into the PR body between the evidence markers, replacing the last publish (C12); `--attach` uploads every
 * referenced file and swaps its local path for the URL.
 */
export const publishEvidenceToPr = Effect.fn('github.publishEvidence')(function* ({
  report,
  pr,
}: {
  readonly report: Parameters<typeof evidenceMarkdownFromReport>[0]
  readonly pr: number | undefined
}) {
  const gh = yield* GhCli
  const store = yield* ArtifactStore
  const versionOutput = yield* gh.runGh(['--version'])

  if (versionOutput.exitCode !== 0)
    return yield* new GhMissingError({ reason: firstLine(versionOutput.stderr) || 'gh is not installed' })
  const version = ghVersionFromOutput(versionOutput.stdout) ?? '0.0.0'

  if (!isGhVersionSupported(version)) return yield* new GhTooOldError({ version })

  const repo = yield* gh.runGh(['repo', 'view', '--json', 'nameWithOwner,viewerPermission'])

  if (repo.exitCode !== 0) return yield* new GhMissingError({ reason: firstLine(repo.stderr) })
  const { nameWithOwner, viewerPermission } = yield* decodeRepoView(repo.stdout)

  if (!pushPermissions.has(viewerPermission ?? '')) {
    return yield* new NoPushAccessError({ repository: nameWithOwner, permission: viewerPermission ?? '' })
  }

  const view = yield* gh.runGh(['pr', 'view', ...(pr === undefined ? [] : [String(pr)]), '--json', 'number,body,url'])

  if (view.exitCode !== 0) {
    const branch = /no pull requests? found for branch "([^"]+)"/.exec(view.stderr)?.[1]

    if (branch !== undefined) return yield* new NoPullRequestError({ branch })

    return yield* new GhCommandFailedError({ command: 'gh pr view', stderr: view.stderr })
  }

  const current = yield* decodePrView(view.stdout)
  const body = prBodyWithEvidence({ body: current.body, evidenceMarkdown: evidenceMarkdownFromReport(report) })
  const bodyFile = path.join(store.sessionDir, 'report', 'pr-body.md')
  yield* Effect.promise(async () => {
    await mkdir(path.dirname(store.absolutePath(bodyFile)), { recursive: true })
    await writeFile(store.absolutePath(bodyFile), body)
  })
  const files = [...new Set(evidenceFilesFromReport(report))]

  const edit = yield* gh.runGh([
    'pr',
    'edit',
    String(current.number),
    '--body-file',
    bodyFile,
    ...files.flatMap((file) => ['--attach', file]),
  ])

  if (edit.exitCode !== 0) return yield* new GhCommandFailedError({ command: 'gh pr edit', stderr: edit.stderr })

  return { url: current.url, attachments: files.length }
})

/** Publishes evidence into the current branch's PR body with `gh`. */
export const github = (): ShotPlugin<GhCli | ArtifactStore> => ({
  name: 'github',
  publishers: [{ publisher: 'github', publishEvidence: publishEvidenceToPr }],
  layer: GhCliLayer,
})
