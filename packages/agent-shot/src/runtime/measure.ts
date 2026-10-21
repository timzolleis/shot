import {
  elementsIn,
  isVisual,
  pageRect,
  px,
  type Rect,
  round,
  selectorFromElement,
  type Sides,
  sides,
  textRuns,
} from './dom.ts'

export interface GapBand {
  /** `vertical`: between stacked siblings; `horizontal`: between siblings side by side. */
  readonly axis: 'vertical' | 'horizontal'
  readonly rect: Rect
  readonly size: number
  /** Wider than the parent's gap plus the margins: alignment made it, no token owns it. */
  readonly free: boolean
}

/** Children that take part in layout; `display: contents` wrappers are transparent. */
const layoutChildren = (element: Element): ReadonlyArray<Element> =>
  Array.from(element.children).flatMap((child) => {
    const style = getComputedStyle(child)

    if (style.display === 'contents') return layoutChildren(child)

    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') return []

    return [child]
  })

const declaredGap = (parent: Element, previous: Element, next: Element, axis: GapBand['axis']): number => {
  const style = getComputedStyle(parent)
  const before = getComputedStyle(previous)
  const after = getComputedStyle(next)
  const layout = /flex|grid/.test(style.display)

  if (axis === 'vertical') {
    const margins = px(before.marginBottom) + px(after.marginTop)

    return layout ? px(style.rowGap) + margins : Math.max(px(before.marginBottom), px(after.marginTop))
  }

  return (layout ? px(style.columnGap) : 0) + px(before.marginRight) + px(after.marginLeft)
}

/** Every gap between two neighbouring siblings in `root`, in page coordinates. */
export const measureGaps = (root: Element): ReadonlyArray<GapBand> => {
  const bands = new Map<string, GapBand>()

  for (const parent of [root, ...root.querySelectorAll('*')]) {
    if (parent.closest('svg') !== null || parent.closest('[data-shot-overlay]') !== null) continue

    const children = layoutChildren(parent).filter((child) => {
      const box = child.getBoundingClientRect()

      return box.width > 0 && box.height > 0
    })

    const boxes = children.map((child) => child.getBoundingClientRect())

    const add = (index: number, axis: GapBand['axis'], rect: Rect, size: number) => {
      const key = `${axis}:${rect.y}:${rect.x}:${size}`

      if (bands.has(key)) return
      const declared = declaredGap(parent, children[index - 1]!, children[index]!, axis)
      bands.set(key, { axis, rect, size, free: size > declared + 0.5 })
    }

    for (let index = 1; index < boxes.length; index++) {
      const previous = boxes[index - 1]!
      const next = boxes[index]!
      const vertical = Math.round(next.top - previous.bottom)
      const left = Math.max(previous.left, next.left)
      const right = Math.min(previous.right, next.right)

      if (vertical > 0 && right > left) {
        add(index, 'vertical', pageRect(new DOMRect(left, previous.bottom, right - left, vertical)), vertical)
        continue
      }

      const horizontal = Math.round(next.left - previous.right)
      const top = Math.max(previous.top, next.top)
      const bottom = Math.min(previous.bottom, next.bottom)

      if (horizontal > 0 && bottom > top) {
        add(index, 'horizontal', pageRect(new DOMRect(previous.right, top, horizontal, bottom - top)), horizontal)
      }
    }
  }

  return [...bands.values()].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
}

export interface TypeSample {
  readonly selector: string
  readonly text: string
  readonly rect: Rect
  readonly size: number
  readonly lineHeight: number | undefined
  readonly weight: string
}

export const measureType = (root: Element): ReadonlyArray<TypeSample> =>
  textRuns(root).map((run) => {
    const style = getComputedStyle(run.element)
    const size = px(style.fontSize)
    const lineHeight = style.lineHeight === 'normal' ? undefined : px(style.lineHeight)

    return {
      selector: selectorFromElement(run.element),
      text: (run.element.textContent ?? '').trim().slice(0, 40),
      rect: run.rect,
      size,
      lineHeight,
      weight: style.fontWeight,
    }
  })

export interface BoxSample {
  readonly selector: string
  readonly rect: Rect
  readonly padding: Sides
  readonly border: Sides
  readonly margin: Sides
}

export const measureBoxes = (root: Element): ReadonlyArray<BoxSample> =>
  elementsIn(root)
    .slice(0, 400)
    .map((element) => {
      const style = getComputedStyle(element)

      return {
        selector: selectorFromElement(element),
        rect: pageRect(element.getBoundingClientRect()),
        padding: sides(style, 'padding'),
        border: sides(style, 'border', '-width'),
        margin: sides(style, 'margin'),
      }
    })

interface EdgeItem {
  readonly element: Element
  readonly kind: 'box' | 'text'
  readonly rect: Rect
  readonly baseline: number | undefined
}

export interface Guide {
  readonly axis: 'x' | 'y'
  readonly at: number
  readonly from: number
  readonly to: number
  readonly count: number
}

export interface NearMiss {
  readonly edge: 'left' | 'right' | 'center-y' | 'baseline'
  readonly a: string
  readonly b: string
  readonly delta: number
  readonly rects: readonly [Rect, Rect]
  readonly at: readonly [number, number]
}

const related = (a: Element, b: Element) => a.contains(b) || b.contains(a)

const edgeItems = (root: Element): ReadonlyArray<EdgeItem> => [
  ...elementsIn(root)
    .filter((element) => element !== root && isVisual(element))
    .map((element) => ({
      element,
      kind: 'box' as const,
      rect: pageRect(element.getBoundingClientRect()),
      baseline: undefined,
    })),
  ...textRuns(root).map((run) => ({
    element: run.element,
    kind: 'text' as const,
    rect: run.rect,
    baseline: run.baseline,
  })),
]

/** Shared edges become guides; edges 1–3px apart between neighbours are near-misses. */
export const measureEdges = (root: Element) => {
  const items = edgeItems(root)
  const guides: Array<Guide> = []

  const collect = (axis: 'x' | 'y', values: ReadonlyArray<{ at: number; from: number; to: number }>) => {
    const sorted = [...values].sort((a, b) => a.at - b.at)
    let group: Array<{ at: number; from: number; to: number }> = []

    const flush = () => {
      if (group.length >= 2) {
        guides.push({
          axis,
          at: round(group[0]!.at),
          from: Math.min(...group.map((value) => value.from)),
          to: Math.max(...group.map((value) => value.to)),
          count: group.length,
        })
      }

      group = []
    }

    for (const value of sorted) {
      if (group.length > 0 && Math.abs(value.at - group[0]!.at) >= 0.5) flush()
      group.push(value)
    }

    flush()
  }

  collect(
    'x',
    items.flatMap((item) => [
      { at: item.rect.x, from: item.rect.y, to: item.rect.y + item.rect.height },
      { at: item.rect.x + item.rect.width, from: item.rect.y, to: item.rect.y + item.rect.height },
    ]),
  )
  collect(
    'y',
    items.flatMap((item) =>
      item.baseline === undefined
        ? [
            { at: item.rect.y, from: item.rect.x, to: item.rect.x + item.rect.width },
            { at: item.rect.y + item.rect.height, from: item.rect.x, to: item.rect.x + item.rect.width },
          ]
        : [{ at: item.baseline, from: item.rect.x, to: item.rect.x + item.rect.width }],
    ),
  )
  const nearMisses: Array<NearMiss> = []
  const near = (delta: number) => delta >= 0.75 && delta <= 3.25

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!
      const b = items[j]!

      if (related(a.element, b.element)) continue
      const verticalGap = Math.max(b.rect.y - (a.rect.y + a.rect.height), a.rect.y - (b.rect.y + b.rect.height))
      const horizontalGap = Math.max(b.rect.x - (a.rect.x + a.rect.width), a.rect.x - (b.rect.x + b.rect.width))

      const add = (edge: NearMiss['edge'], atA: number, atB: number) => {
        const delta = round(Math.abs(atA - atB))

        if (near(delta)) {
          nearMisses.push({
            edge,
            a: selectorFromElement(a.element),
            b: selectorFromElement(b.element),
            delta,
            rects: [a.rect, b.rect],
            at: [atA, atB],
          })
        }
      }

      // Stacked neighbours: left and right edges should line up.
      if (verticalGap >= 0 && verticalGap <= 24 && horizontalGap < 0) {
        add('left', a.rect.x, b.rect.x)
        add('right', a.rect.x + a.rect.width, b.rect.x + b.rect.width)
      }

      // One row: baselines of text, centres of boxes.
      if (horizontalGap >= 0 && horizontalGap <= 48 && verticalGap < 0) {
        if (a.baseline !== undefined && b.baseline !== undefined) add('baseline', a.baseline, b.baseline)

        if (a.kind === 'box' && b.kind === 'box')
          add('center-y', a.rect.y + a.rect.height / 2, b.rect.y + b.rect.height / 2)
      }
    }
  }

  return { guides, nearMisses }
}

/** `--measure`: per element its box, spacing, radius, font and the requested styles. */
export const measureElements = (elements: ReadonlyArray<Element>, styles: ReadonlyArray<string>) =>
  elements.map((element, index) => {
    const style = getComputedStyle(element)

    return {
      selector: selectorFromElement(element),
      index,
      text: ((element instanceof HTMLElement ? element.innerText : element.textContent) ?? '')
        .trim()
        .replaceAll(/\s+/g, ' ')
        .slice(0, 80),
      rect: pageRect(element.getBoundingClientRect()),
      padding: sides(style, 'padding'),
      border: sides(style, 'border', '-width'),
      margin: sides(style, 'margin'),
      radius: ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) =>
        style.getPropertyValue(`border-${corner}-radius`),
      ),
      font: {
        family: style.fontFamily,
        size: style.fontSize,
        lineHeight: style.lineHeight,
        weight: style.fontWeight,
        letterSpacing: style.letterSpacing,
      },
      styles: Object.fromEntries(styles.map((name) => [name, style.getPropertyValue(name)])),
    }
  })
