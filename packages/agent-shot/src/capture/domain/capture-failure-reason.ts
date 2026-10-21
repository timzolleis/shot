import { Match } from 'effect'

import type { CaptureFailure } from './capture-error.ts'

/** One line for a failed capture: the render finding's message (A3). */
export const reasonFromCaptureFailure = (error: CaptureFailure): string =>
  Match.valueTags(error, {
    SourceRenderFailedError: ({ reason }) => reason,
    SourceTimedOutError: ({ waitedMs, waitedFor, consoleErrors }) =>
      [
        Match.value(waitedFor).pipe(
          Match.when(
            'waitUntilReady',
            () =>
              `not ready within ${waitedMs / 1000}s: app.waitUntilReady did not finish; give its waits a timeout under ${waitedMs / 1000}s to see which`,
          ),
          Match.when('load', () => `not ready within ${waitedMs / 1000}s: the page did not finish loading`),
          Match.exhaustive,
        ),
        ...consoleErrors.slice(0, 3).map((line) => `console: ${line.split('\n')[0]}`),
      ].join('; '),
    SourceRedirectedError: ({ landedOn }) => `redirected to ${landedOn}`,
    SectionNotFoundError: ({ title, outline }) =>
      `no section "${title}"; sections: ${
        outline === ''
          ? '(none)'
          : outline
              .split('\n')
              .map((line) => line.trim())
              .join(', ')
      }`,
    AmbiguousSectionError: ({ title, matches }) =>
      `"${title}" matches ${matches.length} sections: ${matches.join(', ')}; add ' >> nth=<i>'`,
    SelectionNotFoundError: ({ selector, reason }) => `--select ${selector}: ${reason}`,
    StepFailedError: ({ step, reason }) => `step ${step}: ${reason}`,
    LoupeTooLargeError: ({ factor, width, height }) =>
      `--loupe ${factor} gives ${width}×${height}px, over 2400px; pick a smaller part or factor`,
  })
