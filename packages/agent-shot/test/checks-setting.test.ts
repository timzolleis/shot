import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'

import { checksSettingFromConfig, type Finding, findingsAtLevels } from '../src/capture/domain/finding.ts'
import { github } from '../src/github/github-publisher.ts'
import { defineConfig } from '../src/plugin/shot-config.ts'
import { definePlugin } from '../src/plugin/shot-plugin.ts'

const finding = (check: string, severity: Finding['severity'] = 'warn'): Finding => ({
  check,
  severity,
  message: `${check} message`,
  selector: '',
  rect: Option.none(),
})

const findings = [finding('align'), finding('target'), finding('target', 'error'), finding('render', 'error')]
const shown = (list: ReadonlyArray<Finding>) => list.map((item) => `${item.severity} ${item.check}`)

describe('findingsAtLevels', () => {
  it('no setting → as the checks report them', () => {
    expect(shown(findingsAtLevels({ findings, checks: {} }))).toEqual([
      'warn align',
      'warn target',
      'error target',
      'error render',
    ])
  })

  it("'off' → only render findings", () => {
    expect(shown(findingsAtLevels({ findings, checks: 'off' }))).toEqual(['error render'])
  })

  it('align off, target error → align gone, every target finding an error', () => {
    expect(shown(findingsAtLevels({ findings, checks: { align: 'off', target: 'error' } }))).toEqual([
      'error target',
      'error target',
      'error render',
    ])
  })

  it('target warn → under 24×24 is a warning too', () => {
    expect(shown(findingsAtLevels({ findings, checks: { target: 'warn' } }))).toContain('warn target')
    expect(shown(findingsAtLevels({ findings, checks: { target: 'warn' } }))).not.toContain('error target')
  })
})

describe('checksSettingFromConfig', () => {
  const known = ['console', 'align', 'a11y']

  it.each([
    { checks: undefined, expected: {} },
    { checks: 'off', expected: 'off' },
    { checks: { align: 'off', a11y: 'error' }, expected: { align: 'off', a11y: 'error' } },
  ])('$checks → $expected', ({ checks, expected }) => {
    expect(Result.getOrThrow(checksSettingFromConfig({ checks, known }))).toEqual(expected)
  })

  it.each([
    { checks: { algn: 'off' }, expected: 'unknown check "algn" in checks; checks: console, align, a11y' },
    { checks: { align: 'quiet' }, expected: "checks must be 'off' or { <check>: 'off' | 'warn' | 'error' }" },
    { checks: 'on', expected: "checks must be 'off' or { <check>: 'off' | 'warn' | 'error' }" },
  ])('$checks → "$expected"', ({ checks, expected }) => {
    const result = checksSettingFromConfig({ checks, known })
    expect(Result.isFailure(result) && result.failure).toBe(expected)
  })
})

describe('defineConfig types checks (compile time)', () => {
  const todos = definePlugin({
    name: 'todos',
    checks: [{ check: 'todo', appliesTo: () => true, runCheck: () => [] }],
  })

  it('core and plugin check names type; a typo or a wrong level does not compile', () => {
    defineConfig({ checks: 'off' })
    defineConfig({ checks: { align: 'off', console: 'warn', target: 'error' } })
    defineConfig({ plugins: [todos, github()], checks: { todo: 'error', align: 'off' } })

    // @ts-expect-error a typo of a core check
    defineConfig({ checks: { algn: 'off' } })
    // @ts-expect-error a plugin check without its plugin
    defineConfig({ plugins: [github()], checks: { todo: 'off' } })
    // @ts-expect-error not a level
    defineConfig({ checks: { align: 'quiet' } })
    // @ts-expect-error render is not a check: a capture that did not render always fails
    defineConfig({ checks: { render: 'off' } })

    expect(true).toBe(true)
  })
})
