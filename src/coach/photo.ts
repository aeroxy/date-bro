import { chatCompletion, type ImagePart } from '@/lib/llm-client'
import type { LLMConfig } from '@/types/settings'

/**
 * What the photo reader is told. It is a separate call to a separate model —
 * often not the one that writes the coach's answers, and not even one from the
 * same provider — so it gets its own short task instead of the coach's identity
 * and knowledge base. It has no use for them, and they would be paid for on
 * every photo.
 *
 * The description is the only form the picture ever takes in this app, so the
 * prompt is written around what happens to it: it is read later by a model that
 * cannot look at the image, and it is the user's evidence, cited by number like a
 * message. That is why it separates seeing from concluding. `KB_EVIDENCE` tells
 * the coach to keep observation and inference apart; a describer that has already
 * decided she looks "into you" has done the inference before the coach can weigh
 * it, in the one place the coach cannot check.
 *
 * Nothing about the person or the conversation goes in. It is not needed to read
 * a picture, and the reader may be a different provider from the one the user
 * trusts with the transcript.
 */
export const PHOTO_TASK = `You are reading one image for a dating coach who cannot see it. What you write is all the coach will ever have of this picture, so it has to carry what the coach would want to reason from - and nothing the coach would have to take on trust.

Begin with what kind of image it is - a selfie, a photo someone else took, a group shot, a screenshot of a dating profile or of a chat, a meme, a place, a message - then describe it.

A photo of a person or people: the setting and what is going on; how many people, and which of them is the subject; what they are doing, what they are wearing, and their expression and body language as it looks (smiling, looking off camera, mid-laugh); how it was taken (mirror selfie, candid, posed, professionally shot, cropped from a group); and anything in the frame that says something about their life - a pet, a drink, an instrument, a trophy, a landmark, a room.

A screenshot: transcribe the text exactly and in reading order, keeping names, times and emoji as written, and say where each piece sits - which side of the chat a bubble is on, which prompt on a profile an answer belongs to, what is a caption and what is a reply. A whole dating profile: the basics first (name, age, height, job, location, anything else listed), then every prompt with its answer word for word, then each photo in the order it appears, a sentence or two apiece.

A long screenshot may arrive as several images: consecutive slices of one picture, top to bottom, each repeating a few lines of the one before. Treat them as one picture. Read them in order, describe the repeated part once, and where something is cut by the edge of a slice, join it up.

What not to do:
- Say only what is visible. Where the image is unclear, cut off or too small to read, say so rather than filling it in. "Looks like" and "possibly" are the right words for anything you are not sure of.
- Do not name anyone unless the image itself does - a caption, a username, a name tag - and then quote it as written.
- Do not rate how anyone looks, and do not guess at their age, character, mood, intentions or feelings toward anyone. What an expression looks like is evidence; what it means is the coach's call.
- Do not advise, and do not comment on the conversation the image might belong to.

Write plain prose - no headings, no bullets, no markdown, no opening line announcing the description. Around 80 to 250 words for a photograph. A screenshot of text, or a whole profile, can run much longer because the transcription does, and there completeness matters more than brevity.`

/**
 * One picture in, one description out. Prose, not JSON — every other call in the
 * app wants an object, and this is the one whose answer is a paragraph that goes
 * straight into a text box for the user to read.
 *
 * `images` is one entry for nearly everything and several for a scrolled capture,
 * which `prepareImage` cuts into slices rather than shrink into illegibility. They
 * go in one request, in order, with a line saying so: the model has to be told
 * they are one picture, or it describes each slice as if it were its own and the
 * overlap twice.
 *
 * Throws on Qwen, via `chatCompletion`, rather than checking here: the refusal
 * belongs to the transport that can't carry the image, so no other route to it
 * can skip it.
 */
export async function describePhoto(
  config: LLMConfig,
  images: ImagePart[],
  signal?: AbortSignal,
): Promise<string> {
  const reply = await chatCompletion(
    config,
    [
      { role: 'system', content: PHOTO_TASK },
      { role: 'user', content: readingRequest(images.length), images },
    ],
    { prose: true, signal },
  )
  const description = reply.trim()
  if (!description) throw new Error('The model sent back an empty description.')
  return description
}

/** The user turn: what to do with the images it carries. */
export function readingRequest(count: number): string {
  return count > 1
    ? `These ${count} images are consecutive slices of one long screenshot, top to bottom. Describe it as one picture.`
    : 'Describe this image.'
}
