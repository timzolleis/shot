import type { Rect } from './dom.ts'

/** A finding from an in-page check; the core adds nothing to it. */
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
  /** Shown before the title in `shot outline` (`▸ ` for a card). */
  readonly marker?: string
}

/** A named token value, in px where an element sits. */
export interface TokenValue {
  readonly name: string
  readonly px: number
}

export interface TypeRole extends TokenValue {
  readonly lineHeight: number
}

/**
 * What a plugin's runtime module may export. Each export replaces or adds to the generic runtime:
 * `sectionsIn` redefines sections; `checks` adds in-page checks by name; `spacingSteps` and `typeRoles` label the
 * gaps and type overlays with the project's tokens.
 */
export interface RuntimeExtension {
  readonly sectionsIn?: (document: Document) => ReadonlyArray<RuntimeSection>
  readonly checks?: Readonly<Record<string, (root: Element) => ReadonlyArray<RuntimeFinding>>>
  readonly spacingSteps?: (element: Element) => ReadonlyArray<TokenValue>
  readonly typeRoles?: (element: Element) => ReadonlyArray<TypeRole>
}
