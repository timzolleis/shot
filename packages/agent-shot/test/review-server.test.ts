import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, ManagedRuntime, Option } from 'effect'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

import { defaultShootFlags, ReviewService, ShootTargetService, shotLayer, sizeAliases } from '../src/index.ts'
import type { ReviewRequest } from '../src/review/domain/review-sheets.ts'

/**
 * Adapter cases: variants of the fixture's local compare.html (`?variant=<label>`) shot as labels, the review page driven
 * in a real browser, rounds on disk. No app login: the login lock is shared with the other adapter tests.
 */

const fixtureDir = path.resolve(import.meta.dirname, '../../../test/fixture-app')
const sessionDir = path.join(fixtureDir, '.shots', 'review-test')
let browser: Browser
const makeRuntime = () => ManagedRuntime.make(shotLayer(fixtureDir))
let runtime: ReturnType<typeof makeRuntime>

beforeAll(async () => {
  process.env['SHOT_SESSION'] = 'review-test'
  rmSync(sessionDir, { recursive: true, force: true })
  runtime = makeRuntime()
  browser = await chromium.launch()

  for (const label of ['before', 'quiet', 'dense']) {
    await runtime.runPromise(
      Effect.flatMap(ShootTargetService, (service) =>
        service.shootTarget({
          raw: `file://${fixtureDir}/pages/compare.html?variant=${label}`,
          as: Option.none(),
          params: {},
          label,
          flags: { ...defaultShootFlags, sections: ['Variant'], sizes: [sizeAliases.phone] },
          runChecks: false,
        }),
      ),
    )
  }
})

afterAll(async () => {
  await browser.close()
  await runtime.dispose()
})

const request: ReviewRequest = {
  labels: ['quiet', 'dense'],
  base: Option.some('before'),
  sheets: [],
  sizes: [],
  ask: Option.some('Pick a density'),
  describe: { dense: 'Most rows per screen' },
}

/** Runs a review; `drive` gets the page once the review is listening. */
const review = (drive: (input: { readonly page: Page; readonly url: string }) => Promise<void>) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const listening = yield* Deferred.make<string>()
      const service = yield* ReviewService

      const reviewing = yield* service
        .reviewLabels({ request, open: false, onListening: (url) => Deferred.succeed(listening, url) })
        .pipe(Effect.forkChild)

      const url = yield* Deferred.await(listening)
      const page = yield* Effect.promise(() => browser.newPage({ viewport: { width: 1440, height: 900 } }))
      yield* Effect.promise(() => page.goto(url).then(() => page.waitForSelector('.frame img')))
      yield* Effect.promise(() => drive({ page, url }))
      const outcome = yield* Fiber.join(reviewing)
      yield* Effect.promise(() => page.close())

      return outcome
    }),
  )

/** Where the dense still's element map puts the pick button. */
const pickRect = (): { x: number; y: number; width: number; height: number } => {
  const manifest = path.join(sessionDir, 'dense', 'manifest')
  const file = readdirSync(manifest).find((name) => name.endsWith('.json'))!

  const elements: ReadonlyArray<{ selector: string; rect: { x: number; y: number; width: number; height: number } }> =
    JSON.parse(readFileSync(path.join(manifest, file), 'utf8')).elements

  return elements.find((element) => element.selector === '#pick')!.rect
}

describe('shot review against the fixture app', () => {
  it("stills record their element map, in the still's pixels (F34)", () => {
    const pick = pickRect()
    expect(pick.x).toBeGreaterThan(0)
    expect(pick.x).toBeLessThan(100)
  })

  it('the page needs the token: no token → 403 (F22)', async () => {
    await review(async ({ page, url }) => {
      const origin = new URL(url).origin
      const status = await page.evaluate(async (at) => (await fetch(`${at}/api/review`)).status, origin)
      expect(status).toBe(403)
      await page.click('[data-action="close"]')
    })
  })

  it('the variants line up; pick dense, pin its button, send → picked; round-1 with feedback.md and the burned still (F28–F34)', async () => {
    const outcome = await review(async ({ page }) => {
      await page.click('[data-pick="dense"]')
      await page.keyboard.press('c')
      const frame = (await page.locator('.frame[data-label="dense"] svg').boundingBox())!

      const still = await page.evaluate(() => {
        const svg = document.querySelector<SVGSVGElement>('.frame[data-label="dense"] svg')!

        return { width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height }
      })

      const button = pickRect()
      await page.mouse.click(
        frame.x + ((button.x + button.width / 2) / still.width) * frame.width,
        frame.y + ((button.y + button.height / 2) / still.height) * frame.height,
      )
      await page.locator('[data-note-comment]').fill('Too tight against the list')
      await page.click('[data-action="submit"]')
      await page.waitForSelector('.done')
    })

    expect(outcome.decision).toBe('picked')
    const round = Option.getOrThrow(outcome.round)
    expect(round.markdownFile).toBe('.shots/review-test/review/round-1/feedback.md')
    expect(round.markdown).toContain('## compare.html › Variant')
    expect(round.markdown).toContain('Picked: dense (over quiet).')
    expect(round.markdown).toMatch(
      /1\. dense · iPhone 15, light · pin \(\d+, \d+\) · `#pick` button "Pick"\n {3}> Too tight against the list/,
    )

    const image = round.feedback.sheets[0]!.images[0]!
    expect(image).toMatch(/--dense--iphone-15-light\.png$/)
    expect(existsSync(path.join(fixtureDir, image))).toBe(true)
    expect(existsSync(path.join(sessionDir, 'review', 'draft.json'))).toBe(false)
  })

  it('close with nothing → dismissed, nothing written; the next round shows round 2 with the last notes faded (F33, F35)', async () => {
    const outcome = await review(async ({ page }) => {
      expect(await page.locator('.brand').innerText()).toContain('round 2')
      expect(await page.locator('g[opacity="0.45"]').count()).toBe(1)
      await page.click('[data-action="close"]')
      await page.waitForSelector('.done')
    })

    expect(outcome).toEqual({ decision: 'dismissed', round: Option.none() })
    expect(existsSync(path.join(sessionDir, 'review', 'round-2'))).toBe(false)
  })
})
