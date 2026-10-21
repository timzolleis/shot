import type { CaptureCheck, Finding, ShotPlugin } from '@shot/core'
import type AxeCore from 'axe-core'
import { Effect, Layer, Option, Predicate } from 'effect'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** axe-core on each still's part. A section or a selection is not a page: page-level rules are off. */
const pageRules = ['region', 'landmark-one-main', 'page-has-heading-one', 'bypass', 'landmark-unique', 'html-has-lang']

const axeSource = () => readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

declare global {
  interface Window {
    /** Set by the injected axe.min.js. */
    axe: typeof AxeCore
  }
}

export const a11yCheck: CaptureCheck = {
  check: 'a11y',
  appliesTo: (capture) => Predicate.isTagged(capture.output, 'Still'),
  runCheck: ({ page: { page }, roots }) =>
    Effect.promise(async () => {
      if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axeSource() })

      const violations = (
        await Promise.all(
          roots.map((root) =>
            root.evaluate(async (element, disabled) => {
              const result = await window.axe.run(element, {
                resultTypes: ['violations'],
                rules: Object.fromEntries(disabled.map((rule) => [rule, { enabled: false }])),
              })

              return result.violations.map((violation) => ({
                id: violation.id,
                impact: violation.impact ?? null,
                help: violation.help,
                nodes: violation.nodes.map((node) => {
                  const target = node.target.map(String)
                  const rect = document.querySelector(target.join(' '))?.getBoundingClientRect()

                  return {
                    target,
                    rect: rect === undefined ? undefined : { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height },
                  }
                }),
              }))
            }, pageRules),
          ),
        )
      ).flat()

      return violations.flatMap((violation) =>
        violation.nodes.map(
          (node): Finding => ({
            check: 'a11y',
            severity: violation.impact === 'serious' || violation.impact === 'critical' ? 'error' : 'warn',
            message: `${violation.help} (${violation.id})`,
            selector: node.target.join(' '),
            rect: Option.fromNullishOr(node.rect),
          }),
        ),
      )
    }),
}

/** The a11y check (axe-core), with `--check`. */
export const axe = (): ShotPlugin => ({ name: 'axe', checks: [a11yCheck], layer: Layer.empty })
