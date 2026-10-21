import { PNG } from 'pngjs'

import type { Rect } from '../capture/domain/capture.ts'

/** `rect` of a decoded PNG, in image pixels. */
export const cropPng = ({ png, rect }: { readonly png: Uint8Array; readonly rect: Rect }): Uint8Array => {
  const image = PNG.sync.read(Buffer.from(png))
  const out = new PNG({ width: rect.width, height: rect.height })

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const source = ((rect.y + y) * image.width + rect.x + x) * 4
      const target = (y * out.width + x) * 4
      out.data[target] = image.data[source]!
      out.data[target + 1] = image.data[source + 1]!
      out.data[target + 2] = image.data[source + 2]!
      out.data[target + 3] = image.data[source + 3]!
    }
  }

  return new Uint8Array(PNG.sync.write(out))
}

/** `rect` grown by `padding` on every side, clamped to `bounds`, on whole pixels. */
export const paddedRect = ({
  rect,
  bounds,
  padding = 16,
}: {
  readonly rect: Rect
  readonly bounds: { readonly width: number; readonly height: number }
  readonly padding?: number
}): Rect => {
  const x = Math.max(0, Math.floor(rect.x - padding))
  const y = Math.max(0, Math.floor(rect.y - padding))

  return {
    x,
    y,
    width: Math.min(bounds.width, Math.ceil(rect.x + rect.width + padding)) - x,
    height: Math.min(bounds.height, Math.ceil(rect.y + rect.height + padding)) - y,
  }
}

export const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)

  return { width: view.getUint32(16), height: view.getUint32(20) }
}
