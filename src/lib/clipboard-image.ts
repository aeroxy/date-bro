/** The part of a paste's `clipboardData` that this reads — so a test can hand it a plain object. */
export interface ClipboardLike {
  files: ArrayLike<File>
  getData: (type: string) => string
}

/** One word, starting with a scheme: a URL, and nothing around it. */
const LOOKS_LIKE_A_URL = /^(?:https?|data|blob|file):\S+$/i

/**
 * The picture a paste is carrying, if the paste is *for* the picture — otherwise
 * `null` and the paste goes through as text.
 *
 * Two opposite mistakes are both easy, and the clipboard doesn't say which it is.
 * A copied spreadsheet range, or a rich-text selection, brings a rendering of
 * itself along as an image next to the text, and taking that swallows what the
 * user was pasting. But *not* taking an image whenever there is also text fails
 * the other way on the commonest paste there is: Chrome's "Copy image" on Windows
 * and Linux writes the image's URL as plain text beside the picture, and copying a
 * file in a file manager writes its name. Refusing those leaves the user with a URL
 * in the box and no photo — the most ordinary way to paste a photo, broken.
 *
 * So text that only *names* the picture — its URL, or the file's own name — is not
 * text the user meant, and the picture is taken; any other text means the text was.
 * A screenshot, and "Copy image" on a Mac, carry no text at all.
 */
export function imageFromClipboard(data: ClipboardLike): File | null {
  const file = Array.from(data.files).find((f) => f.type.startsWith('image/'))
  if (!file) return null
  const text = data.getData('text/plain').trim()
  if (text && text !== file.name && !LOOKS_LIKE_A_URL.test(text)) return null
  return file
}
