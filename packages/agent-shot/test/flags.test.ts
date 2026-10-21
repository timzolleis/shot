import { describe, expect, it } from '@effect/vitest'

import { Click, Fill, Key, Wait } from '../src/index.ts'

import { stepsFromArgv } from '../src/cli/flags.ts'

describe('stepsFromArgv', () => {
  it('keeps command-line order across step flags; other flags and their values are skipped', () => {
    expect(
      stepsFromArgv([
        '/settings',
        '--as',
        'admin',
        '--fill',
        '[name=email]=a@b.c',
        '--key=Enter',
        '--click',
        '#save',
        '--wait',
        '300',
      ]),
    ).toEqual([
      Fill.make({ selector: '[name=email]', text: 'a@b.c' }),
      Key.make({ key: 'Enter' }),
      Click.make({ selector: '#save' }),
      Wait.make({ ms: 300 }),
    ])
  })
})
