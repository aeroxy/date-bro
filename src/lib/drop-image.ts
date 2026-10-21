/** The part of a drop's `dataTransfer` that this reads — so a test can hand it a plain object. */
export interface DropLike {
  files: ArrayLike<File>
  getData: (type: string) => string
}

/**
 * Whether a drag might be bringing a picture, from its types alone — all a page is
 * shown until the drop lands. Files, from Finder, the desktop or a screenshot's
 * thumbnail; or an address, which is how Chrome hands over an image dragged out of
 * another tab. A link is an address too, so this is "might": the drop decides.
 */
export function mightBeAPicture(types: ReadonlyArray<string>): boolean {
  return types.includes('Files') || types.includes('text/uri-list')
}

/** The first `<img>`'s `src`, in the markup Chrome writes for an image dragged out of a page. */
const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/**
 * The picture a drop is carrying: a file, or the address of one to download — or
 * `null`, and the drop is left to whatever else wants it.
 *
 * **Files first, and any file.** The first image among them, else the first file
 * whatever it is, as the picker takes any file: a screenshot with no extension has
 * no type and opens fine, and a file that isn't a picture is better told so by
 * the decoder than dropped without a word.
 *
 * **An image from another tab is its `<img>`, not its link.** Chrome writes an
 * image drag as a URL and the image's own markup, and the URL is the *link* the
 * image sits in when there is one — a profile photo that opens the profile. The
 * markup's `src` is the picture. A plain link has no `<img>` in its markup, so it
 * is not taken, and dropped into a text box it types its address as it always has.
 */
export function imageFromDrop(data: DropLike): File | URL | null {
  const files = Array.from(data.files)
  const file = files.find((f) => f.type.startsWith('image/')) ?? files[0]
  if (file) return file
  const match = IMG_SRC.exec(data.getData('text/html'))
  if (!match) return null
  // Markup escapes the `&` between query parameters.
  const src = (match[1] ?? match[2] ?? '').replace(/&amp;/g, '&')
  return URL.canParse(src) ? new URL(src) : null
}

/** What to do instead, for every way a download can fail. */
const COPY_INSTEAD =
  "Couldn't download that picture from the page it came from. Right-click it there, choose Copy Image, and paste it here instead."

/**
 * The picture at an address, for an image dragged out of another tab. Fetched from
 * the extension's own page, which the host permission lets read any site, and with
 * the user's cookies as `read_page` is, so a photo behind their login comes too.
 * A `blob:` address belongs to the page that made it and can't be fetched from
 * here; copying the image still works, which is why the error says to.
 *
 * Stops when `signal` does, so a photo discarded mid-download leaves nothing
 * running — and that abort comes through as itself, since a download stopped on
 * purpose is not one that failed.
 */
export async function downloadImage(url: URL, signal?: AbortSignal): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'include', signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(COPY_INSTEAD)
  }
  if (!response.ok) throw new Error(`${COPY_INSTEAD} (${url.host} answered ${response.status}.)`)
  return response.blob()
}
