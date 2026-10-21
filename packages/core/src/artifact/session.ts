import type { CaptureResult } from '../capture/domain/capture-result.ts'
import type { FlowResult } from '../flow/domain/flow.ts'

/** What one label holds: `label` is '' for captures shot without `--label` (A6). */
export interface SessionLabel {
  readonly label: string
  readonly captures: ReadonlyArray<CaptureResult>
  readonly flows: ReadonlyArray<FlowResult>
}

/** A session directory, its labels in the order they were first written. `dir` is relative to the project root. */
export interface Session {
  readonly name: string
  readonly dir: string
  readonly labels: ReadonlyArray<SessionLabel>
}

export const labelDisplayName = (label: string): string => (label === '' ? 'shot' : label)

/** `.shots/<session>/[<label>/]`: a label picks the directory, not the key (A6). */
export const labelDirFromSession = ({ sessionDir, label }: { readonly sessionDir: string; readonly label: string }): string =>
  label === '' ? sessionDir : `${sessionDir}/${label}`

export const captureFileFromKey = (input: {
  readonly sessionDir: string
  readonly label: string
  readonly key: string
  readonly extension: string
}): string => `${labelDirFromSession(input)}/${input.key}.${input.extension}`

/** `$SHOT_SESSION`, else the last 8 characters of an agent session id, else `local`. */
export const sessionNameFromEnv = (env: Readonly<Record<string, string | undefined>>): string =>
  env['SHOT_SESSION'] ?? env['PI_SESSION_ID']?.slice(-8) ?? env['CLAUDE_SESSION_ID']?.slice(-8) ?? 'local'
