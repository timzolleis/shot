import { elementsIn, isVisual, ownText, pageRect, type Rect, selectorFromElement } from './dom.ts'

/**
 * The elements a still shows, for naming what a review note points at: controls, headings, landmarks, text and
 * anything that paints a box (a card, a chip). Page coordinates; the core moves them to the still's origin.
 */

export interface RuntimeElement {
  readonly selector: string
  readonly role: string
  readonly name: string
  readonly rect: Rect
}

const maxElements = 600
const maxNameLength = 60

const interactive =
  'a[href], button, input, select, textarea, summary, [role], [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]'

const structural = 'h1, h2, h3, h4, h5, h6, img, nav, main, header, footer, aside, section, form, dialog, li, label'

const inputRoles = new Map<string, string>([
  ['checkbox', 'checkbox'],
  ['radio', 'radio'],
  ['range', 'slider'],
  ['button', 'button'],
  ['submit', 'button'],
  ['reset', 'button'],
  ['search', 'searchbox'],
])

const tagRoles = new Map<string, string>([
  ['a', 'link'],
  ['button', 'button'],
  ['select', 'combobox'],
  ['textarea', 'textbox'],
  ['summary', 'button'],
  ['h1', 'heading'],
  ['h2', 'heading'],
  ['h3', 'heading'],
  ['h4', 'heading'],
  ['h5', 'heading'],
  ['h6', 'heading'],
  ['img', 'img'],
  ['nav', 'navigation'],
  ['main', 'main'],
  ['header', 'banner'],
  ['footer', 'contentinfo'],
  ['aside', 'complementary'],
  ['section', 'region'],
  ['form', 'form'],
  ['dialog', 'dialog'],
  ['li', 'listitem'],
  ['ul', 'list'],
  ['ol', 'list'],
])

/** The ARIA role, explicit or implied by the tag; else the tag. */
const roleOf = (element: Element): string => {
  const explicit = element.getAttribute('role')

  if (explicit !== null && explicit !== '') return explicit.split(' ')[0]!
  const tag = element.tagName.toLowerCase()

  if (tag === 'input') return inputRoles.get((element.getAttribute('type') ?? 'text').toLowerCase()) ?? 'textbox'

  return tagRoles.get(tag) ?? tag
}

const shortened = (text: string): string => {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim()

  return collapsed.length > maxNameLength ? `${collapsed.slice(0, maxNameLength - 1)}…` : collapsed
}

const labelledByText = (element: Element): string =>
  (element.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => (id === '' ? '' : (document.getElementById(id)?.textContent ?? '')))
    .join(' ')

const labelText = (element: Element): string => {
  if (element.id === '') return ''

  return document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent ?? ''
}

/** Close to the accessible name: aria-label, labelledby, alt, a label, placeholder, title, else the text. */
const nameOf = (element: Element): string => {
  const candidates = [
    element.getAttribute('aria-label') ?? '',
    labelledByText(element),
    element.getAttribute('alt') ?? '',
    labelText(element),
    element.getAttribute('placeholder') ?? '',
    element.getAttribute('title') ?? '',
    element instanceof HTMLElement ? element.innerText : (element.textContent ?? ''),
  ]

  return shortened(candidates.find((candidate) => candidate.trim() !== '') ?? '')
}

const isNamed = (element: Element): boolean =>
  element.matches(interactive) || element.matches(structural) || ownText(element) !== '' || isVisual(element)

/** Visible elements in `root`, in document order, capped at 600. */
export const pageElements = (root: Element): ReadonlyArray<RuntimeElement> =>
  elementsIn(root)
    .filter(isNamed)
    .slice(0, maxElements)
    .map((element) => ({
      selector: selectorFromElement(element),
      role: roleOf(element),
      name: nameOf(element),
      rect: pageRect(element.getBoundingClientRect()),
    }))
