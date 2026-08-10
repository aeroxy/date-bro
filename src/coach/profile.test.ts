// Referenced explicitly rather than left to automatic `@types` inclusion, which
// the project's typecheck doesn't do for this package. Scoped to this file so
// Bun's globals stay out of the extension code, which runs in a browser.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'

import {
  applyProfileUpdate,
  renameLegacySections,
  validateProfileUpdate,
  type ProfileUpdate,
} from './profile'
import {
  PERSON_SCHEMA,
  PERSON_SHAPE,
  SELF_SCHEMA,
  SELF_SHAPE,
  CHAT_SCHEMA,
  CHAT_SHAPE,
  SUGGESTION_SCHEMA,
  SUGGESTION_SHAPE,
  validateChat,
  validatePerson,
  validateSelf,
  validateSuggestion,
} from './schemas'

const DOC = `## Who they are

- Landscape architect (high)

## Right now

- Between flats (medium)`

const change = (sections: ProfileUpdate['sections']): ProfileUpdate => ({ changed: true, sections })

describe('applyProfileUpdate', () => {
  test('leaves the document untouched when nothing changed', () => {
    expect(applyProfileUpdate(DOC, { changed: false })).toBe(DOC)
  })

  test('replaces a section body and keeps the others in place', () => {
    const out = applyProfileUpdate(
      DOC,
      change([{ heading: 'Right now', mode: 'replace', content: '- Moved in (high)' }]),
    )
    expect(out).toBe(`## Who they are

- Landscape architect (high)

## Right now

- Moved in (high)`)
  })

  test('appends a bullet onto the existing list rather than under it', () => {
    const out = applyProfileUpdate(
      DOC,
      change([{ heading: 'Who they are', mode: 'append', content: '- Runs most mornings (low)' }]),
    )
    expect(out).toContain('- Landscape architect (high)\n- Runs most mornings (low)')
  })

  test('appended prose starts its own paragraph', () => {
    const out = applyProfileUpdate(
      DOC,
      change([{ heading: 'Who they are', mode: 'append', content: 'Softer than she reads.' }]),
    )
    expect(out).toContain('- Landscape architect (high)\n\nSofter than she reads.')
  })

  test('matches headings across case and trailing punctuation', () => {
    const out = applyProfileUpdate(
      DOC,
      change([{ heading: 'who they ARE:', mode: 'replace', content: '- Architect (high)' }]),
    )
    expect(out).toContain('## Who they are\n\n- Architect (high)')
    expect(out.match(/^## /gm)).toHaveLength(2)
  })

  test('creates an unknown heading at the end instead of failing', () => {
    const out = applyProfileUpdate(
      DOC,
      change([{ heading: 'Handle with care', mode: 'append', content: '- Her ex' }]),
    )
    expect(out.endsWith('## Handle with care\n\n- Her ex')).toBe(true)
  })

  test('deletes a section, and shrugs at one that was never there', () => {
    const out = applyProfileUpdate(
      DOC,
      change([
        { heading: 'Right now', mode: 'delete' },
        { heading: 'Nothing here', mode: 'delete' },
      ]),
    )
    expect(out).toBe('## Who they are\n\n- Landscape architect (high)')
  })

  test('applies ops in order, so delete-then-recreate works', () => {
    const out = applyProfileUpdate(
      DOC,
      change([
        { heading: 'Who they are', mode: 'delete' },
        { heading: 'Who they are', mode: 'replace', content: '- Rebuilt (high)' },
      ]),
    )
    expect(out).toBe('## Right now\n\n- Between flats (medium)\n\n## Who they are\n\n- Rebuilt (high)')
  })

  test('builds a document from empty', () => {
    const out = applyProfileUpdate(
      '',
      change([{ heading: 'Who they are', mode: 'replace', content: '- New (low)' }]),
    )
    expect(out).toBe('## Who they are\n\n- New (low)')
  })

  test('preserves text sitting above the first heading', () => {
    const withPreamble = `A note that was never under a heading.\n\n${DOC}`
    const out = applyProfileUpdate(
      withPreamble,
      change([{ heading: 'Right now', mode: 'replace', content: '- Settled (high)' }]),
    )
    expect(out.startsWith('A note that was never under a heading.')).toBe(true)
  })

  test('a rewrite replaces everything', () => {
    expect(applyProfileUpdate(DOC, { changed: true, rewrite: '## All new\n\n- Yes' })).toBe(
      '## All new\n\n- Yes',
    )
  })

  test('round-trips: re-applying nothing is byte-stable', () => {
    const once = applyProfileUpdate(
      DOC,
      change([{ heading: 'Right now', mode: 'replace', content: '- Moved in (high)' }]),
    )
    expect(applyProfileUpdate(once, { changed: false })).toBe(once)
    expect(applyProfileUpdate(once, change([]))).toBe(once)
  })
})

describe('validateProfileUpdate', () => {
  test('accepts the three legitimate shapes', () => {
    expect(validateProfileUpdate({ changed: false })).toBeNull()
    expect(validateProfileUpdate(change([{ heading: 'A', mode: 'append', content: '- x' }]))).toBeNull()
    expect(validateProfileUpdate({ changed: true, rewrite: '## A' })).toBeNull()
    expect(validateProfileUpdate({ changed: true, sections: [{ heading: 'A', mode: 'delete' }] })).toBeNull()
  })

  test('rejects changed: true carrying nothing', () => {
    expect(validateProfileUpdate({ changed: true })).toContain('nothing was sent')
    expect(validateProfileUpdate({ changed: true, sections: [], rewrite: '' })).toContain(
      'nothing was sent',
    )
  })

  test('rejects both transports at once', () => {
    const both = { changed: true, sections: [{ heading: 'A', mode: 'append', content: '- x' }], rewrite: '## A' }
    expect(validateProfileUpdate(both)).toContain('not both')
  })

  test('rejects a missing or unknown mode', () => {
    expect(validateProfileUpdate(change([{ heading: 'A', mode: 'patch' as never, content: 'x' }]))).toContain(
      'mode',
    )
  })

  test('requires content unless deleting', () => {
    expect(validateProfileUpdate(change([{ heading: 'A', mode: 'replace' }]))).toContain('content')
    expect(validateProfileUpdate(change([{ heading: 'A', mode: 'append', content: '   ' }]))).toContain(
      'content',
    )
  })

  test('rejects a blank heading', () => {
    expect(validateProfileUpdate(change([{ heading: '  ', mode: 'delete' }]))).toContain('heading')
  })

  test('rejects the shapes a loose backend can return', () => {
    expect(validateProfileUpdate(null)).toContain('must be an object')
    expect(validateProfileUpdate([])).toContain('must be an object')
    expect(validateProfileUpdate({})).toContain('changed')
    expect(validateProfileUpdate({ changed: 'yes' })).toContain('changed')
  })
})

/**
 * These exist because a `required` list and a `properties` map drifted apart
 * once already — a scripted reorder dropped `profile` and `open_questions` from
 * the person schema's properties while leaving them required, which typechecks
 * fine and only fails against a live provider.
 */
describe('rebuild schemas', () => {
  const cases = [
    { name: 'person', schema: PERSON_SCHEMA, shape: PERSON_SHAPE },
    { name: 'self', schema: SELF_SCHEMA, shape: SELF_SHAPE },
  ]

  for (const { name, schema, shape } of cases) {
    const required = schema.schema.required as string[]
    const properties = schema.schema.properties as Record<string, unknown>

    test(`${name}: every required field has a property`, () => {
      expect(required.filter((f) => !(f in properties))).toEqual([])
    })

    test(`${name}: strict mode wants every property required`, () => {
      expect(Object.keys(properties).filter((f) => !required.includes(f))).toEqual([])
    })

    test(`${name}: the prompt sketch names every required field`, () => {
      expect(required.filter((f) => !shape.includes(`"${f}"`))).toEqual([])
    })

    // The bug this whole batch came from: the model wrote its open questions
    // into a profile section and then omitted the field. `profile` is last so
    // the cheap required fields are emitted before the long prose starts.
    test(`${name}: profile is the last field in both the shape and the schema`, () => {
      expect(required[required.length - 1]).toBe('profile')
      expect(shape.lastIndexOf('"profile"')).toBeGreaterThan(shape.lastIndexOf('"open_questions"'))
    })
  }

  test('the shapes are self-consistent JSON-ish sketches, not truncated', () => {
    for (const shape of [PERSON_SHAPE, SELF_SHAPE, CHAT_SHAPE]) {
      expect(shape.trimStart().startsWith('{')).toBe(true)
      expect(shape.trimEnd().endsWith('}')).toBe(true)
      // A stray trailing comma from interpolating the shared profile block.
      expect(/,\s*}$/.test(shape.trimEnd())).toBe(false)
    }
  })
})

describe('rebuild validators', () => {
  const person = {
    headline: 'x',
    interest_read: { level: 'warm', confidence: 'low', signals_for: [], signals_against: [], honest_note: '' },
    flags: [],
    open_questions: ['what does she study?'],
    profile: { changed: false },
  }
  const self = {
    headline: 'x',
    goal_read: { stated: '', revealed: '', tension: '' },
    open_questions: ['what would make this worth it?'],
    profile: { changed: false },
  }

  test('accept a well-formed rebuild', () => {
    expect(validatePerson(person)).toBeNull()
    expect(validateSelf(self)).toBeNull()
  })

  // Deliberately NOT lenient. An empty list would be a coherent answer, but the
  // UI turns each question into something answerable in a few words, so a
  // silently-absent field degrades a feature rather than a sentence.
  test('reject a rebuild with no open_questions — the actual failure seen in the wild', () => {
    const { open_questions, ...withoutPerson } = person
    const { open_questions: _, ...withoutSelf } = self
    expect(validatePerson(withoutPerson)).toContain('open_questions')
    expect(validateSelf(withoutSelf)).toContain('open_questions')
  })

  test('reject a rebuild carrying no profile update at all', () => {
    const { profile, ...rest } = person
    expect(validatePerson(rest)).toContain('profile')
  })
})

describe('renameLegacySections', () => {
  test('renames a heading written under the old name', () => {
    const out = renameLegacySections('## Open threads\n\n- China')
    expect(out).toBe('## Threads to pick back up\n\n- China')
  })

  test('an amendment then lands on the renamed section instead of creating a twin', () => {
    const renamed = renameLegacySections('## Who they are\n\n- x\n\n## Open threads\n\n- China')
    const out = applyProfileUpdate(
      renamed,
      change([{ heading: 'Threads to pick back up', mode: 'append', content: '- Singapore' }]),
    )
    expect(out.match(/^## /gm)).toHaveLength(2)
    expect(out).toContain('- China\n- Singapore')
  })

  test('is idempotent and byte-stable on a document with nothing to rename', () => {
    expect(renameLegacySections(DOC)).toBe(DOC)
    const once = renameLegacySections('## Open threads\n\n- x')
    expect(renameLegacySections(once)).toBe(once)
  })

  test('leaves body text that merely mentions the old name alone', () => {
    const doc = '## Who they are\n\n- Left some open threads about work'
    expect(renameLegacySections(doc)).toBe(doc)
  })
})

describe('the suggestion contract', () => {
  const ok = () => ({
    read: 'r',
    priority: 'p',
    options: [
      { label: 'a', kind: 'message', risk: 'low', draft: 'hi', why: 'w', then: 't' },
      { label: 'b', kind: 'message', risk: 'low', draft: 'yo', why: 'w', then: 't' },
    ],
    avoid: [],
    timing: '',
    honest_note: '',
    research_notes: [],
  })

  test('required and properties agree, and every one is in the prompt shape', () => {
    const { required, properties } = SUGGESTION_SCHEMA.schema as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(Object.keys(properties).sort()).toEqual([...required].sort())
    for (const field of required) expect(SUGGESTION_SHAPE).toContain(`"${field}"`)
  })

  test('the mind amendment is emitted after the drafts, not before them', () => {
    const { required } = SUGGESTION_SCHEMA.schema as { required: string[] }
    // This assertion used to run the other way, on the lesson `open_questions`
    // cost: a field that comes after three drafts is one the model sometimes
    // never comes back to. It flipped when a captured run showed the larger
    // cost of the early slot — the model left JSON at this nested object and
    // stopped, so nothing below it was written and the whole answer was lost.
    // Dropping the amendment costs one finding; corrupting it early costs the
    // drafts. Ordering can't make the nested object safe, only decide what it
    // takes down with it.
    expect(required.indexOf('mind')).toBeGreaterThan(required.indexOf('options'))
    expect(required.at(-1)).toBe('mind')
  })

  test('an absent mind amendment is allowed — it means nothing was learned', () => {
    expect(validateSuggestion(ok())).toBeNull()
  })

  test('a present but malformed mind amendment is rejected, not applied', () => {
    const bad = { ...ok(), mind: { changed: true, sections: 'lots', rewrite: '' } }
    expect(validateSuggestion(bad)).toContain('mind')
  })

  test('a well-formed mind amendment passes', () => {
    const good = {
      ...ok(),
      mind: {
        changed: true,
        sections: [{ heading: 'What has worked', mode: 'append', content: '- specific evenings' }],
        rewrite: '',
      },
    }
    expect(validateSuggestion(good)).toBeNull()
  })
})

describe('the amend contract', () => {
  const ok = () => ({ reply: 'done', profile: { changed: false, sections: [], rewrite: '' } })

  test('required and properties agree, and every one is in the prompt shape', () => {
    const { required, properties } = CHAT_SCHEMA.schema as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(Object.keys(properties).sort()).toEqual([...required].sort())
    for (const field of required) expect(CHAT_SHAPE).toContain(`"${field}"`)
  })

  test('an absent headline is allowed — it means leave the existing one', () => {
    expect(validateChat(ok())).toBeNull()
    expect(validateChat({ ...ok(), headline: '' })).toBeNull()
  })

  test('a non-string headline is rejected — it renders as a React child', () => {
    expect(validateChat({ ...ok(), headline: ['a'] })).toContain('headline')
    expect(validateChat({ ...ok(), headline: 3 })).toContain('headline')
  })
})
