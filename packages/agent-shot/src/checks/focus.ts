import { Effect } from 'effect'

import { Step } from '../capture/domain/capture.ts'
import { settlePage } from '../infrastructure/page-lifecycle.ts'
import type { CaptureCheck } from '../plugin/capture-check.ts'
import { isStill } from './runtime-check.ts'

const isFocusStep = Step.isAnyOf(['Focus'])

/** The focused element's surroundings, focused and blurred: identical pixels mean no visible focus indicator. */
export const focusCheck: CaptureCheck = {
  check: 'focus',
  appliesTo: (capture) => isStill(capture) && capture.scene.some(isFocusStep),
  runCheck: ({ page: { page }, capture }) =>
    Effect.gen(function* () {
      const step = capture.scene.findLast(isFocusStep)

      if (step === undefined) return []

      const area = yield* Effect.promise(() =>
        page.evaluate(() => {
          const element = document.activeElement

          if (element === null || element === document.body) return undefined
          const rect = element.getBoundingClientRect()

          return {
            x: rect.left + scrollX - 8,
            y: rect.top + scrollY - 8,
            width: rect.width + 16,
            height: rect.height + 16,
          }
        }),
      )

      if (area === undefined) {
        return [
          {
            check: 'focus',
            severity: 'error',
            message: 'nothing is focused after the focus step',
            selector: step.selector,
          },
        ]
      }

      const clip = { ...area, x: Math.max(0, area.x), y: Math.max(0, area.y) }
      const focused = yield* Effect.promise(() => page.screenshot({ fullPage: true, clip }))
      yield* Effect.promise(() =>
        page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        }),
      )
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
              severity: 'error',
              message: 'focus shows no visible outline or ring',
              selector: step.selector,
              rect: area,
            },
          ]
        : []
    }),
}
