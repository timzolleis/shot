import { describe, expect, it } from '@effect/vitest'
import {
  ArtifactStore,
  defaultSize,
  evidenceStartMarker,
  type EvidenceReport,
  type ProcessOutput,
  ShotCell,
} from '../src/index.ts'
import { Effect, Layer } from 'effect'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { GhCli, publishEvidenceToPr } from '../src/github/github-publisher.ts'

const report: EvidenceReport = {
  session: 's',
  sheets: [
    {
      key: 'route-app-persons--admin-9c41d0',
      title: '/app/persons as admin@example.org › page',
      file: '.shots/s/report/route-app-persons--admin-9c41d0.png',
      variants: [{ size: defaultSize, mode: 'light' }],
      rows: [
        {
          label: 'before',
          cells: [ShotCell.make({ file: '.shots/s/before/route-app-persons--admin-light-9c41d0.png', scale: 1 })],
        },
        {
          label: 'after',
          cells: [ShotCell.make({ file: '.shots/s/after/route-app-persons--admin-light-9c41d0.png', scale: 1 })],
        },
      ],
    },
  ],
  flows: [],
  findings: [],
  summary: { captures: 2, flows: 0, errors: 0, warnings: 0 },
}

const ok = (stdout: string): ProcessOutput => ({ exitCode: 0, stdout, stderr: '' })

/** gh answers from a table; every call is recorded. */
const fakeGh = (answers: Record<string, ProcessOutput>) => {
  const calls: Array<ReadonlyArray<string>> = []

  const layer = Layer.succeed(GhCli, {
    runGh: (args) =>
      Effect.sync(() => {
        calls.push(args)
        const answer = Object.entries(answers).find(([prefix]) => args.join(' ').startsWith(prefix))

        return answer?.[1] ?? { exitCode: 1, stdout: '', stderr: `unexpected: gh ${args.join(' ')}` }
      }),
  })

  return { calls, layer }
}

const projectRoot = mkdtempSync(path.join(tmpdir(), 'shot-github-'))

/** Only the paths are used; every write or read dies if the publisher reaches for it. */
const unused = () => Effect.die('ArtifactStore: not used by the publisher')

const store = Layer.succeed(
  ArtifactStore,
  ArtifactStore.of({
    projectRoot,
    sessionName: 's',
    sessionDir: '.shots/s',
    absolutePath: (file) => path.resolve(projectRoot, file),
    writeCaptureFile: unused,
    writeManifest: unused,
    makeFlowDir: unused,
    writeFlowResult: unused,
    readSession: unused,
    writeReport: unused,
    readHostDefaults: unused,
    writeHostDefaults: unused,
    authFile: (sessionKey) => path.resolve(projectRoot, '.shots/auth', sessionKey),
    removeAuthFiles: unused,
    clean: unused,
  }),
)

const publish = (gh: ReturnType<typeof fakeGh>) =>
  publishEvidenceToPr({ report, pr: undefined }).pipe(
    Effect.provide(Layer.merge(gh.layer, store)),
    Effect.match({ onFailure: (error) => error._tag, onSuccess: () => 'ok' }),
  )

const repo = ok(JSON.stringify({ nameWithOwner: 'acme/shot', viewerPermission: 'WRITE' }))

describe('publishEvidenceToPr', () => {
  it.effect('gh 2.96 → GhTooOldError (10)', () =>
    Effect.gen(function* () {
      expect(yield* publish(fakeGh({ '--version': ok('gh version 2.96.0 (2026-07-02)\n') }))).toBe('GhTooOldError')
    }),
  )

  it.effect('read-only collaborator → NoPushAccessError (10)', () =>
    Effect.gen(function* () {
      const gh = fakeGh({
        '--version': ok('gh version 2.99.0 (2026-09-01)\n'),
        'repo view': ok(JSON.stringify({ nameWithOwner: 'acme/shot', viewerPermission: 'READ' })),
      })

      expect(yield* publish(gh)).toBe('NoPushAccessError')
    }),
  )

  it.effect('branch without a PR → NoPullRequestError', () =>
    Effect.gen(function* () {
      const gh = fakeGh({
        '--version': ok('gh version 2.102.1 (2026-10-20)\n'),
        'repo view': repo,
        'pr view': { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "feat/x"\n' },
      })

      expect(yield* publish(gh)).toBe('NoPullRequestError')
    }),
  )

  it.effect('publish → body with the evidence block, every referenced file attached (12)', () =>
    Effect.gen(function* () {
      const gh = fakeGh({
        '--version': ok('gh version 2.99.0 (2026-09-01)\n'),
        'repo view': repo,
        'pr view': ok(
          JSON.stringify({ number: 812, body: 'Fixes the list.', url: 'https://github.com/acme/shot/pull/812' }),
        ),
        'pr edit': ok(''),
      })

      expect(yield* publish(gh)).toBe('ok')
      const edit = gh.calls.find((args) => args[0] === 'pr' && args[1] === 'edit')!
      expect(edit).toEqual([
        'pr',
        'edit',
        '812',
        '--body-file',
        '.shots/s/report/pr-body.md',
        '--attach',
        '.shots/s/report/route-app-persons--admin-9c41d0.png',
      ])
      const body = readFileSync(path.join(projectRoot, '.shots/s/report/pr-body.md'), 'utf8')
      expect(body.startsWith(`Fixes the list.\n\n${evidenceStartMarker}`)).toBe(true)
      expect(body).toContain('](.shots/s/report/route-app-persons--admin-9c41d0.png)')
    }),
  )
})
