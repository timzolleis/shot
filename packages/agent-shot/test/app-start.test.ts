import { startFixtureApp } from '@agent-shot/fixture-app'
import { afterEach, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import type { Server } from 'node:http'

import { AppStartTimedOutError } from '../src/app/app-error.ts'
import { AppHooks, AppHooksLayer } from '../src/app/app-hooks.ts'
import type { AppConfig } from '../src/plugin/shot-config.ts'
import { ShotConfig } from '../src/plugin/shot-config.ts'

const servers: Array<Server> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

const unusedPort = async () => {
  const probe = await startFixtureApp()

  await new Promise((resolve) => probe.server.close(resolve))

  return Number(new URL(probe.url).port)
}

const appUrlWith = (app: Partial<AppConfig> & Pick<AppConfig, 'url'>) =>
  Effect.gen(function* () {
    const hooks = yield* AppHooks

    return yield* hooks.appUrl()
  }).pipe(
    Effect.provide(
      AppHooksLayer.pipe(
        Layer.provide(
          Layer.succeed(
            ShotConfig,
            ShotConfig.of({
              projectRoot: process.cwd(),
              configFile: Option.none(),
              app: Option.some({ health: '/health', logIn: () => undefined, ...app }),
              plugins: [],
              checks: 'off',
              determinism: {},
              videoLimitBytes: 0,
            }),
          ),
        ),
      ),
    ),
  )

describe('app.start', () => {
  it('leaves a running app alone', async () => {
    const started = await startFixtureApp()
    servers.push(started.server)
    let starts = 0

    const url = await Effect.runPromise(appUrlWith({ url: () => started.url, start: () => void starts++ }))

    expect(url).toBe(started.url)
    expect(starts).toBe(0)
  })

  it('refuses an app that is down when there is no start hook', async () => {
    const url = `http://127.0.0.1:${await unusedPort()}`

    const error = await Effect.runPromise(Effect.flip(appUrlWith({ url: () => url })))

    expect(error._tag).toBe('AppNotRunningError')
  })

  it('starts an app that is down and waits until it answers', async () => {
    const port = await unusedPort()
    let starts = 0

    const url = await Effect.runPromise(
      appUrlWith({
        url: () => `http://127.0.0.1:${port}`,
        start: () => {
          starts++
          setTimeout(() => void startFixtureApp(port).then(({ server }) => servers.push(server)), 1500)
        },
      }),
    )

    expect(url).toBe(`http://127.0.0.1:${port}`)
    expect(starts).toBe(1)
  })

  it('gives up when the started app never answers', async () => {
    const url = `http://127.0.0.1:${await unusedPort()}`

    const error = await Effect.runPromise(
      Effect.flip(appUrlWith({ url: () => url, start: () => undefined, startTimeoutMs: 1500 })),
    )

    expect(error).toEqual(new AppStartTimedOutError({ url, timeoutMs: 1500 }))
  })

  it('starts the app once when two runs find it down at the same time', async () => {
    const port = await unusedPort()
    let starts = 0

    const app = {
      url: () => `http://127.0.0.1:${port}`,
      start: () => {
        starts++
        setTimeout(() => void startFixtureApp(port).then(({ server }) => servers.push(server)), 1000)
      },
    }

    await Effect.runPromise(Effect.all([appUrlWith(app), appUrlWith(app)], { concurrency: 'unbounded' }))

    expect(starts).toBe(1)
  })
})
