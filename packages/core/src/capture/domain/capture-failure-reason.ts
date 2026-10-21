import { Match } from 'effect'

import type { CaptureFailure } from './capture-error.ts'

/** One line for a failed capture: the render finding's message (A3). */
export const reasonFromCaptureFailure = (error: CaptureFailure): string =>
  Match.valueTags(error, {
    SourceRenderFailedError: ({ reason }) => reason,
    SourceTimedOutError: ({ waitedMs, consoleErrors }) =>
      [
        `not ready within ${waitedMs / 1000}s`,
        ...consoleErrors.slice(0, 3).map((line) => `console: ${line.split('\n')[0]}`),
      ].join('; '),
    SourceRedirectedError: ({ landedOn }) => `redirected to ${landedOn}`,
    SectionNotFoundError: ({ title, outline }) =>
      `no section "${title}"; sections:${outline === '' ? ' (none)' : `\n${outline}`}`,
    AmbiguousSectionError: ({ title, matches }) =>
      `"${title}" matches ${matches.length} sections: ${matches.join(', ')}; add ' >> nth=<i>'`,
    SelectionNotFoundError: ({ selector, reason }) => `--select ${selector}: ${reason}`,
    StepFailedError: ({ step, reason }) => `step ${step}: ${reason}`,
    UnknownDeviceError: ({ device, closest }) => `no device "${device}"; closest: ${closest.join(', ')}`,
    LoupeTooLargeError: ({ factor, width, height }) =>
      `--loupe ${factor} gives ${width}×${height}px, over 2400px; pick a smaller part or factor`,
  })
