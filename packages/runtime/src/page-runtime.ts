import { checkAlign, checkOverflow, checkTargets } from './checks.ts'
import { measureElements } from './measure.ts'
import { clearOverlays, drawOverlays } from './overlays.ts'
import { genericSectionsIn } from './sections.ts'
import type { RuntimeFinding } from './types.ts'

/**
 * The in-page half of shot: outline, sections, overlays, measurements and DOM checks. The core bundles this file and
 * injects it into each page once it is ready, as `window.__shot`.
 */

const checks = new Map([
  ['overflow', checkOverflow],
  ['target', checkTargets],
  ['align', checkAlign],
])

/** Section titles in document order, with nesting depth. */
const outline = (): ReadonlyArray<{ title: string; depth: number }> => {
  const found = genericSectionsIn(document)
  const elements = new Set(found.map((section) => section.element))

  return found.map((section) => {
    let depth = 0

    for (let parent = section.element.parentElement; parent !== null; parent = parent.parentElement) {
      if (elements.has(parent)) depth++
    }

    return { title: section.title, depth }
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
):
  | { readonly _tag: 'Marked' }
  | { readonly _tag: 'NotFound' }
  | { readonly _tag: 'Ambiguous'; readonly matches: ReadonlyArray<string> } => {
  const needle = title.toLowerCase()
  const found = genericSectionsIn(document)
  const exact = found.filter((section) => section.title.toLowerCase() === needle)
  const matching = exact.length > 0 ? exact : found.filter((section) => section.title.toLowerCase().includes(needle))
  const chosen = nth === undefined ? matching : matching.slice(nth, nth + 1)

  if (chosen.length === 1) {
    chosen[0]!.element.setAttribute('data-shot-part', mark)

    return { _tag: 'Marked' }
  }

  return chosen.length > 1
    ? { _tag: 'Ambiguous', matches: chosen.map((section) => section.title) }
    : { _tag: 'NotFound' }
}

const runChecks = (names: ReadonlyArray<string>, root: Element): ReadonlyArray<RuntimeFinding> =>
  names.flatMap((name) => checks.get(name)?.(root) ?? [])

const runtime = {
  outline,
  markSection,
  overlay: drawOverlays,
  clearOverlay: clearOverlays,
  measure: measureElements,
  check: runChecks,
}

export type PageRuntime = typeof runtime

window.__shot = runtime
