import type { RuntimeSection } from './types.ts'

/**
 * Generic sections: `[data-shot-section]`, `section` and `[role=region]`, titled by `data-shot-section`'s value,
 * their accessible name, else their own first heading (not one that belongs to a section nested inside).
 */
const candidateSelector = '[data-shot-section], section, [role=region]'

const textOf = (element: Element | null): string => (element?.textContent ?? '').trim().replaceAll(/\s+/g, ' ')

const ownHeading = (element: Element): string =>
  textOf(
    Array.from(element.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')).find(
      (heading) => heading.closest(candidateSelector) === element,
    ) ?? null,
  )

const accessibleName = (element: Element): string => {
  const label = element.getAttribute('aria-label')
  if (label !== null && label.trim() !== '') return label.trim()
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy === null) return ''
  return labelledBy
    .split(/\s+/)
    .map((id) => textOf(document.getElementById(id)))
    .join(' ')
    .trim()
}

const sectionTitle = (element: Element): string => {
  const named = element.getAttribute('data-shot-section')
  if (named !== null && named.trim() !== '') return named.trim()
  return accessibleName(element) || ownHeading(element)
}

/** Rendered: hidden dialogs and collapsed panels are not sections to shoot. */
const isRendered = (element: Element) => element.getClientRects().length > 0

export const genericSectionsIn = (root: Document): ReadonlyArray<RuntimeSection> =>
  Array.from(root.body.querySelectorAll(candidateSelector))
    .filter(isRendered)
    .map((element) => ({ element, title: sectionTitle(element) }))
    .filter((section) => section.title !== '')
