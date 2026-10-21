import { describe, expect, it } from '@effect/vitest'

import { stepsFromArgv } from '../src/flags.ts'

describe('stepsFromArgv', () => {
  it('keeps command-line order across step flags; other flags and their values are skipped', () => {
    expect(
      stepsFromArgv(['/settings', '--as', 'admin', '--fill', '[name=email]=a@b.c', '--key=Enter', '--click', '#save', '--wait', '300']),
    ).toEqual([
      { _tag: 'Fill', selector: '[name=email]', text: 'a@b.c' },
      { _tag: 'Key', key: 'Enter' },
      { _tag: 'Click', selector: '#save' },
      { _tag: 'Wait', ms: 300 },
    ])
  })
})
