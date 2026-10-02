import type { ImagePart } from './llm-client'

/**
 * The longest side any one image we send may have, in pixels. 2576 is what
 * Anthropic's current vision models read at full size; older ones downscale from
 * 1568 by themselves, and other providers do the same at sizes of their own, so
 * where a reader can't use the extra it costs bytes and nothing else.
 *
 * It was 1568, and that was too small for what people actually paste: a phone
 * screenshot lost more than a third of its size to it, and a scrolled capture of
 * a whole profile lost nearly all of it — see `planImage`.
 */
export const MAX_EDGE = 2576

/** Taller than this many times its width, and an image is a scrolled capture. */
const LONG_ASPECT = 3

/**
 * How much of the one before each slice repeats, in output pixels — a few lines
 * of a phone screenshot. A line of text or a row of details that lands on a cut is
 * whole in one of the two slices either side of it.
 */
export const OVERLAP = 160

/**
 * The most slices one image is cut into. A provider bills, and a local model's
 * context runs out, by the pixels sent, so past this the whole image is scaled
 * down rather than cut further — at 1170px wide that is not until it passes
 * about 19,500px tall.
 */
export const MAX_TILES = 8

const QUALITY = 0.85

/** Scaled down to fit `max` on the longest side, never up. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export interface ImagePlan {
  /** The picture as it will be sent, scaled. */
  width: number
  height: number
  /** Top to bottom, in that scaled picture's pixels. One entry unless it is cut. */
  tiles: { y: number; height: number }[]
}

/**
 * How one picture becomes the images that carry it.
 *
 * Most are one image, shrunk to `MAX_EDGE` on the longest side. A **scrolled
 * capture** — more than three times as tall as it is wide — is cut instead: kept
 * at its own width (down to the limit) and sliced top to bottom, `OVERLAP` apart.
 * Shrinking is the wrong answer for those, and no provider will do better than
 * we can: a 1170×10,000 capture of a whole profile fit into one image is a strip
 * a few hundred pixels wide, and whatever the model reads it with, it will read
 * that. Sliced, every line is as large as it was on the phone.
 *
 * Aspect ratio, not size, decides which. A 48-megapixel photo needs shrinking by
 * far more than any screenshot and must never be cut — a face in two images is two
 * descriptions of half a face — and no photo, and no single phone screen, is
 * anywhere near three times taller than it is wide.
 *
 * The slices are equal height and the last ends exactly on the bottom, rather than
 * full-size slices and a sliver left over, and every neighbouring pair overlaps by
 * at least `OVERLAP`.
 */
export function planImage(width: number, height: number): ImagePlan {
  const single = (w: number, h: number): ImagePlan => ({
    width: w,
    height: h,
    tiles: [{ y: 0, height: h }],
  })

  if (height <= LONG_ASPECT * width) {
    const fit = fitWithin(width, height)
    return single(fit.width, fit.height)
  }

  // The most height MAX_TILES slices can carry between them, overlaps counted once.
  const capacity = MAX_TILES * MAX_EDGE - (MAX_TILES - 1) * OVERLAP
  const scale = Math.min(1, MAX_EDGE / width, capacity / height)
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  if (h <= MAX_EDGE) return single(w, h)

  const count = Math.ceil((h - OVERLAP) / (MAX_EDGE - OVERLAP))
  const tile = Math.ceil((h + (count - 1) * OVERLAP) / count)
  const step = (h - tile) / (count - 1)
  return {
    width: w,
    height: h,
    tiles: Array.from({ length: count }, (_, i) => ({ y: Math.round(i * step), height: tile })),
  }
}

/**
 * A picture the user gave us, made safe to send: sized by `planImage`, and always
 * JPEG. One image for nearly everything, several for a scrolled capture, in the
 * order they read.
 *
 * Re-encoding even when it is already small is the point rather than a cost. A
 * pasted screenshot is a PNG, a phone photo may be a WebP or a HEIC, and what a
 * provider accepts differs — one output format is one thing that can't be
 * rejected, and files of a few hundred KB stay under every request-size limit
 * between here and the model. Whatever Chrome can decode, this can send.
 *
 * Drawn on white first: a transparent PNG would otherwise come out of JPEG
 * encoding black, and a describer told the picture is black has been told
 * something false.
 *
 * `from-image` is asked for by name. A phone stores a portrait shot sideways with
 * a flag saying so, and a decode that ignores the flag hands the model a picture
 * on its side to describe.
 */
export async function prepareImage(source: Blob): Promise<ImagePart[]> {
  // Refused up front only when the blob *says* it is something else. A file with no
  // type at all — no extension, or one the OS has no name for — goes to the decoder,
  // which reads the bytes and not the name: an extensionless screenshot opens fine,
  // and calling it "not an image" from a missing label would turn away pictures
  // Chrome can read. (If it really isn't one, the decoder says so.)
  if (source.type && !source.type.startsWith('image/')) throw new Error('That file is not an image.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(
      "Couldn't open that image. Chrome can't read every format — a HEIC photo from an iPhone needs exporting as JPEG or PNG first — and a very tall screenshot can be too large to decode.",
    )
  }

  try {
    const plan = planImage(bitmap.width, bitmap.height)
    // From the tile back to the original's own pixels. Both ends of that mapping are
    // exact, so the last slice reads to the true bottom edge, not a rounded one.
    const rise = bitmap.height / plan.height
    return await Promise.all(
      plan.tiles.map(async (tile) => {
        const canvas = new OffscreenCanvas(plan.width, tile.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error("Couldn't prepare that image for sending.")
        context.fillStyle = '#fff'
        context.fillRect(0, 0, plan.width, tile.height)
        context.drawImage(
          bitmap,
          0,
          tile.y * rise,
          bitmap.width,
          tile.height * rise,
          0,
          0,
          plan.width,
          tile.height,
        )
        const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
        return { mediaType: 'image/jpeg', data: await base64Of(jpeg) }
      }),
    )
  } finally {
    bitmap.close()
  }
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read that image."))
    reader.readAsDataURL(blob)
  })
}
