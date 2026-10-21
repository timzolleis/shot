import { Context, type Effect, type Option } from 'effect'

import type { CaptureResult } from '../capture/domain/capture-result.ts'
import type { EvidenceReport } from '../evidence/domain/evidence-report.ts'
import type { FlowResult } from '../flow/domain/flow.ts'
import type { Session } from './session.ts'

export interface HostDefaults {
  readonly user: string
  readonly params: Readonly<Record<string, string>>
}

/**
 * Where shot keeps files: `.shots/<session>/[<label>/]` with captures, a manifest of one file per result, flows and
 * the report; `.shots/auth/` sessions; `.shots/config.json` login defaults. Paths it returns are relative to the
 * project root.
 */
export class ArtifactStore extends Context.Service<
  ArtifactStore,
  {
    readonly projectRoot: string
    readonly sessionName: string
    readonly sessionDir: string
    absolutePath(file: string): string
    writeCaptureFile(input: {
      readonly label: string
      readonly key: string
      readonly extension: string
      readonly content: Uint8Array | string
      readonly measurements: unknown
    }): Effect.Effect<string>
    writeManifest(input: { readonly label: string; readonly results: ReadonlyArray<CaptureResult> }): Effect.Effect<void>
    /** A fresh directory for one flow's stills, video and trace. */
    makeFlowDir(input: { readonly label: string; readonly name: string }): Effect.Effect<string>
    writeFlowResult(input: { readonly label: string; readonly flowResult: FlowResult }): Effect.Effect<void>
    readSession(): Effect.Effect<Session>
    /** Composes the multi-label sheets, writes report.md, returns its path. */
    writeReport(report: EvidenceReport): Effect.Effect<string>
    readHostDefaults(host: string): Effect.Effect<Option.Option<HostDefaults>>
    writeHostDefaults(input: { readonly host: string } & HostDefaults): Effect.Effect<void>
    /** Absolute path of a cached app session's storage state. */
    authFile(sessionKey: string): string
    /** Removes the cached app sessions of a host, for one user or all; returns how many. */
    removeAuthFiles(input: { readonly host: string; readonly user: Option.Option<string> }): Effect.Effect<number>
    /** Removes this session's directory, or with `all` every session and cached login. */
    clean(input: { readonly all: boolean }): Effect.Effect<string>
  }
>()('shot/ArtifactStore') {}
