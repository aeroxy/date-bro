import type { JsonSchemaSpec } from '@/lib/llm-client'

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

const claimArray = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['claim', 'evidence', 'confidence'],
    properties: {
      claim: { type: 'string' },
      evidence: { type: 'string' },
      confidence,
    },
  },
} as const

// --- Their context -----------------------------------------------------------

export const PERSON_SHAPE = `{
  "headline": string,               // 2 sentences. Who this person appears to be, right now.
  "who_they_are": Claim[],          // stable-looking traits. 3-6.
  "what_they_care_about": Claim[],  // values, interests, ambitions. 3-6.
  "current_situation": Claim[],     // life state right now: work, stress, moves, an ex, whatever's live. 2-5.
  "communication_style": {
    "summary": string,              // how they talk: length, warmth, humour, pace, what they avoid
    "attachment_hypothesis": {
      "pattern": "secure-leaning" | "anxious-leaning" | "avoidant-leaning" | "mixed" | "unclear",
      "evidence": string,
      "confidence": "high" | "medium" | "low"
    },
    "bids": string[]                // bids for connection they made, and whether the user turned toward them
  },
  "interest_read": {
    "level": "strong" | "warm" | "ambiguous" | "cooling" | "not-interested",
    "confidence": "high" | "medium" | "low",
    "signals_for": string[],
    "signals_against": string[],
    "honest_note": string           // the thing the user may not want to hear. Say it kindly and say it.
  },
  "flags": [{ "kind": "green" | "amber" | "red", "label": string, "evidence": string }],
  "sensitivities": string[],        // handle-with-care topics
  "open_threads": string[],         // things they raised that are unresolved or worth returning to
  "open_questions": string[]        // what you genuinely don't know and the user should find out. 3-6.
}

Claim = { "claim": string, "evidence": string, "confidence": "high" | "medium" | "low" }`

export const PERSON_SCHEMA: JsonSchemaSpec = {
  name: 'person_context',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'headline',
      'who_they_are',
      'what_they_care_about',
      'current_situation',
      'communication_style',
      'interest_read',
      'flags',
      'sensitivities',
      'open_threads',
      'open_questions',
    ],
    properties: {
      headline: { type: 'string' },
      who_they_are: claimArray,
      what_they_care_about: claimArray,
      current_situation: claimArray,
      communication_style: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'attachment_hypothesis', 'bids'],
        properties: {
          summary: { type: 'string' },
          attachment_hypothesis: {
            type: 'object',
            additionalProperties: false,
            required: ['pattern', 'evidence', 'confidence'],
            properties: {
              pattern: {
                type: 'string',
                enum: ['secure-leaning', 'anxious-leaning', 'avoidant-leaning', 'mixed', 'unclear'],
              },
              evidence: { type: 'string' },
              confidence,
            },
          },
          bids: stringArray,
        },
      },
      interest_read: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'confidence', 'signals_for', 'signals_against', 'honest_note'],
        properties: {
          level: {
            type: 'string',
            enum: ['strong', 'warm', 'ambiguous', 'cooling', 'not-interested'],
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
      sensitivities: stringArray,
      open_threads: stringArray,
      open_questions: stringArray,
    },
  },
}

// --- The user's own context --------------------------------------------------

export const SELF_SHAPE = `{
  "headline": string,               // 2 sentences. How the user is showing up in this specific connection.
  "how_you_come_across": Claim[],   // how they most likely read to the other person. 3-6.
  "your_voice": {
    "summary": string,              // how they actually write — this is what drafts must sound like
    "markers": string[]             // concrete tics: sentence length, emoji, profanity, humour, formality
  },
  "patterns": [{
    "pattern": string,              // e.g. "pushes harder when replies slow down"
    "evidence": string,
    "effect": string                // what it's likely doing to the other person
  }],
  "working": string[],              // what they're doing well. Be specific — people repeat what gets named.
  "costing_you": string[],          // what's costing them, stated plainly and without moralising
  "you_have_revealed": string[],    // what they've actually disclosed, so drafts stay consistent
  "goal_read": {
    "stated": string,               // what they said they want
    "revealed": string,             // what their behaviour in the thread optimises for
    "tension": string               // the gap, or "" if there isn't one
  },
  "open_questions": string[]        // what they should get clear with themselves. 2-5.
}

Claim = { "claim": string, "evidence": string, "confidence": "high" | "medium" | "low" }`

export const SELF_SCHEMA: JsonSchemaSpec = {
  name: 'self_context',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'headline',
      'how_you_come_across',
      'your_voice',
      'patterns',
      'working',
      'costing_you',
      'you_have_revealed',
      'goal_read',
      'open_questions',
    ],
    properties: {
      headline: { type: 'string' },
      how_you_come_across: claimArray,
      your_voice: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'markers'],
        properties: { summary: { type: 'string' }, markers: stringArray },
      },
      patterns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pattern', 'evidence', 'effect'],
          properties: {
            pattern: { type: 'string' },
            evidence: { type: 'string' },
            effect: { type: 'string' },
          },
        },
      },
      working: stringArray,
      costing_you: stringArray,
      you_have_revealed: stringArray,
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
    },
  },
}

// --- What to say or do -------------------------------------------------------

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
  "honest_note": string,            // anything true the user probably doesn't want to hear. "" if none.
  "research_notes": string[]        // durable facts worth remembering from web research this run
                                    // (e.g. "Cafe Lumen closes 9pm Sundays"). [] if you didn't
                                    // research, or found nothing worth keeping past this answer.
}`

export const SUGGESTION_SCHEMA: JsonSchemaSpec = {
  name: 'suggestion',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['read', 'priority', 'options', 'avoid', 'timing', 'honest_note', 'research_notes'],
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

export function validatePerson(r: object): string | null {
  return (
    missing(r, [
      'headline',
      'who_they_are',
      'what_they_care_about',
      'current_situation',
      'communication_style',
      'interest_read',
      'flags',
      'sensitivities',
      'open_threads',
      'open_questions',
    ]) ??
    needsArray(r, 'who_they_are') ??
    needsArray(r, 'open_questions') ??
    missing((r as { communication_style: object }).communication_style, [
      'summary',
      'attachment_hypothesis',
      'bids',
    ]) ??
    missing((r as { interest_read: object }).interest_read, [
      'level',
      'confidence',
      'signals_for',
      'signals_against',
      'honest_note',
    ])
  )
}

export function validateSelf(r: object): string | null {
  return (
    missing(r, [
      'headline',
      'how_you_come_across',
      'your_voice',
      'patterns',
      'working',
      'costing_you',
      'you_have_revealed',
      'goal_read',
      'open_questions',
    ]) ??
    needsArray(r, 'how_you_come_across') ??
    missing((r as { your_voice: object }).your_voice, ['summary', 'markers']) ??
    missing((r as { goal_read: object }).goal_read, ['stated', 'revealed', 'tension'])
  )
}

export function validateSuggestion(r: object): string | null {
  const structural =
    missing(r, ['read', 'priority', 'options', 'avoid', 'timing', 'honest_note', 'research_notes']) ??
    needsArray(r, 'options', 2) ??
    needsArray(r, 'research_notes', 0)
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
