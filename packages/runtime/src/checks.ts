import { elementsIn, isVisible, ownText, pageRect, px, type Rect, selectorFromElement, unionRect } from './dom.ts'
import type { RuntimeFinding } from './types.ts'
import { measureEdges } from './measure.ts'

const finding = (
  check: string,
  severity: RuntimeFinding['severity'],
  message: string,
  element: Element,
  rect?: Rect,
): RuntimeFinding => ({
  check,
  severity,
  message,
  selector: selectorFromElement(element),
  rect: rect ?? pageRect(element.getBoundingClientRect()),
})

export const checkOverflow = (root: Element): ReadonlyArray<RuntimeFinding> =>
  elementsIn(root).flatMap((element) => {
    if (!(element instanceof HTMLElement) || ownText(element) === '') return []
    const style = getComputedStyle(element)

    if (style.display === 'inline') return []
    const excessX = element.scrollWidth - element.clientWidth
    const excessY = element.scrollHeight - element.clientHeight

    const truncated =
      style.textOverflow === 'ellipsis' || (style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '')

    if (style.overflowX === 'visible' && excessX > 1)
      return [finding('overflow', 'warn', `text overflows its box by ${excessX}px`, element)]

    if ((style.overflowX === 'hidden' || style.overflowX === 'clip') && excessX > 1 && !truncated) {
      return [finding('overflow', 'warn', `text clipped by ${excessX}px without an ellipsis`, element)]
    }

    if ((style.overflowY === 'hidden' || style.overflowY === 'clip') && excessY > 1 && !truncated) {
      return [finding('overflow', 'warn', `text clipped by ${excessY}px vertically`, element)]
    }

    return []
  })

const interactive =
  'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=checkbox], [role=switch], [role=radio], [role=tab], [role=menuitem], [role=link], [role=option], [role=slider], [tabindex]:not([tabindex="-1"])'

/** The element's box, grown by an absolutely positioned `::after`/`::before` (a hit-area utility). */
const hitSize = (element: Element) => {
  const rect = element.getBoundingClientRect()
  let width = rect.width
  let height = rect.height

  for (const pseudo of ['::after', '::before']) {
    const style = getComputedStyle(element, pseudo)

    if (style.content === 'none' || style.position !== 'absolute') continue
    width = Math.max(width, px(style.width))
    height = Math.max(height, px(style.height))
  }

  return { width, height }
}

/** Touch targets under 24×24 (error) or 44×44 (warn), on coarse pointers only. A label's area counts. */
export const checkTargets = (root: Element): ReadonlyArray<RuntimeFinding> => {
  if (!matchMedia('(pointer: coarse)').matches) return []

  const candidates = [root, ...root.querySelectorAll(interactive)].filter(
    (element) => element.matches(interactive) && isVisible(element) && !element.matches(':disabled'),
  )

  return candidates.flatMap((element) => {
    const own = hitSize(element)

    const labelElement =
      element.closest('label') ?? (element.id ? document.querySelector(`label[for="${element.id}"]`) : null)

    const labelled = labelElement === null ? own : hitSize(labelElement)
    const width = Math.round(Math.max(own.width, labelled.width))
    const height = Math.round(Math.max(own.height, labelled.height))

    if (width < 24 || height < 24)
      return [finding('target', 'error', `touch target ${width}×${height}, under 24×24`, element)]

    if (width < 44 || height < 44)
      return [finding('target', 'warn', `touch target ${width}×${height}, under 44×44`, element)]

    return []
  })
}

export const checkAlign = (root: Element): ReadonlyArray<RuntimeFinding> =>
  measureEdges(root).nearMisses.map((miss) => ({
    check: 'align',
    severity: 'warn',
    message: `${miss.edge} edges ${miss.delta}px apart: ${miss.a} and ${miss.b}`,
    selector: miss.a,
    rect: unionRect(miss.rects),
  }))
