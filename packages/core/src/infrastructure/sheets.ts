import { Context, Effect, Layer, Option, Ref, Semaphore, Scope } from 'effect'
import type { Page } from 'playwright'

import { LoupeTooLargeError } from '../capture/domain/capture-error.ts'
import { Browser } from './browser.ts'

/** Ways of showing PNGs, drawn in a browser canvas: sheets of labelled cells, and the loupe. */

export interface SheetCell {
  readonly png: Uint8Array
  readonly label: string
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
    /** The PNG at `factor`×, nearest-neighbour; from 4× a line per source pixel. */
    loupe(input: { readonly png: Uint8Array; readonly factor: number }): Effect.Effect<Uint8Array, LoupeTooLargeError>
  }
>()('shot/Sheets') {}

const maxSheetWidth = 2000
const maxLoupeSize = 2400

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

export const SheetsLayer = Layer.effect(
  Sheets,
  Effect.gen(function* () {
    const browser = yield* Browser
    const scope = yield* Scope.Scope
    const pageRef = yield* Ref.make(Option.none<Page>())
    // One page draws every sheet: concurrent captures take turns.
    const drawing = yield* Semaphore.make(1)

    const sheetPage = Effect.gen(function* () {
      const existing = yield* Ref.get(pageRef)

      if (Option.isSome(existing)) return existing.value
      const context = yield* browser.newContext({ deviceScaleFactor: 1 }).pipe(Scope.provide(scope))
      const page = yield* Effect.promise(() => context.newPage())
      yield* Ref.set(pageRef, Option.some(page))

      return page
    })

    const withPage = <A, E>(use: (page: Page) => Effect.Effect<A, E>) =>
      Semaphore.withPermit(drawing, Effect.flatMap(sheetPage, use))

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
              { cells: cells.map((cell) => ({ src: dataUrl(cell.png), label: cell.label })), columns, maxWidth: maxSheetWidth },
            )

            return new Uint8Array(await page.locator('#sheet').screenshot())
          }),
        ),
      loupe: ({ png, factor }) =>
        withPage((page) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><canvas id="loupe"></canvas></body></html>'),
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
