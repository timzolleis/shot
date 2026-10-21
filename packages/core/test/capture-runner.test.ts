import { startFixtureApp } from '@shot/fixture-app'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, ManagedRuntime, Option } from 'effect'
import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import type { Server } from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'

import { defaultShootFlags, ShootTargetService, shotLayer } from '../src/index.ts'

/** Adapter cases against the fixture app: a real browser, real files under test/fixture-app/.shots/. */

const fixtureDir = path.resolve(import.meta.dirname, '../../../test/fixture-app')
const bin = path.resolve(import.meta.dirname, '../../cli/src/bin.ts')
let server: Server
let appUrl: string
let runtime: ManagedRuntime.ManagedRuntime<ShootTargetService, unknown>

const logins = async () => Number(await (await fetch(`${appUrl}/__logins`)).text())

beforeAll(async () => {
  const started = await startFixtureApp()
  server = started.server
  appUrl = started.url
  process.env['FIXTURE_URL'] = appUrl
  process.env['SHOT_SESSION'] = 'runner-test'
  rmSync(path.join(fixtureDir, '.shots'), { recursive: true, force: true })
  runtime = ManagedRuntime.make(shotLayer(fixtureDir) as Layer.Layer<ShootTargetService, unknown>)
})

afterAll(async () => {
  await runtime.dispose()
  server.close()
})

const shoot = (raw: string, flags = defaultShootFlags) =>
  runtime.runPromise(
    Effect.flatMap(ShootTargetService, (service) =>
      service.shootTarget({ raw, as: Option.some('admin'), params: {}, label: '', flags, runChecks: false }),
    ),
  )

describe('CaptureRunner against the fixture app', () => {
  it('page answers 500 → FailedCaptureResult, render finding; the other source still captured (3)', async () => {
    const [broken, persons] = await Promise.all([shoot('/broken'), shoot('/app/persons')])
    expect(broken.map((result) => result._tag)).toEqual(['FailedCaptureResult'])
    expect(broken[0]!.findings.map((finding) => `${finding.check}: ${finding.message}`)).toEqual([
      'render: the server answered 500',
    ])
    expect(persons.every((result) => result._tag === 'CapturedResult')).toBe(true)
  })

  it('submit sends PATCH → aborted, console finding "blocked PATCH /api/settings" (4)', async () => {
    const [result] = await shoot('/settings', {
      ...defaultShootFlags,
      steps: [
        { _tag: 'Fill', selector: '#name', text: 'Test' },
        { _tag: 'Key', key: 'Enter' },
      ],
    })
    expect(result!._tag).toBe('CapturedResult')
    expect(result!.findings.map((finding) => `${finding.check}: ${finding.message}`)).toContain(
      'console: blocked PATCH /api/settings',
    )
  })

  it('stored session expired → one logIn, then the capture (5)', async () => {
    await shoot('/app/persons')
    await fetch(`${appUrl}/__expire`)
    const before = await logins()
    const results = await shoot('/app/persons')
    expect(await logins()).toBe(before + 1)
    expect(results.every((result) => result._tag === 'CapturedResult')).toBe(true)
  })

  it('two processes, same user → logIn hook called once (14)', async () => {
    rmSync(path.join(fixtureDir, '.shots', 'auth'), { recursive: true, force: true })
    const before = await logins()
    const env = { ...process.env, FIXTURE_URL: appUrl, SHOT_SESSION: 'runner-test-parallel' }
    const run = () => promisify(execFile)(process.execPath, [bin, '/app/persons', '--as', 'admin', '--viewport'], { cwd: fixtureDir, env })
    const outputs = await Promise.all([run(), run()])
    expect(await logins()).toBe(before + 1)
    expect(outputs.map((output) => output.stdout.trim())).toEqual([
      expect.stringMatching(/route-app-persons--viewport-admin-light-[0-9a-f]{6}\.png$/),
      expect.stringMatching(/route-app-persons--viewport-admin-light-[0-9a-f]{6}\.png$/),
    ])
  })
})
