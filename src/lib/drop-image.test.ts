// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import { downloadImage, imageFromDrop, mightBeAPicture } from './drop-image'

const png = (name = 'image.png') => new File(['x'], name, { type: 'image/png' })

/** A drop as the page sees it: some files, and whatever strings came with them. */
const drop = (files: File[], strings: Record<string, string> = {}) => ({
  files,
  getData: (type: string) => strings[type] ?? '',
})

const PHOTO = 'https://cdn.example.com/p/photo-1.jpg?w=1080&sig=abc'
const PROFILE = 'https://example.com/u/someone'

describe('mightBeAPicture: what a drag is allowed to land as, before it does', () => {
  test('files, and addresses', () => {
    expect(mightBeAPicture(['Files'])).toBe(true)
    expect(mightBeAPicture(['text/uri-list', 'text/html'])).toBe(true)
  })

  test('a text selection is not', () => {
    // So dragging words between boxes is left to the boxes.
    expect(mightBeAPicture(['text/plain', 'text/html'])).toBe(false)
    expect(mightBeAPicture([])).toBe(false)
  })
})

describe('imageFromDrop: files', () => {
  test('a photo from Finder or the desktop', () => {
    const file = png()
    expect(imageFromDrop(drop([file]))).toBe(file)
  })

  test('the first image among several files', () => {
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    const first = png('a.png')
    expect(imageFromDrop(drop([pdf, first, png('b.png')]))).toBe(first)
  })

  test('a file with no type is taken, for the decoder to try', () => {
    const bare = new File(['x'], 'Screenshot')
    expect(imageFromDrop(drop([bare]))).toBe(bare)
  })

  test('a file that is not an image is taken too, so the strip can say so', () => {
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    expect(imageFromDrop(drop([pdf]))).toBe(pdf)
  })

  test('a file wins over the address that came with it', () => {
    // Chrome on Windows and Linux carries the image itself beside its URL.
    const file = png()
    expect(imageFromDrop(drop([file], { 'text/uri-list': PHOTO, 'text/html': `<img src="${PHOTO}">` }))).toBe(file)
  })
})

describe('imageFromDrop: an image dragged out of another tab', () => {
  test("the image's src, with the markup's escaping undone", () => {
    const html = `<img src="${PHOTO.replace(/&/g, '&amp;')}" alt="Their photo">`
    expect(imageFromDrop(drop([], { 'text/uri-list': PHOTO, 'text/html': html }))?.toString()).toBe(PHOTO)
  })

  test('an image inside a link is the image, not the link', () => {
    const html = `<meta charset='utf-8'><img alt="x" class="pic" src="${PHOTO.replace(/&/g, '&amp;')}">`
    expect(imageFromDrop(drop([], { 'text/uri-list': PROFILE, 'text/html': html }))?.toString()).toBe(PHOTO)
  })

  test('single quotes, and attributes that only end in src', () => {
    const html = `<img data-src="https://wrong.example/x.png" srcset="https://wrong.example/y.png 2x" src='${PHOTO}'>`
    expect(imageFromDrop(drop([], { 'text/html': html }))?.toString()).toBe(PHOTO)
  })

  test('a data: image', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    expect(imageFromDrop(drop([], { 'text/html': `<img src="${src}">` }))?.toString()).toBe(src)
  })
})

describe('imageFromDrop: what is left alone', () => {
  test('a plain link, which a text box types as its address', () => {
    const html = `<a href="${PROFILE}">their profile</a>`
    expect(imageFromDrop(drop([], { 'text/uri-list': PROFILE, 'text/plain': PROFILE, 'text/html': html }))).toBeNull()
  })

  test('an address with no markup', () => {
    expect(imageFromDrop(drop([], { 'text/uri-list': PHOTO }))).toBeNull()
  })

  test('an src that is not an address', () => {
    expect(imageFromDrop(drop([], { 'text/html': '<img src="photo.jpg">' }))).toBeNull()
  })

  test('nothing at all', () => {
    expect(imageFromDrop(drop([]))).toBeNull()
  })
})

describe('downloadImage', () => {
  test('a data: address comes back as the picture', async () => {
    const blob = await downloadImage(new URL('data:image/png;base64,iVBORw0KGgo='))
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(8)
  })

  test("another page's blob: address fails with what to do instead", async () => {
    await expect(downloadImage(new URL('blob:https://example.com/0f6c'))).rejects.toThrow('Copy Image')
  })
})
