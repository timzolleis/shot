import { Context, Effect, Layer, Ref, Semaphore, Scope } from 'effect'
import type { Page } from 'playwright'

import { LoupeTooLargeError } from '../capture/domain/capture-error.ts'
import { Browser } from './browser.ts'

/** Ways of showing PNGs, drawn in a browser canvas: sheets of labelled cells, and the loupe. */

export interface SheetCell {
  readonly png: Uint8Array
  readonly label: string
}

/** A grid cell: a still drawn at its CSS size (`scale` device pixels per CSS pixel), or a note in its place. */
export type GridCell = { readonly png: Uint8Array; readonly scale: number } | { readonly note: 'failed' | 'not shot' }

/** A grid heading over `span` columns; a mode heading gets a sun or moon. */
export interface GridHeading {
  readonly title: string
  readonly mode: 'light' | 'dark' | undefined
  readonly span: number
}

export class Sheets extends Context.Service<
  Sheets,
  {
    /** Cells in a grid, as many per row as fit in 2000px (or `columns`), each labelled above. */
    composeSheet(input: {
      readonly cells: ReadonlyArray<SheetCell>
      readonly title: string
      readonly columns?: number
    }): Effect.Effect<Uint8Array>
    /**
     * Stills under group and column headings, a label per row (none when `''`), each at its CSS size; scaled down to
     * fit 2000px wide (E20).
     */
    composeGrid(input: {
      readonly groups: ReadonlyArray<GridHeading>
      readonly columns: ReadonlyArray<GridHeading>
      readonly rows: ReadonlyArray<{ readonly label: string; readonly cells: ReadonlyArray<GridCell> }>
    }): Effect.Effect<Uint8Array>
    /** The PNG at `factor`×, nearest-neighbour; from 4× a line per source pixel. */
    loupe(input: { readonly png: Uint8Array; readonly factor: number }): Effect.Effect<Uint8Array, LoupeTooLargeError>
  }
>()('shot/Sheets') {}

const maxSheetWidth = 2000

/** CSS pixels: about the width GitHub shows a PR body image at; drawn at 2× it is 2000px. */
const maxGridWidth = 1000
const maxLoupeSize = 2400

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

/** Lucide's sun and moon. */
const modeIcons = {
  light:
    '<svg class="icon light" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  dark: '<svg class="icon dark" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
}

/** A neutral backdrop that sets off light and dark stills alike; stills as rounded cards. */
const gridCss = `
body { margin: 0; background: #fff }
#sheet {
  display: inline-block; padding: 28px 32px 32px; background: #f1f3f6;
  font: 600 13px/18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: #334155; -webkit-font-smoothing: antialiased;
}
#grid { display: grid; column-gap: 24px; row-gap: 16px; align-items: start }
.group { display: flex; align-items: center; gap: 12px; color: #0f172a; font-size: 14px }
.group::before, .group::after { content: ''; flex: 1; height: 1px; background: #cbd5e1 }
.column { display: flex; align-items: center; gap: 6px; padding-left: 2px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase }
.row {
  align-self: center; writing-mode: vertical-rl; transform: rotate(180deg);
  font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
}
.icon { width: 15px; height: 15px; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round }
.icon.light { stroke: #d97706 }
.icon.dark { stroke: #4f46e5 }
.still {
  display: block; border-radius: 8px;
  box-shadow: 0 0 0 1px rgb(15 23 42 / 0.08), 0 1px 2px rgb(15 23 42 / 0.06), 0 12px 28px -12px rgb(15 23 42 / 0.28);
}
.note {
  align-self: stretch; display: flex; align-items: center; justify-content: center; min-width: 200px; min-height: 140px;
  border: 1.5px dashed #cbd5e1; border-radius: 8px; color: #64748b; font-weight: 500;
}
.note.failed { border-color: #fca5a5; background: #fef2f2; color: #b91c1c }
`

export const SheetsLayer = Layer.effect(
  Sheets,
  Effect.gen(function* () {
    const browser = yield* Browser
    const scope = yield* Scope.Scope
    const pagesRef = yield* Ref.make(new Map<number, Page>())
    // One page per device scale draws every sheet: concurrent captures take turns.
    const drawing = yield* Semaphore.make(1)

    const sheetPage = (deviceScaleFactor: number) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(pagesRef)).get(deviceScaleFactor)

        if (existing !== undefined) return existing
        const context = yield* browser.newContext({ deviceScaleFactor }).pipe(Scope.provide(scope))
        const page = yield* Effect.promise(() => context.newPage())
        yield* Ref.update(pagesRef, (pages) => new Map(pages).set(deviceScaleFactor, page))

        return page
      })

    /** At 1× a sheet pixel is a CSS pixel (loupe, frames); grids draw at 2×, to stay sharp when GitHub halves them. */
    const withPage = <A, E>(use: (page: Page) => Effect.Effect<A, E>, deviceScaleFactor = 1) =>
      Semaphore.withPermit(drawing, Effect.flatMap(sheetPage(deviceScaleFactor), use))

    return Sheets.of({
      composeSheet: ({ cells, title, columns }) =>
        withPage((page) =>
          Effect.promise(async () => {
            await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font:12px/16px ui-monospace,Menlo,monospace;color:#111">
<div id="sheet" style="display:inline-flex;flex-direction:column;gap:8px;padding:12px">
<div style="font-weight:600">${escapeHtml(title)}</div>
<div id="grid" style="display:grid;gap:12px;align-items:start"></div></div></body></html>`)
            await page.evaluate(
              async ({ cells, columns, maxWidth }) => {
                const grid = document.querySelector<HTMLElement>('#grid')!

                const images = await Promise.all(
                  cells.map(
                    (cell) =>
                      new Promise<HTMLImageElement>((resolve) => {
                        const image = new Image()
                        image.onload = () => resolve(image)
                        image.src = cell.src
                      }),
                  ),
                )

                const widest = Math.max(...images.map((image) => image.naturalWidth))
                const perRow = columns ?? Math.max(1, Math.min(cells.length, Math.floor(maxWidth / (widest + 12))))
                grid.style.gridTemplateColumns = `repeat(${perRow}, max-content)`
                cells.forEach((cell, index) => {
                  const figure = document.createElement('div')
                  figure.style.cssText = 'display:flex;flex-direction:column;gap:4px'
                  const caption = document.createElement('div')
                  caption.textContent = cell.label
                  const image = images[index]!
                  image.style.cssText = `width:${image.naturalWidth}px;height:${image.naturalHeight}px;outline:1px solid #ddd;image-rendering:pixelated`
                  figure.append(caption, image)
                  grid.append(figure)
                })
              },
              {
                cells: cells.map((cell) => ({ src: dataUrl(cell.png), label: cell.label })),
                columns,
                maxWidth: maxSheetWidth,
              },
            )

            return new Uint8Array(await page.locator('#sheet').screenshot())
          }),
        ),
      composeGrid: ({ groups, columns, rows }) =>
        withPage(
          (page) =>
            Effect.promise(async () => {
              await page.setContent(`<!doctype html><html><head><style>${gridCss}</style></head>
<body><div id="sheet"><div id="grid"></div></div></body></html>`)
              await page.evaluate(
                async ({ groups, columns, rows, icons, maxWidth }) => {
                  const grid = document.querySelector<HTMLElement>('#grid')!
                  const labelled = rows.some((row) => row.label !== '')
                  grid.style.gridTemplateColumns = `${labelled ? 'auto ' : ''}repeat(${columns.length}, max-content)`

                  const element = (className: string, content = '') => {
                    const node = document.createElement('div')
                    node.className = className
                    node.textContent = content

                    return node
                  }

                  const headingRow = (headings: typeof columns, className: string) => {
                    if (labelled) grid.append(element('corner'))

                    for (const { title, mode, span } of headings) {
                      const node = element(className)
                      node.style.gridColumn = `span ${span}`
                      const text = element('text', title)

                      if (mode !== undefined) node.innerHTML = icons[mode]
                      node.append(text)
                      grid.append(node)
                    }
                  }

                  if (groups.length > 0) headingRow(groups, 'group')
                  headingRow(columns, 'column')

                  for (const row of rows) {
                    if (labelled) grid.append(element('row', row.label))

                    for (const cell of row.cells) {
                      if (cell.src === '') {
                        grid.append(element(`note ${cell.note === 'failed' ? 'failed' : ''}`, cell.note))
                        continue
                      }

                      const image = new Image()
                      await new Promise((resolve) => {
                        image.onload = resolve
                        image.src = cell.src
                      })
                      image.className = 'still'
                      image.dataset['width'] = String(image.naturalWidth / cell.scale)
                      image.dataset['height'] = String(image.naturalHeight / cell.scale)
                      grid.append(image)
                    }
                  }

                  // Stills shrink to fit the width, headings keep their size.
                  const stills = [...grid.querySelectorAll<HTMLImageElement>('.still')]
                  const sheet = document.querySelector<HTMLElement>('#sheet')!

                  const fit = (factor: number) => {
                    for (const still of stills) {
                      still.style.width = `${Number(still.dataset['width']) * factor}px`
                      still.style.height = `${Number(still.dataset['height']) * factor}px`
                    }

                    return sheet.getBoundingClientRect().width
                  }

                  // Headings can outgrow small stills, so the width is not linear in the factor: bisect for the largest fit.
                  if (fit(1) > maxWidth) {
                    let low = 0
                    let high = 1

                    for (let step = 0; step < 12; step++) {
                      const middle = (low + high) / 2

                      if (fit(middle) > maxWidth) high = middle
                      else low = middle
                    }

                    fit(low)
                  }
                },
                {
                  groups: [...groups],
                  columns: [...columns],
                  rows: rows.map((row) => ({
                    label: row.label,
                    cells: row.cells.map((cell) =>
                      'png' in cell
                        ? { src: dataUrl(cell.png), scale: cell.scale, note: '' }
                        : { src: '', scale: 1, note: cell.note },
                    ),
                  })),
                  icons: modeIcons,
                  maxWidth: maxGridWidth,
                },
              )

              return new Uint8Array(await page.locator('#sheet').screenshot())
            }),
          2,
        ),
      loupe: ({ png, factor }) =>
        withPage((page) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              page.setContent(
                '<!doctype html><html><body style="margin:0;background:#fff"><canvas id="loupe"></canvas></body></html>',
              ),
            )

            const size = yield* Effect.promise(() =>
              page.evaluate(
                async ({ src, factor }) => {
                  const image = new Image()
                  await new Promise((resolve) => {
                    image.onload = resolve
                    image.src = src
                  })

                  return { width: image.naturalWidth * factor, height: image.naturalHeight * factor }
                },
                { src: dataUrl(png), factor },
              ),
            )

            if (size.width > maxLoupeSize || size.height > maxLoupeSize) {
              return yield* new LoupeTooLargeError({ factor, width: size.width, height: size.height })
            }

            return yield* Effect.promise(async () => {
              await page.evaluate(
                async ({ src, factor }) => {
                  const image = new Image()
                  await new Promise((resolve) => {
                    image.onload = resolve
                    image.src = src
                  })
                  const canvas = document.querySelector<HTMLCanvasElement>('#loupe')!
                  canvas.width = image.naturalWidth * factor
                  canvas.height = image.naturalHeight * factor
                  const context = canvas.getContext('2d')!
                  context.imageSmoothingEnabled = false
                  context.drawImage(image, 0, 0, canvas.width, canvas.height)

                  if (factor >= 4) {
                    context.fillStyle = 'rgba(127,127,127,0.35)'

                    for (let x = factor; x < canvas.width; x += factor) context.fillRect(x, 0, 1, canvas.height)

                    for (let y = factor; y < canvas.height; y += factor) context.fillRect(0, y, canvas.width, 1)
                  }
                },
                { src: dataUrl(png), factor },
              )

              return new Uint8Array(await page.locator('#loupe').screenshot())
            })
          }),
        ),
    })
  }),
)
