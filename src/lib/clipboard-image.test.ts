// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { imageFromClipboard } from './clipboard-image'

const png = (name = 'image.png') => new File(['x'], name, { type: 'image/png' })

/** A paste's clipboard as the page sees it: some files, and whatever text is on it. */
const clipboard = (files: File[], text = '') => ({
  files,
  getData: (type: string) => (type === 'text/plain' ? text : ''),
})

const URL_OF_IT = 'https://cdn.example.com/profile/photo-1.png'

describe('imageFromClipboard: the pastes that are for the picture', () => {
  test('a screenshot, which carries nothing but the picture', () => {
    const file = png()
    expect(imageFromClipboard(clipboard([file]))).toBe(file)
  })

  test('"Copy image" on a Mac — the picture and some markup, no text', () => {
    // The markup is in `text/html`, which this never reads: only plain text decides.
    expect(imageFromClipboard(clipboard([png()]))).not.toBeNull()
  })

  test('"Copy image" on Windows and Linux, which writes the URL as text beside the picture', () => {
    // The shape that was refused: the image attached nowhere, and the URL pasted
    // into the box in its place.
    expect(imageFromClipboard(clipboard([png()], URL_OF_IT))).not.toBeNull()
  })

  test('a URL with a trailing newline is still only a URL', () => {
    expect(imageFromClipboard(clipboard([png()], `${URL_OF_IT}\n`))).not.toBeNull()
  })

  test('a data: URL is one too', () => {
    expect(imageFromClipboard(clipboard([png()], 'data:image/png;base64,iVBORw0KGgo='))).not.toBeNull()
  })

  test('a file copied in a file manager, which may write its own name as text', () => {
    expect(imageFromClipboard(clipboard([png('IMG_0001.png')], 'IMG_0001.png'))).not.toBeNull()
    // Names have spaces in them; a screenshot's does.
    const shot = 'Screenshot 2026-10-01 at 10.04.31.png'
    expect(imageFromClipboard(clipboard([png(shot)], shot))).not.toBeNull()
  })

  test('takes the first image when several files came with it', () => {
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    const first = png('a.png')
    expect(imageFromClipboard(clipboard([pdf, first, png('b.png')]))).toBe(first)
  })
})

describe('imageFromClipboard: the pastes that are for the text', () => {
  test('a copied spreadsheet range, which brings a picture of itself along', () => {
    expect(imageFromClipboard(clipboard([png()], 'A1\tB1\nA2\tB2'))).toBeNull()
  })

  test('a rich-text selection', () => {
    expect(imageFromClipboard(clipboard([png()], 'hello there, how are you'))).toBeNull()
  })

  test('a single word is text, not a name — only the picture\'s own name, or a URL, is ignored', () => {
    expect(imageFromClipboard(clipboard([png('image.png')], 'hello'))).toBeNull()
  })

  test('a URL with words around it is a sentence', () => {
    expect(imageFromClipboard(clipboard([png()], `look at ${URL_OF_IT} lol`))).toBeNull()
    expect(imageFromClipboard(clipboard([png()], `${URL_OF_IT}\nsome caption`))).toBeNull()
  })

  test('text with no picture is not this at all', () => {
    expect(imageFromClipboard(clipboard([], 'just some words'))).toBeNull()
    expect(imageFromClipboard(clipboard([]))).toBeNull()
  })

  test('a file that is not an image is left to whoever wants it', () => {
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    expect(imageFromClipboard(clipboard([pdf]))).toBeNull()
  })
})
