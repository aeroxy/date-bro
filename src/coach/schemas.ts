import type { JsonSchemaSpec } from '@/lib/llm-client'
import { validateProfileUpdate } from './profile'

/**
 * Each engine has two descriptions of its output:
 *   `SHAPE`  — a TypeScript-ish sketch pasted into the prompt. Models follow
 *              this far more reliably than a raw JSON Schema, and it's the only
 *              thing the Qwen backend ever sees.
 *   `SCHEMA` — the strict JSON Schema, used only when the user's provider
 *              supports response_format.json_schema.
 * `validate` is the backstop for everything else: coarse structural checks, so
 * a malformed response gets one specific complaint and a retry.
 */

const confidence = { type: 'string', enum: ['high', 'medium', 'low'] } as const
const stringArray = { type: 'array', items: { type: 'string' } } as const

// --- The profile update, shared by both rebuild engines -----------------------

/**
 * Flat rather than a three-way union, because strict `json_schema` expresses an
 * `anyOf` of object shapes badly — see the note on `ProfileUpdate` in
 * `profile.ts`. Unused halves come back empty (`[]` / `""`) and
 * `validateProfileUpdate` enforces that exactly one is filled.
 */
const profileUpdate = {
  type: 'object',
  additionalProperties: false,
  required: ['changed', 'sections', 'rewrite'],
  properties: {
    changed: { type: 'boolean' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'mode', 'old', 'content'],
        properties: {
          heading: { type: 'string' },
          mode: { type: 'string', enum: ['replace', 'append', 'delete', 'edit'] },
          old: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
    rewrite: { type: 'string' },
  },
} as const

// `old` before `content`, so the model states what it is replacing before it
// writes the replacement. It is required like everything else here — strict
// `json_schema` allows no optional properties — and "" on the three modes that
// don't use it, the same convention `content` already follows for "delete".
const UPDATE_FIELDS = `"changed": boolean,             // false when nothing you read changes the document. Common, and correct.
    "sections": [{                  // the amendments. [] when changed is false, or when rewriting.
      "heading": string,            // an existing heading to amend, or a new one to create
      "mode": "replace" | "append" | "delete" | "edit",
      "old": string,                // mode "edit" only: the exact text you are replacing, copied character
                                    // for character out of that section. "" for every other mode.
      "content": string             // markdown for the section body. For "edit", the text that replaces
                                    // "old" — or "" to remove what you quoted, which is how a line
                                    // leaves the document without rewriting its section. "" also when
                                    // mode is "delete".
    }],
    "rewrite": string               // "" almost always — see the note above about when a rewrite is warranted`

const updateShape = (field: string) => `"${field}": {
    ${UPDATE_FIELDS}
  },`

const PROFILE_UPDATE_SHAPE = updateShape('profile')

// --- Their context -----------------------------------------------------------

// Field order is deliberate: every small required field comes *before* the big
// `profile` object. A rebuild writes a couple of thousand tokens of prose into
// those sections, and anything sitting after that is a field the model has to
// come back to — `open_questions` was last, and got dropped. Emitting the cheap
// judgment first means it exists before the long work starts. It also makes a
// genuinely truncated response fail on `profile`, which is obvious, rather than
// on whatever happened to be at the end.
export const PERSON_SHAPE = `{
  "headline": string,               // 2 sentences. Who this person appears to be, right now.
  "interest_read": {
    "level": "strong" | "warm" | "too-early" | "ambiguous" | "cooling" | "not-interested",
                                    // "too-early" is the honest answer for a young or thin thread —
                                    // prefer it to "ambiguous"/"cooling" when there simply isn't
                                    // enough yet. A slow reply is not a cooling signal.
    "confidence": "high" | "medium" | "low",
    "signals_for": string[],
    "signals_against": string[],
    "honest_note": string           // the thing the user may not want to hear, IF there is one. Say it
                                    // kindly and say it. "" when there isn't — an invented one to
                                    // seem even-handed is worse than none.
  },
  "flags": [{ "kind": "green" | "amber" | "red", "label": string, "evidence": string }],
  "open_questions": string[],       // what you genuinely don't know and the user should find out. 3-6.
                                    // Each becomes a question the user can answer in a few words, so
                                    // write them as questions, one fact each. This is the *only*
                                    // place gaps go — not into a profile section. Required: return
                                    // it before you start writing the profile below.
  ${PROFILE_UPDATE_SHAPE.replace(/,$/, '')}
}`

export const PERSON_SCHEMA: JsonSchemaSpec = {
  name: 'person_rebuild',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'interest_read', 'flags', 'open_questions', 'profile'],
    properties: {
      headline: { type: 'string' },
      interest_read: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'confidence', 'signals_for', 'signals_against', 'honest_note'],
        properties: {
          level: {
            type: 'string',
            enum: ['strong', 'warm', 'too-early', 'ambiguous', 'cooling', 'not-interested'],
          },
          confidence,
          signals_for: stringArray,
          signals_against: stringArray,
          honest_note: { type: 'string' },
        },
      },
      flags: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'label', 'evidence'],
          properties: {
            kind: { type: 'string', enum: ['green', 'amber', 'red'] },
            label: { type: 'string' },
            evidence: { type: 'string' },
          },
        },
      },
      open_questions: stringArray,
      profile: profileUpdate,
    },
  },
}

// --- The user's own context --------------------------------------------------

export const SELF_SHAPE = `{
  "headline": string,               // 2 sentences. How the user is showing up in this specific connection.
  "goal_read": {
    "stated": string,               // what they said they want
    "revealed": string,             // what their behaviour in the thread optimises for
    "tension": string               // the gap, or "" if there isn't one
  },
  "open_questions": string[],       // what they should get clear with themselves. 2-5.
                                    // Written as questions they can answer in a few words. The only
                                    // place gaps go — not into a profile section. Required: return
                                    // it before you start writing the profile below.
  ${PROFILE_UPDATE_SHAPE.replace(/,$/, '')}
}`

export const SELF_SCHEMA: JsonSchemaSpec = {
  name: 'self_rebuild',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'goal_read', 'open_questions', 'profile'],
    properties: {
      headline: { type: 'string' },
      goal_read: {
        type: 'object',
        additionalProperties: false,
        required: ['stated', 'revealed', 'tension'],
        properties: {
          stated: { type: 'string' },
          revealed: { type: 'string' },
          tension: { type: 'string' },
        },
      },
      open_questions: stringArray,
      profile: profileUpdate,
    },
  },
}

// --- What to say or do -------------------------------------------------------

/**
 * `mind` goes last, and it was third until a captured run argued otherwise.
 *
 * Third was for the reason the rebuild shapes put their small fields first: a
 * field arriving after three drafts is a field that gets dropped. Dropped costs
 * one finding, though, and a captured run showed what corrupted costs. The model
 * left JSON at this nested object mid-generation, emitting the tool-call syntax
 * it uses natively — mind as a *string* reading "<parameter name=..." — then
 * flattened sections and rewrite to the top level and stopped. options, avoid,
 * timing, honest_note and research_notes were never written at all, and a run
 * that had already produced a good read, a good priority and a genuinely useful
 * amendment returned nothing. Down here, a derailment costs only itself.
 *
 * Nothing makes the nested object safe; this only decides what it takes with it
 * when it fails. The drafts are what the user opened the app for, and this field
 * is already optional in `validateSuggestion`. It also no longer needs an early
 * slot to be noticed — the learned section moved out of the system block into
 * the tail, a couple of blocks above where the answer starts.
 */
export const SUGGESTION_SHAPE = `{
  "read": string,                   // 2-4 sentences: where this actually stands right now
  "priority": string,               // the one thing that matters most in the next move
  "options": [{                     // 2-3 genuinely different options, not three versions of one
    "label": string,                // e.g. "Warm + specific", "Name it directly", "Make a plan"
    "kind": "message" | "action",
    "risk": "low" | "medium" | "high",
    "draft": string,                // for "message": the exact text to send, in the user's voice.
                                    // for "action": the concrete thing to do, and when.
    "why": string,                  // what it's doing, in one or two sentences
    "then": string                  // how to read the response, and what to do with each way it lands
  }],
  "avoid": string[],                // specific things NOT to do here, and why
  "timing": string,                 // when to send/do this, and how long to leave it
  "honest_note": string,            // anything true the user probably doesn't want to hear. "" if none —
                                    // and "" is the common case. Do not manufacture a downside to
                                    // look balanced, and do not use this to relitigate their odds.
  "research_notes": string[],       // durable facts from web research THIS run that aren't already
                                    // in <research_notes> (e.g. "Cafe Lumen closes 9pm Sundays").
                                    // A delta — what's stored stays stored either way. [] if you
                                    // didn't research, found nothing worth keeping past this
                                    // answer, or everything you found is already in the block.
                                    // Unless <research_notes> asks you to consolidate: then it is
                                    // the complete replacement list, and what you omit is dropped.
  ${updateShape('mind')}                                // what to change about
                                    // YOURSELF — see "Amending yourself" above. changed: false on
                                    // most runs. Nothing about the person in this request; that
                                    // goes in the two profile amendments below.
  "profile_them": {                 // an amendment to the profile of the PERSON, PROPOSED — the
                                    // user reviews it and applies it, you are not writing it.
                                    // changed: false on most runs. See "Proposing an amendment".
    ${UPDATE_FIELDS}
  },
  "profile_me": {                   // the same, for the profile of the USER in this connection.
                                    // Its own offer, judged on its own — filling it because you
                                    // filled "profile_them" is how a run produces an amendment
                                    // nobody needed.
    ${UPDATE_FIELDS}
  }
}`

export const SUGGESTION_SCHEMA: JsonSchemaSpec = {
  name: 'suggestion',
  schema: {
    type: 'object',
    additionalProperties: false,
    // The three nested update objects go last, and the order is load-bearing
    // rather than cosmetic — see the note in SUGGESTION_SHAPE. A model that
    // derails on one of them should lose only it and whatever is below, never
    // the drafts above. They are ordered cheapest-to-lose last: `mind` is the
    // oldest and most often filled, `profile_them` next, and `profile_me` is
    // the rarest of the three.
    required: [
      'read',
      'priority',
      'options',
      'avoid',
      'timing',
      'honest_note',
      'research_notes',
      'mind',
      'profile_them',
      'profile_me',
    ],
    properties: {
      read: { type: 'string' },
      priority: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'kind', 'risk', 'draft', 'why', 'then'],
          properties: {
            label: { type: 'string' },
            kind: { type: 'string', enum: ['message', 'action'] },
            risk: { type: 'string', enum: ['low', 'medium', 'high'] },
            draft: { type: 'string' },
            why: { type: 'string' },
            then: { type: 'string' },
          },
        },
      },
      avoid: stringArray,
      timing: { type: 'string' },
      honest_note: { type: 'string' },
      research_notes: stringArray,
      mind: profileUpdate,
      profile_them: profileUpdate,
      profile_me: profileUpdate,
    },
  },
}

// --- Talking about a profile -------------------------------------------------

export const CHAT_SHAPE = `{
  "reply": string,                  // what you say back, in a sentence or three. Plain text the user
                                    // reads directly — no markdown headings, no bullet lists, no
                                    // preamble about what you're about to do.
  "headline": string,               // "" almost always, which leaves the existing one alone. Rewrite
                                    // it only when your amendment has made <headline_now> wrong —
                                    // it sits directly above the prose you just changed, so a stale
                                    // one is the first thing the user reads and it contradicts the
                                    // correction underneath. 2 sentences, same voice as the prose.
  ${PROFILE_UPDATE_SHAPE.replace(/,$/, '')}
}`

export const CHAT_SCHEMA: JsonSchemaSpec = {
  name: 'profile_chat',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'headline', 'profile'],
    properties: {
      reply: { type: 'string' },
      headline: { type: 'string' },
      profile: profileUpdate,
    },
  },
}

// --- Validators --------------------------------------------------------------

function missing(obj: object, fields: string[]): string | null {
  const rec = obj as Record<string, unknown>
  const absent = fields.filter((f) => rec[f] === undefined || rec[f] === null)
  return absent.length ? `missing required field(s): ${absent.join(', ')}` : null
}

function needsArray(obj: object, field: string, min = 1): string | null {
  const val = (obj as Record<string, unknown>)[field]
  if (!Array.isArray(val)) return `"${field}" must be an array`
  if (val.length < min) return `"${field}" must have at least ${min} item(s)`
  return null
}

/**
 * Type only, no minimum. An empty list is a legitimate answer for most of these
 * — no flags, nothing to avoid — but the wrong *type* is not: `"flags": "none"`
 * passed every check here, got stored, and then took down the *next* run when
 * `summarisePerson` called `.map` on it. The failure surfaced a run later and
 * blamed the wrong thing, so shape is enforced where it's cheap to say so.
 */
function needsArrays(obj: object, fields: string[]): string | null {
  for (const field of fields) {
    const err = needsArray(obj, field, 0)
    if (err) return err
  }
  return null
}

/** Prose the UI renders as a React child: a non-string there throws on render. */
function needsString(obj: object, field: string): string | null {
  return typeof (obj as Record<string, unknown>)[field] === 'string'
    ? null
    : `"${field}" must be a string`
}

/**
 * `base` is the document the update is about to be applied to. Every engine has
 * it — it is the same string it passes to `applyProfileUpdate` afterwards — and
 * passing it is what lets an `edit`'s quote be checked while there is still a
 * retry left to fix it. Omitted, the update is checked for shape alone.
 */
export function validatePerson(r: object, base?: string): string | null {
  const structural =
    missing(r, ['headline', 'profile', 'interest_read', 'flags', 'open_questions']) ??
    needsString(r, 'headline') ??
    needsArray(r, 'open_questions') ??
    needsArrays(r, ['flags']) ??
    validateProfileUpdate((r as { profile: unknown }).profile, 'profile', base)
  if (structural) return structural

  const interest = (r as { interest_read: object }).interest_read
  return (
    missing(interest, ['level', 'confidence', 'signals_for', 'signals_against', 'honest_note']) ??
    needsArrays(interest, ['signals_for', 'signals_against'])
  )
}

export function validateSelf(r: object, base?: string): string | null {
  return (
    missing(r, ['headline', 'profile', 'goal_read', 'open_questions']) ??
    needsString(r, 'headline') ??
    needsArray(r, 'open_questions') ??
    validateProfileUpdate((r as { profile: unknown }).profile, 'profile', base) ??
    missing((r as { goal_read: object }).goal_read, ['stated', 'revealed', 'tension'])
  )
}

export function validateChat(r: object, base?: string): string | null {
  const headline = (r as { headline?: unknown }).headline
  return (
    missing(r, ['reply', 'profile']) ??
    needsString(r, 'reply') ??
    // Absent is allowed and means "leave it" — the common answer, and the one
    // a backend with no schema enforcement is most likely to omit entirely.
    // A non-string is not: it renders straight into the UI as a React child.
    (headline === undefined || typeof headline === 'string'
      ? null
      : '"headline" must be a string ("" to leave the existing one)') ??
    // An empty reply is the failure worth naming: the model amends the profile
    // and says nothing, and the thread shows a blank bubble where an answer
    // should be.
    ((r as { reply: string }).reply.trim() ? null : '"reply" must not be empty — answer the user') ??
    validateProfileUpdate((r as { profile: unknown }).profile, 'profile', base)
  )
}

/**
 * The three documents a suggestion can carry an amendment to. Each is the
 * markdown as this run was built from it, and each is optional: absent means
 * there is nothing to check the quotes in an `edit` against, not that the
 * document is empty. `run.ts` passes all three.
 */
export interface SuggestionBases {
  mind?: string
  them?: string
  me?: string
}

/**
 * One of the two proposal slots. Which document it aims at is the slot it
 * arrived in, so there is no target to check and no way to aim one at a document
 * that doesn't exist — the failure the old single `profile` field, with its
 * `target` alongside, had to validate its way out of.
 *
 * The empty-document case is a complaint rather than a shrug because the app
 * cannot apply it: `applyProposal` refuses to invent a profile that no rebuild
 * has produced, so a proposal against one would render an offer that does
 * nothing when clicked.
 */
function validateProposal(value: unknown, target: 'them' | 'me', base?: string): string | null {
  const field = target === 'them' ? 'profile_them' : 'profile_me'
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `"${field}" must be an object`
  }
  if ((value as { changed?: unknown }).changed !== true) {
    return validateProfileUpdate(value, field)
  }
  if (base !== undefined && !base.trim()) {
    return `"${field}" amends the ${target === 'them' ? "person's" : "user's"} profile, and there isn't one yet — it has to be built before it can be amended, so return changed: false`
  }
  return validateProfileUpdate(value, field, base)
}

export function validateSuggestion(r: object, bases: SuggestionBases = {}): string | null {
  const mind = (r as { mind?: unknown }).mind
  const them = (r as { profile_them?: unknown }).profile_them
  const me = (r as { profile_me?: unknown }).profile_me
  const structural =
    missing(r, ['read', 'priority', 'options', 'avoid', 'timing', 'honest_note', 'research_notes']) ??
    needsString(r, 'read') ??
    needsString(r, 'priority') ??
    needsString(r, 'timing') ??
    needsString(r, 'honest_note') ??
    needsArray(r, 'options', 2) ??
    needsArrays(r, ['avoid', 'research_notes']) ??
    // Absent is allowed, and means "nothing changed" — the strict schema makes
    // it required for providers that enforce one, but a backend with no schema
    // enforcement (Qwen) shouldn't burn a whole retry on the one field whose
    // correct value is empty on most runs. An explicit `null` is the same
    // answer written differently, and gets the same pass. Present and malformed
    // still fails: a half-formed update would be applied to the coach itself.
    (mind == null ? null : validateProfileUpdate(mind, 'mind', bases.mind)) ??
    // Absent passes for the same reason `mind` does: each is empty on most runs,
    // and the backend with no schema enforcement shouldn't spend its one retry
    // on a field whose correct value is usually nothing. Two slots make that
    // likelier, not less — a run with something to say about the person and
    // nothing to say about the user is the ordinary shape of a filled proposal.
    (them == null ? null : validateProposal(them, 'them', bases.them)) ??
    (me == null ? null : validateProposal(me, 'me', bases.me))
  if (structural) return structural

  const options = (r as { options: Array<Record<string, unknown>> }).options
  for (const [i, opt] of options.entries()) {
    // Checked before `missing` reads through it: a `null` entry would throw a
    // TypeError instead of returning a complaint, and while the callers catch it,
    // what goes back to the model is "Cannot read properties of null" rather than
    // something it can act on.
    if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
      return `options[${i}] must be an object`
    }
    const err = missing(opt, ['label', 'kind', 'risk', 'draft', 'why', 'then'])
    if (err) return `options[${i}]: ${err}`
    if (typeof opt.draft !== 'string' || !opt.draft.trim()) {
      return `options[${i}].draft must be a non-empty string — an actual message or action, not a description of one`
    }
  }
  return null
}
