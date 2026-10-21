/** DOM helpers shared by the in-page runtime. Coordinates are page coordinates (CSS px from the document's top-left). */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const round = (value: number) => Math.round(value * 100) / 100

export const pageRect = (rect: DOMRect | Rect): Rect =>
  rect instanceof DOMRect
    ? {
        x: round(rect.left + scrollX),
        y: round(rect.top + scrollY),
        width: round(rect.width),
        height: round(rect.height),
      }
    : rect

export const unionRect = (rects: ReadonlyArray<Rect>): Rect => {
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))

  return { x, y, width: right - x, height: bottom - y }
}

export const ownText = (element: Element): string =>
  Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim()

const cssEscape = (value: string) => (typeof CSS !== 'undefined' ? CSS.escape(value) : value)

/** A selector `--select` accepts: an id, a `data-slot`/`data-testid`, else the tag; `>> nth=i` when not unique. */
export const selectorFromElement = (element: Element): string => {
  const tag = element.tagName.toLowerCase()

  const css =
    element.id !== ''
      ? `#${cssEscape(element.id)}`
      : element.hasAttribute('data-testid')
        ? `[data-testid="${element.getAttribute('data-testid')}"]`
        : element.hasAttribute('data-slot')
          ? `[data-slot=${element.getAttribute('data-slot')}]`
          : tag

  const matches = Array.from(document.querySelectorAll(css))
  const index = matches.indexOf(element)

  return index <= 0 ? css : `${css} >> nth=${index}`
}

export const isOverlay = (element: Element) => element.closest('[data-shot-overlay]') !== null

export const isVisible = (element: Element): boolean => {
  if (isOverlay(element)) return false
  const rect = element.getBoundingClientRect()

  if (rect.width === 0 || rect.height === 0) return false
  const style = getComputedStyle(element)

  return style.visibility !== 'hidden' && style.opacity !== '0'
}

/** `root` and every visible element inside it, outside SVG internals. */
export const elementsIn = (root: Element): ReadonlyArray<Element> =>
  [root, ...root.querySelectorAll('*')].filter(
    (element) => isVisible(element) && (element.tagName.toLowerCase() === 'svg' || element.closest('svg') === null),
  )

export const px = (value: string) => Number.parseFloat(value) || 0

/** Top, right, bottom, left. */
export type Sides = readonly [number, number, number, number]

export const sides = (style: CSSStyleDeclaration, prefix: string, suffix = ''): Sides => {
  const side = (name: string) => px(style.getPropertyValue(`${prefix}-${name}${suffix}`))

  return [side('top'), side('right'), side('bottom'), side('left')]
}

const transparent = (color: string) =>
  color === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color)

/** Paints something itself: a fill, a border, a shadow, or replaced content. */
export const isVisual = (element: Element): boolean => {
  if (['img', 'svg', 'input', 'textarea', 'select', 'video', 'canvas', 'hr'].includes(element.tagName.toLowerCase())) {
    return true
  }

  const style = getComputedStyle(element)

  if (!transparent(style.backgroundColor) || style.backgroundImage !== 'none' || style.boxShadow !== 'none') return true

  return sides(style, 'border', '-width').some(
    (width, index) =>
      width > 0 && !transparent(style.getPropertyValue(`border-${['top', 'right', 'bottom', 'left'][index]}-color`)),
  )
}

export interface TextRun {
  readonly element: Element
  readonly rect: Rect
  /** The first line's baseline, page y. */
  readonly baseline: number
}

export const textRuns = (root: Element): ReadonlyArray<TextRun> =>
  elementsIn(root).flatMap((element) => {
    const nodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )

    if (nodes.length === 0) return []
    const range = document.createRange()
    range.setStartBefore(nodes[0]!)
    range.setEndAfter(nodes.at(-1)!)
    const rect = range.getBoundingClientRect()
    const probe = document.createElement('span')
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
    element.insertBefore(probe, nodes[0]!)
    const baseline = probe.getBoundingClientRect().top + scrollY
    probe.remove()

    return rect.width > 0 ? [{ element, rect: pageRect(rect), baseline: round(baseline) }] : []
  })

/** CSS lengths (`var(--x)` included) in px, resolved where `element` sits. */
export const resolvedPx = (element: Element, values: ReadonlyArray<string>): ReadonlyArray<number> => {
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  element.append(probe)

  const resolved = values.map((value) => {
    probe.style.height = value

    return Math.round(probe.getBoundingClientRect().height * 100) / 100
  })

  probe.remove()

  return resolved
}
