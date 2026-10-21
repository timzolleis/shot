import { checkAlign, checkOverflow, checkTargets } from './checks.ts'
import type { RuntimeExtension, RuntimeFinding, RuntimeSection, TokenValue, TypeRole } from './extension.ts'
import { measureElements } from './measure.ts'
import { clearOverlays, drawOverlays, type OverlayKind } from './overlays.ts'
import { genericSectionsIn } from './sections.ts'

/**
 * The in-page half of shot: outline, sections, overlays, measurements and DOM checks. The core bundles this file with
 * the plugins' runtime modules and injects it into each page once it is ready, as `window.__shot`.
 */

let sectionsIn: (document: Document) => ReadonlyArray<RuntimeSection> = genericSectionsIn
let spacingSteps: (element: Element) => ReadonlyArray<TokenValue> = () => []
let typeRoles: (element: Element) => ReadonlyArray<TypeRole> = () => []
const checks: Record<string, (root: Element) => ReadonlyArray<RuntimeFinding>> = {
  overflow: checkOverflow,
  target: checkTargets,
  align: checkAlign,
}

/** A plugin's runtime module: its exports replace or add to the generic runtime. */
const extend = (extension: RuntimeExtension) => {
  if (extension.sectionsIn !== undefined) sectionsIn = extension.sectionsIn
  if (extension.spacingSteps !== undefined) spacingSteps = extension.spacingSteps
  if (extension.typeRoles !== undefined) typeRoles = extension.typeRoles
  Object.assign(checks, extension.checks ?? {})
}

/** Section titles in document order, with nesting depth. */
const outline = (): ReadonlyArray<{ title: string; depth: number; marker: string }> => {
  const found = sectionsIn(document)
  const elements = new Set(found.map((section) => section.element))
  return found.map((section) => {
    let depth = 0
    for (let parent = section.element.parentElement; parent !== null; parent = parent.parentElement) {
      if (elements.has(parent)) depth++
    }
    return { title: section.title, depth, marker: section.marker ?? '' }
  })
}

/**
 * Marks the section titled `title` with `data-shot-part=mark`: exact (case-insensitive), else a single substring
 * match; `nth` picks among equal titles.
 */
const markSection = (
  title: string,
  nth: number | undefined,
  mark: string,
): { readonly _tag: 'Marked' } | { readonly _tag: 'NotFound' } | { readonly _tag: 'Ambiguous'; readonly matches: ReadonlyArray<string> } => {
  const needle = title.toLowerCase()
  const found = sectionsIn(document)
  const exact = found.filter((section) => section.title.toLowerCase() === needle)
  const matching = exact.length > 0 ? exact : found.filter((section) => section.title.toLowerCase().includes(needle))
  const chosen = nth === undefined ? matching : matching.slice(nth, nth + 1)
  if (chosen.length === 1) {
    chosen[0]!.element.setAttribute('data-shot-part', mark)
    return { _tag: 'Marked' }
  }
  return chosen.length > 1 ? { _tag: 'Ambiguous', matches: chosen.map((section) => section.title) } : { _tag: 'NotFound' }
}

const overlay = (kinds: ReadonlyArray<OverlayKind>, root: Element) =>
  drawOverlays(kinds, root, { spacingSteps: spacingSteps(root), typeRoles: typeRoles(root) })

const runChecks = (names: ReadonlyArray<string>, root: Element): ReadonlyArray<RuntimeFinding> =>
  names.flatMap((name) => checks[name]?.(root) ?? [])

const runtime = {
  extend,
  outline,
  markSection,
  overlay,
  clearOverlay: clearOverlays,
  measure: measureElements,
  check: runChecks,
  checkNames: () => Object.keys(checks),
}

export type PageRuntime = typeof runtime

;(window as unknown as { __shot: PageRuntime }).__shot = runtime
