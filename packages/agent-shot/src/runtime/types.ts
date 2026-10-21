import type { Rect } from './dom.ts'

/** A finding from an in-page check. */
export interface RuntimeFinding {
  readonly check: string
  readonly severity: 'error' | 'warn'
  readonly message: string
  readonly selector: string
  readonly rect: Rect | undefined
}

export interface RuntimeSection {
  readonly element: Element
  readonly title: string
}
