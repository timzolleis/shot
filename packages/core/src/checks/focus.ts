import { Effect, Option } from 'effect'

import type { Focus } from '../capture/domain/capture.ts'
import { settlePage } from '../infrastructure/page-lifecycle.ts'
import type { CaptureCheck } from '../plugin/capture-check.ts'
import { isStill } from './runtime-check.ts'

type FocusStep = typeof Focus.Type

/** The focused element's surroundings, focused and blurred: identical pixels mean no visible focus indicator. */
export const focusCheck: CaptureCheck = {
  check: 'focus',
  appliesTo: (capture) => isStill(capture) && capture.scene.some((step) => step._tag === 'Focus'),
  runCheck: ({ page: { page }, capture }) =>
    Effect.gen(function* () {
      const step = capture.scene.findLast((candidate): candidate is FocusStep => candidate._tag === 'Focus')
      if (step === undefined) return []
      const area = yield* Effect.promise(() =>
        page.evaluate(() => {
          const element = document.activeElement
          if (element === null || element === document.body) return undefined
          const rect = element.getBoundingClientRect()
          return { x: rect.left + scrollX - 8, y: rect.top + scrollY - 8, width: rect.width + 16, height: rect.height + 16 }
        }),
      )
      if (area === undefined) {
        return [
          { check: 'focus', severity: 'error' as const, message: 'nothing is focused after the focus step', selector: step.selector, rect: Option.none() },
        ]
      }
      const clip = { ...area, x: Math.max(0, area.x), y: Math.max(0, area.y) }
      const focused = yield* Effect.promise(() => page.screenshot({ fullPage: true, clip }))
      yield* Effect.promise(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()))
      yield* settlePage(page)
      const blurred = yield* Effect.promise(() => page.screenshot({ fullPage: true, clip }))
      yield* Effect.promise(async () => {
        await page.keyboard.press('Shift')
        await page.locator(step.selector).first().focus()
      })
      yield* settlePage(page)
      return focused.equals(blurred)
        ? [
            {
              check: 'focus',
              severity: 'error' as const,
              message: 'focus shows no visible outline or ring',
              selector: step.selector,
              rect: Option.some(area),
            },
          ]
        : []
    }),
}
