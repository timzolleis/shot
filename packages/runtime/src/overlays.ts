import { pageRect, type Rect, round, unionRect } from './dom.ts'
import {
  type BoxSample,
  type GapBand,
  measureBoxes,
  measureEdges,
  measureGaps,
  measureType,
  type TypeSample,
} from './measure.ts'

export type OverlayKind = 'boxes' | 'gaps' | 'edges' | 'type' | 'grid'

const OK = '#2563eb'
const OFF = '#dc2626'
const GUIDE = '#0891b2'
const FREE = '#6b7280'

/** The overlay layer: absolutely positioned in page coordinates, above everything, ignored by every measurement. */
const layer = (): HTMLElement => {
  const existing = document.querySelector<HTMLElement>('[data-shot-overlay]')

  if (existing !== null) return existing
  const element = document.createElement('div')
  element.setAttribute('data-shot-overlay', '')
  element.setAttribute('aria-hidden', 'true')
  element.style.cssText = `position:absolute;left:0;top:0;width:${document.documentElement.scrollWidth}px;height:${document.documentElement.scrollHeight}px;pointer-events:none;z-index:2147483647;`
  document.body.append(element)

  return element
}

const draw = (rect: Rect, css: string) => {
  const element = document.createElement('div')
  element.style.cssText = `position:absolute;box-sizing:border-box;left:${rect.x}px;top:${rect.y}px;width:${Math.max(rect.width, 1)}px;height:${Math.max(rect.height, 1)}px;${css}`
  layer().append(element)
}

const label = (text: string, x: number, y: number, color: string) => {
  const element = document.createElement('span')
  element.textContent = text
  element.style.cssText = `position:absolute;left:${x}px;top:${y}px;font:500 10px/12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:0 3px;border-radius:3px;background:#fff;color:${color};box-shadow:0 0 0 1px ${color};white-space:nowrap;`
  layer().append(element)
}

const drawBoxes = (boxes: ReadonlyArray<BoxSample>) => {
  for (const box of boxes) {
    const { x, y, width, height } = box.rect
    const [mt, mr, mb, ml] = box.margin as [number, number, number, number]
    const [pt, pr, pb, pl] = box.padding as [number, number, number, number]
    const [bt, br, bb, bl] = box.border as [number, number, number, number]
    const margin = 'background:rgba(249,115,22,.22)'

    if (mt > 0) draw({ x, y: y - mt, width, height: mt }, margin)

    if (mb > 0) draw({ x, y: y + height, width, height: mb }, margin)

    if (ml > 0) draw({ x: x - ml, y, width: ml, height }, margin)

    if (mr > 0) draw({ x: x + width, y, width: mr, height }, margin)
    const padding = 'background:rgba(34,197,94,.22)'
    const inner = { x: x + bl, y: y + bt, width: width - bl - br, height: height - bt - bb }

    if (pt > 0) draw({ ...inner, height: pt }, padding)

    if (pb > 0) draw({ ...inner, y: inner.y + inner.height - pb, height: pb }, padding)

    if (pl > 0) draw({ ...inner, y: inner.y + pt, width: pl, height: inner.height - pt - pb }, padding)

    if (pr > 0) draw({ ...inner, x: inner.x + inner.width - pr, y: inner.y + pt, width: pr, height: inner.height - pt - pb }, padding)
    draw(box.rect, `outline:1px solid ${OK}99;outline-offset:-1px`)
  }

  for (const box of boxes.filter((sample) => sample.rect.width >= 40 && sample.rect.height >= 14).slice(0, 80)) {
    label(`${round(box.rect.width)}×${round(box.rect.height)}`, box.rect.x + 1, box.rect.y + 1, OK)
  }
}

/** Gaps labelled with their size; free space (alignment, not a gap or margin) grey. */
const drawGaps = (gaps: ReadonlyArray<GapBand>) => {
  for (const gap of gaps) {
    const color = gap.free ? FREE : OK
    draw(gap.rect, `background:${gap.free ? 'rgba(107,114,128,.12)' : 'rgba(37,99,235,.2)'}`)
    label(`${gap.size}${gap.free ? ' free' : ''}`, gap.rect.x + gap.rect.width / 2 - 12, gap.rect.y + gap.rect.height / 2 - 6, color)
  }
}

const drawEdges = (edges: ReturnType<typeof measureEdges>) => {
  for (const guide of edges.guides) {
    if (guide.axis === 'x') draw({ x: guide.at, y: guide.from, width: 1, height: guide.to - guide.from }, `background:${GUIDE}aa`)
    else draw({ x: guide.from, y: guide.at, width: guide.to - guide.from, height: 1 }, `background:${GUIDE}aa`)
  }

  for (const miss of edges.nearMisses) {
    const span = unionRect(miss.rects)

    for (const at of miss.at) {
      if (miss.edge === 'left' || miss.edge === 'right') draw({ x: at, y: span.y, width: 1, height: span.height }, `background:${OFF}`)
      else draw({ x: span.x, y: at, width: span.width, height: 1 }, `background:${OFF}`)
    }

    label(`Δ${miss.delta} ${miss.edge}`, span.x + span.width + 2, span.y, OFF)
  }
}

const drawType = (samples: ReadonlyArray<TypeSample>) => {
  for (const sample of samples) {
    draw(sample.rect, `outline:1px dashed ${OK}88`)
    label(`${sample.size}/${sample.lineHeight ?? 'normal'} ${sample.weight}`, sample.rect.x, sample.rect.y - 12, OK)
  }
}

const drawGrid = (root: Element) => {
  draw(
    pageRect(root.getBoundingClientRect()),
    'background-image:linear-gradient(to right,rgba(220,38,38,.28) 1px,transparent 1px),linear-gradient(to bottom,rgba(220,38,38,.28) 1px,transparent 1px),linear-gradient(to right,rgba(220,38,38,.1) 1px,transparent 1px),linear-gradient(to bottom,rgba(220,38,38,.1) 1px,transparent 1px);background-size:16px 16px,16px 16px,4px 4px,4px 4px',
  )
}

/** Draws the overlays on `root` and returns what they measured. Everything is measured before anything is drawn. */
export const drawOverlays = (kinds: ReadonlyArray<OverlayKind>, root: Element): Record<string, unknown> => {
  const measurements: Record<string, unknown> = {}
  const boxes = kinds.includes('boxes') ? measureBoxes(root) : []
  const gaps = kinds.includes('gaps') ? measureGaps(root) : []
  const edges = kinds.includes('edges') ? measureEdges(root) : undefined
  const type = kinds.includes('type') ? measureType(root) : []

  if (kinds.includes('grid')) drawGrid(root)

  if (kinds.includes('boxes')) {
    drawBoxes(boxes)
    measurements['boxes'] = boxes
  }

  if (kinds.includes('gaps')) {
    drawGaps(gaps)
    measurements['gaps'] = gaps
  }

  if (edges !== undefined) {
    drawEdges(edges)
    measurements['edges'] = edges
  }

  if (kinds.includes('type')) {
    drawType(type)
    measurements['type'] = type
  }

  return measurements
}

export const clearOverlays = () => document.querySelector('[data-shot-overlay]')?.remove()
