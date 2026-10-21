/** Types of the in-page runtime, for the core. */
import type { PageRuntime } from './page-runtime.ts'

export type { Rect } from './dom.ts'

export type { OverlayKind } from './overlays.ts'

export type { RuntimeFinding, RuntimeSection } from './types.ts'

export type { PageRuntime }

/** The runtime's entry file, for bundling. */
export const pageRuntimeEntry = new URL('./page-runtime.ts', import.meta.url).pathname

declare global {
  interface Window {
    __shot: PageRuntime
    /** Set by the core's slow clock; `--slow` frames call it. */
    __shotSetSlow?: (rate: number) => void
  }
}
