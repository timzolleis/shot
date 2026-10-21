import type { Note, Point, Mark } from './domain/review.ts'

/**
 * Notes as drawn: numbering, bounds and SVG. Shared by the review page (in the browser, no Effect) and the burned PNGs
 * (F32), so the user and the agent see the same marks with the same numbers.
 */

export interface Bounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface NumberedNote {
  readonly note: Note
  readonly number: number
}

/** 1-based, in page order of sheets, then in the order drawn. */
export const numberedNotes = ({
  notes,
  sheets,
}: {
  readonly notes: ReadonlyArray<Note>
  readonly sheets: ReadonlyArray<string>
}): ReadonlyArray<NumberedNote> =>
  sheets
    .flatMap((sheet) => notes.filter((note) => note.sheet === sheet))
    .map((note, index) => ({ note, number: index + 1 }))

const boundsOfPoints = (points: ReadonlyArray<Point>): Bounds => {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)

  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export const markBounds = (mark: Mark): Bounds => {
  switch (mark._tag) {
    case 'Pin':
      return { x: mark.x, y: mark.y, width: 0, height: 0 }
    case 'Box':
      return { x: mark.x, y: mark.y, width: mark.width, height: mark.height }
    case 'Arrow':
      return boundsOfPoints([mark.from, mark.to])
    case 'Pen':
      return boundsOfPoints(mark.points.length === 0 ? [{ x: 0, y: 0 }] : mark.points)
  }
}

/** Where a mark's number sits: the pin itself, a box's corner, an arrow's tail, a stroke's start. */
const markAnchor = (mark: Mark): Point => {
  switch (mark._tag) {
    case 'Pin':
      return { x: mark.x, y: mark.y }
    case 'Box':
      return { x: mark.x, y: mark.y }
    case 'Arrow':
      return mark.from
    case 'Pen':
      return mark.points[0] ?? { x: 0, y: 0 }
  }
}

const markColor = '#e5254b'
const fadedColor = '#7a7f87'
const pinRadius = 11
const badgeRadius = 9

const fixed = (value: number) => Math.round(value * 10) / 10

const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

const numberText = ({ at, number, size }: { at: Point; number: number; size: number }) =>
  `<text x="${fixed(at.x)}" y="${fixed(at.y)}" fill="#fff" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${size}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeText(String(number))}</text>`

/**
 * A comment pin: a bubble whose sharp corner sits on the point, so it never covers what it points at. Near the top
 * edge it hangs below the point, so a burned still keeps all of it.
 */
const pinBubble = ({
  at,
  number,
  radius,
  color,
}: {
  at: Point
  number: number | undefined
  radius: number
  color: string
}) => {
  const { x, y } = at
  const down = y < 2 * radius + 2 ? 1 : -1
  const sweep = down === 1 ? 0 : 1
  const arc = (toX: number, toY: number) => `A${radius} ${radius} 0 0 ${sweep} ${fixed(toX)} ${fixed(toY)}`

  const path = [
    `M${fixed(x)} ${fixed(y)}`,
    `V${fixed(y + down * radius)}`,
    arc(x + radius, y + down * 2 * radius),
    arc(x + 2 * radius, y + down * radius),
    arc(x + radius, y),
    'Z',
  ].join('')

  const label =
    number === undefined ? '' : numberText({ at: { x: x + radius, y: y + down * radius }, number, size: radius + 1 })

  return `<path d="${path}" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>${label}`
}

const badge = ({ at, number, radius, color }: { at: Point; number: number; radius: number; color: string }) =>
  `<circle cx="${fixed(at.x)}" cy="${fixed(at.y)}" r="${radius}" fill="${color}" stroke="#fff" stroke-width="2"/>` +
  numberText({ at, number, size: radius + 1 })

const arrowHead = ({ from, to }: { from: Point; to: Point }) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const length = 14
  const spread = Math.PI / 7
  const left = { x: to.x - length * Math.cos(angle - spread), y: to.y - length * Math.sin(angle - spread) }
  const right = { x: to.x - length * Math.cos(angle + spread), y: to.y - length * Math.sin(angle + spread) }

  return [to, left, right].map((point) => `${fixed(point.x)},${fixed(point.y)}`).join(' ')
}

const strokeAttributes = (color: string, width: number) =>
  `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`

/** One mark's marks, white-haloed so they read on any background. */
const markSvg = ({ mark, color, width }: { mark: Mark; color: string; width: number }): string => {
  switch (mark._tag) {
    case 'Pin':
      return ''
    case 'Box':
      return (
        `<rect x="${fixed(mark.x)}" y="${fixed(mark.y)}" width="${fixed(mark.width)}" height="${fixed(mark.height)}" rx="2" fill="none" ${strokeAttributes('#fff', width + 3)} opacity="0.8"/>` +
        `<rect x="${fixed(mark.x)}" y="${fixed(mark.y)}" width="${fixed(mark.width)}" height="${fixed(mark.height)}" rx="2" fill="${color}" fill-opacity="0.08" ${strokeAttributes(color, width)}/>`
      )
    case 'Arrow': {
      const line = `x1="${fixed(mark.from.x)}" y1="${fixed(mark.from.y)}" x2="${fixed(mark.to.x)}" y2="${fixed(mark.to.y)}"`
      const head = arrowHead(mark)

      return (
        `<line ${line} ${strokeAttributes('#fff', width + 3)} opacity="0.8"/><polygon points="${head}" fill="#fff" ${strokeAttributes('#fff', 3)} opacity="0.8"/>` +
        `<line ${line} ${strokeAttributes(color, width)}/><polygon points="${head}" fill="${color}" ${strokeAttributes(color, 1)}/>`
      )
    }

    case 'Pen': {
      const points = mark.points.map((point) => `${fixed(point.x)},${fixed(point.y)}`).join(' ')

      return (
        `<polyline points="${points}" fill="none" ${strokeAttributes('#fff', width + 3)} opacity="0.8"/>` +
        `<polyline points="${points}" fill="none" ${strokeAttributes(color, width)}/>`
      )
    }
  }
}

export interface DrawnMark {
  readonly mark: Mark
  /** None for a faded mark from the last round. */
  readonly number?: number
  readonly faded?: boolean
  readonly selected?: boolean
  readonly id?: string
}

/** The marks of every mark, as SVG elements in still coordinates; the caller supplies the `<svg>`. */
export const marksSvg = (marks: ReadonlyArray<DrawnMark>): string =>
  marks
    .map(({ mark, number, faded, selected, id }) => {
      const color = faded === true ? fadedColor : markColor
      const width = selected === true ? 4 : 2.5
      const marks = markSvg({ mark, color, width })
      const grown = selected === true ? 2 : 0

      const label =
        mark._tag === 'Pin'
          ? pinBubble({
              at: mark,
              radius: (number === undefined ? 7 : pinRadius) + grown,
              color,
              number,
            })
          : number === undefined
            ? ''
            : badge({ at: markAnchor(mark), number, radius: badgeRadius + grown, color })

      const attributes = [
        id === undefined ? '' : ` data-note="${escapeText(id)}"`,
        faded === true ? ' opacity="0.45" pointer-events="none"' : '',
      ].join('')

      return `<g${attributes}>${marks}${label}</g>`
    })
    .join('')
