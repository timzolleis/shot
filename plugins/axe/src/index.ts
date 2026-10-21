import type { CaptureCheck, Finding, ShotPlugin } from '@shot/core'
import { Effect, Layer, Option } from 'effect'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** axe-core on each still's part. A section or a selection is not a page: page-level rules are off. */
const pageRules = ['region', 'landmark-one-main', 'page-has-heading-one', 'bypass', 'landmark-unique', 'html-has-lang']

const axeSource = () => readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

interface AxeViolation {
  readonly id: string
  readonly impact: string | null
  readonly help: string
  readonly nodes: ReadonlyArray<{
    readonly target: ReadonlyArray<string>
    readonly rect: { x: number; y: number; width: number; height: number } | undefined
  }>
}

export const a11yCheck: CaptureCheck = {
  check: 'a11y',
  appliesTo: (capture) => capture.output._tag === 'Still',
  runCheck: ({ page: { page }, roots }) =>
    Effect.promise(async () => {
      if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axeSource() })

      const violations = (
        await Promise.all(
          roots.map((root) =>
            root.evaluate(async (element, disabled) => {
              const axe = (window as unknown as { axe: { run: (...args: ReadonlyArray<unknown>) => Promise<unknown> } }).axe

              const result = (await axe.run(element, {
                resultTypes: ['violations'],
                rules: Object.fromEntries(disabled.map((rule) => [rule, { enabled: false }])),
              })) as {
                violations: ReadonlyArray<{ id: string; impact: string | null; help: string; nodes: ReadonlyArray<{ target: ReadonlyArray<string> }> }>
              }

              return result.violations.map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                help: violation.help,
                nodes: violation.nodes.map((node) => {
                  const rect = document.querySelector(node.target.join(' '))?.getBoundingClientRect()

                  return {
                    target: node.target,
                    rect: rect === undefined ? undefined : { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height },
                  }
                }),
              }))
            }, pageRules),
          ),
        )
      ).flat() as ReadonlyArray<AxeViolation>

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
