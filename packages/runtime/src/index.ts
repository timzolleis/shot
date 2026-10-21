/** Types of the in-page runtime, for the core and for plugins' runtime modules. */
import type { PageRuntime } from './page-runtime.ts'

export type { Rect } from './dom.ts'
export type { RuntimeExtension, RuntimeFinding, RuntimeSection, TokenValue, TypeRole } from './extension.ts'
export type { OverlayKind } from './overlays.ts'
export type { PageRuntime }

/** The runtime's entry file, for bundling. */
export const pageRuntimeEntry = new URL('./page-runtime.ts', import.meta.url).pathname

declare global {
  interface Window {
    __shot: PageRuntime
  }
}
