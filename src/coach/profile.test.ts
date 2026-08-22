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

  test('edits one bullet and leaves the rest of the section alone', () => {
    const doc = `## Who they are

- Landscape architect (high)
- Between flats (medium)
- Runs most mornings (low)`
    const out = applyProfileUpdate(
      doc,
      change([
        {
          heading: 'Who they are',
          mode: 'edit',
          old: '- Between flats (medium)',
          content: '- Moved in with her sister (high)',
        },
      ]),
    )
    expect(out).toBe(`## Who they are

- Landscape architect (high)
- Moved in with her sister (high)
- Runs most mornings (low)`)
  })

  test('an edit only searches the section it names', () => {
    const doc = '## Who they are\n\n- Between flats\n\n## Right now\n\n- Between flats'
    const out = applyProfileUpdate(
      doc,
      change([
        { heading: 'Right now', mode: 'edit', old: '- Between flats', content: '- Moved in' },
      ]),
    )
    expect(out).toBe('## Who they are\n\n- Between flats\n\n## Right now\n\n- Moved in')
  })

  // The whole of the fallback: outer whitespace per line. A quote that differs
  // in any other way is a quote of text that isn't there, and stays a miss.
  test('an edit matches when the quote carries whitespace the document does not', () => {
    const doc = '## Who they are\n\n- Landscape architect (high)\n- Runs most mornings (low)'
    const out = applyProfileUpdate(
      doc,
      change([
        {
          heading: 'Who they are',
          mode: 'edit',
          old: '  - Landscape architect (high)  ',
          content: '- Landscape architect, own studio (high)',
        },
      ]),
    )
    expect(out).toBe(
      '## Who they are\n\n- Landscape architect, own studio (high)\n- Runs most mornings (low)',
    )
  })

  test('an edit spanning several lines replaces all of them', () => {
    const doc = '## Patterns\n\n- One\n- Two\n- Three'
    const out = applyProfileUpdate(
      doc,
      change([{ heading: 'Patterns', mode: 'edit', old: '- One\n- Two', content: '- Merged' }]),
    )
    expect(out).toBe('## Patterns\n\n- Merged\n- Three')
  })

  // Quoting whole lines includes the newline that ends the last one, which is
  // what "copy it exactly" produces. It matched exactly, so the splice ate the
  // separator and left `- Merged- Three`.
  test('an edit whose quote carries the newline after it keeps the line break', () => {
    const doc = '## Patterns\n\n- One\n- Two\n- Three'
    const out = applyProfileUpdate(
      doc,
      change([{ heading: 'Patterns', mode: 'edit', old: '- One\n- Two\n', content: '- Merged' }]),
    )
    expect(out).toBe('## Patterns\n\n- Merged\n- Three')
  })

  test('an edit whose quote opens with a newline keeps the line break', () => {
    const doc = '## Patterns\n\n- One\n- Two\n- Three'
    const out = applyProfileUpdate(
      doc,
      change([{ heading: 'Patterns', mode: 'edit', old: '\n- Two\n- Three', content: '- Merged' }]),
    )
    expect(out).toBe('## Patterns\n\n- One\n- Merged')
  })

  // Both match paths put the replacement where the line starts, and `content` is
  // trimmed — so the document's own indentation is what has to be put back, or
  // editing a sub-point promotes it to a top-level one.
  test('an edit keeps the indentation of the line it replaces', () => {
    const doc = '## Patterns\n\n- Asks a question back\n  - Usually about work\n- Replies at night'
    const out = applyProfileUpdate(
      doc,
      change([
        { heading: 'Patterns', mode: 'edit', old: '  - Usually about work', content: '- About work' },
      ]),
    )
    expect(out).toBe('## Patterns\n\n- Asks a question back\n  - About work\n- Replies at night')
  })

  test('an edit keeps the indentation when the quote normalised it away', () => {
    const doc = '## Patterns\n\n- Asks a question back\n  - Usually about work\n- Replies at night'
    const out = applyProfileUpdate(
      doc,
      change([
        {
          heading: 'Patterns',
          mode: 'edit',
          old: '    - Usually about work',
          content: '- About work',
        },
      ]),
    )
    expect(out).toBe('## Patterns\n\n- Asks a question back\n  - About work\n- Replies at night')
  })

  // A quote that starts mid-line leaves the indent to the left of the splice,
  // where putting it back would double it.
  test('an edit inside an indented line does not double the indent', () => {
    const doc = '## Patterns\n\n- Asks a question back\n  - Usually about work'
    const out = applyProfileUpdate(
      doc,
      change([{ heading: 'Patterns', mode: 'edit', old: 'about work', content: 'about her studio' }]),
    )
    expect(out).toBe('## Patterns\n\n- Asks a question back\n  - Usually about her studio')
  })

  // The deletion path reads the character either side of the match to take one
  // newline with the line, so it has to keep working on a quote that already
  // carried it — otherwise dropping a bullet this way leaves a blank line.
  test('a deleting edit whose quote carries the newline leaves no blank line', () => {
    const doc = '## Patterns\n\n- One\n- Two\n- Three'
    const out = applyProfileUpdate(
      doc,
      change([{ heading: 'Patterns', mode: 'edit', old: '- Two\n', content: '' }]),
    )
    expect(out).toBe('## Patterns\n\n- One\n- Three')
  })

  // Unreachable from a rebuild, which validates the quote against this exact
  // document — but the mind amendment and (later) an applied proposal both land
  // on a document read after the quote was written.
  test('an edit whose quote is gone is dropped, and takes nothing with it', () => {
    const out = applyProfileUpdate(
      DOC,
      change([
        { heading: 'Who they are', mode: 'edit', old: '- Nurse (high)', content: '- Doctor' },
        { heading: 'Right now', mode: 'append', content: '- Also cycling' },
      ]),
    )
    expect(out).toContain('- Landscape architect (high)')
    expect(out).not.toContain('Doctor')
    expect(out).toContain('- Between flats (medium)\n- Also cycling')
  })

  test('an ambiguous edit is dropped rather than applied to a guess', () => {
    const doc = '## Patterns\n\n- Answers with a list\n- Answers with a list'
    const out = applyProfileUpdate(
      doc,
      change([
        { heading: 'Patterns', mode: 'edit', old: '- Answers with a list', content: '- Fixed' },
      ]),
    )
    expect(out).toBe(doc)
  })

  test('an edit with empty content removes the line, newline and all', () => {
    const doc = '## Patterns\n\n- One\n- Two\n- Three'
    const out = applyProfileUpdate(
      doc,
      change([{ heading: 'Patterns', mode: 'edit', old: '- Two', content: '' }]),
    )
    expect(out).toBe('## Patterns\n\n- One\n- Three')
  })

  test('removing the last line leaves no trailing blank', () => {
    const doc = '## Patterns\n\n- One\n- Two'
    const out = applyProfileUpdate(
      doc,
      change([{ heading: 'Patterns', mode: 'edit', old: '- Two', content: '' }]),
    )
    expect(out).toBe('## Patterns\n\n- One')
  })

  // The whole point of the mode, end to end: a bullet plus the bullet somebody
  // wrote to correct it become one true bullet.
  test('collapses a correction that was written as a second bullet', () => {
    const doc = `## Who you are

- Grew up in California, then school near Pittsburgh (medium)
- **Supersedes the above.** Born in Fujian; California came later (high)
- Writes long messages (medium)`
    const out = applyProfileUpdate(
      doc,
      change([
        {
          heading: 'Who you are',
          mode: 'edit',
          old: '- Grew up in California, then school near Pittsburgh (medium)',
          content: '- Born in Fujian, California later, then school near Pittsburgh (high)',
        },
        {
          heading: 'Who you are',
          mode: 'edit',
          old: '- **Supersedes the above.** Born in Fujian; California came later (high)',
          content: '',
        },
      ]),
    )
    expect(out).toBe(`## Who you are

- Born in Fujian, California later, then school near Pittsburgh (high)
- Writes long messages (medium)`)
  })

  test('an edit whose content field is absent removes nothing', () => {
    const out = applyProfileUpdate(
      DOC,
      change([{ heading: 'Who they are', mode: 'edit', old: '- Landscape architect (high)' }]),
    )
    expect(out).toBe(DOC)
  })

  // Unreachable from a rebuild — `validateProfileUpdate` demands a quote — but
  // the writers that apply to a document they didn't validate against can hand
  // one over. An empty quote addresses nothing, and the empty string is at every
  // offset in the body, so `locate` reads it as ambiguous and the op is dropped
  // rather than splicing content into the top of the section.
  test('an edit with no quote to aim at changes nothing, content or not', () => {
    for (const old of [undefined, '']) {
      const out = applyProfileUpdate(
        DOC,
        change([{ heading: 'Who they are', mode: 'edit', old, content: '- Doctor (high)' }]),
      )
      expect(out).toBe(DOC)
    }
  })

  test('an edit does not create the section it failed to find', () => {
    const out = applyProfileUpdate(
      DOC,
      change([{ heading: 'Handle with care', mode: 'edit', old: '- Her ex', content: '- Nothing' }]),
    )
    expect(out).toBe(DOC)
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

  test('allows an edit to empty — it removes the quoted text — but not an absent one', () => {
    const remove = change([
      {
        heading: 'Who they are',
        mode: 'edit',
        old: '- Landscape architect (high)',
        content: '',
      },
    ])
    expect(validateProfileUpdate(remove, 'profile', DOC)).toBeNull()

    const absent = change([
      { heading: 'Who they are', mode: 'edit', old: '- Landscape architect (high)' },
    ])
    expect(validateProfileUpdate(absent, 'profile', DOC)).toContain('content')
  })

  test('requires a quote on an edit, whether or not there is a document to check', () => {
    const noQuote = change([{ heading: 'Who they are', mode: 'edit', content: '- x' }])
    expect(validateProfileUpdate(noQuote)).toContain('old')
    expect(validateProfileUpdate(noQuote, 'profile', DOC)).toContain('old')
  })

  // Without a base the quote is taken on trust: nothing here can tell whether it
  // is in the document, and `applyProfileUpdate` drops it later if it isn't.
  test('accepts an unverifiable edit when there is no document to check against', () => {
    const update = change([
      { heading: 'Who they are', mode: 'edit', old: '- Nurse', content: '- Doctor' },
    ])
    expect(validateProfileUpdate(update)).toBeNull()
    expect(validateProfileUpdate(update, 'profile', DOC)).toContain('quote the text you are replacing')
  })

  test('accepts an edit whose quote is really there', () => {
    const update = change([
      {
        heading: 'Who they are',
        mode: 'edit',
        old: '- Landscape architect (high)',
        content: '- Landscape architect, own studio (high)',
      },
    ])
    expect(validateProfileUpdate(update, 'profile', DOC)).toBeNull()
  })

  test('rejects an ambiguous quote with the instruction that fixes it', () => {
    const doc = '## Patterns\n\n- Answers with a list\n- Answers with a list'
    const update = change([
      { heading: 'Patterns', mode: 'edit', old: '- Answers with a list', content: '- Fixed' },
    ])
    expect(validateProfileUpdate(update, 'profile', doc)).toContain('more than once')
  })

  test('rejects an edit aimed at a section that does not exist', () => {
    const update = change([
      { heading: 'Handle with care', mode: 'edit', old: '- Her ex', content: '- x' },
    ])
    expect(validateProfileUpdate(update, 'profile', DOC)).toContain('not a section')
  })

  // One retry, then the whole rebuild throws — so a model that can't reproduce
  // the quote has to be told what to do instead of trying a third time.
  test('the not-found complaint offers a way out that is not another edit', () => {
    const update = change([
      { heading: 'Who they are', mode: 'edit', old: '- Nurse', content: '- Doctor' },
    ])
    const complaint = validateProfileUpdate(update, 'profile', DOC) ?? ''
    expect(complaint).toContain('append')
    expect(complaint).toContain('replace')
  })

  // Ops apply in order, so the checks have to walk the same document the apply
  // will. Both of these used to disagree with `applyProfileUpdate`: this one
  // applies cleanly and was rejected, burning the one retry.
  test('validates each op against what the ops before it did', () => {
    const update = change([
      { heading: 'Right now', mode: 'replace', content: '- Moved in with her sister (high)' },
      {
        heading: 'Right now',
        mode: 'edit',
        old: '- Moved in with her sister (high)',
        content: '- Moved in with her sister (medium)',
      },
    ])
    expect(validateProfileUpdate(update, 'profile', DOC)).toBeNull()
    expect(applyProfileUpdate(DOC, update)).toContain('- Moved in with her sister (medium)')
  })

  // And the inverse: this passed, then the edit was silently dropped on apply.
  test('rejects an edit aimed at a section an earlier op deleted', () => {
    const update = change([
      { heading: 'Right now', mode: 'delete' },
      { heading: 'Right now', mode: 'edit', old: '- Between flats (medium)', content: '- Moved in' },
    ])
    expect(validateProfileUpdate(update, 'profile', DOC)).toContain('not a section')
  })

  test('the invalid-mode complaint names every mode, edit included', () => {
    const complaint =
      validateProfileUpdate(
        { changed: true, sections: [{ heading: 'Who they are', mode: 'rewrite', content: '- x' }] },
        'profile',
        DOC,
      ) ?? ''
    expect(complaint).toContain('edit')
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

  // The section op is nested three deep, so the drift check the tests above run
  // on the top level doesn't reach it — and it is the half of the contract the
  // model reads as prose.
  test('the section op is strict-mode clean, and the sketch names every mode', () => {
    const op = (
      PERSON_SCHEMA.schema.properties as unknown as {
        profile: {
          properties: {
            sections: { items: { required: string[]; properties: Record<string, unknown> } }
          }
        }
      }
    ).profile.properties.sections.items
    expect(Object.keys(op.properties).sort()).toEqual([...op.required].sort())

    const modes = (op.properties.mode as { enum: string[] }).enum
    expect(modes).toContain('edit')
    for (const shape of [PERSON_SHAPE, SELF_SHAPE, CHAT_SHAPE, SUGGESTION_SHAPE]) {
      for (const mode of modes) expect(shape).toContain(`"${mode}"`)
      expect(shape).toContain('"old"')
    }
  })

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
    interest_read: {
      level: 'warm',
      confidence: 'low',
      toward: ['unclear'],
      signals_for: [],
      signals_against: [],
      honest_note: '',
    },
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

  // `toward` is what separates *kind* of interest from *degree*; a read without
  // it collapses back to six gradations of one undifferentiated thing, which is
  // the failure the field was added for. Required in the schema, so required here.
  test('reject a rebuild whose interest read says nothing about what it points at', () => {
    const { toward, ...read } = person.interest_read
    expect(validatePerson({ ...person, interest_read: read })).toContain('toward')
  })

  // The schema's enum and minItems only bind providers with response_format;
  // the Qwen path meets nothing but this validator, so it enforces them too.
  test('reject a toward the schema would have caught', () => {
    const withToward = (toward: string[]) => ({
      ...person,
      interest_read: { ...person.interest_read, toward },
    })
    // Empty is a skipped question, not an answer — "unclear" is the empty state.
    expect(validatePerson(withToward([]))).toContain('toward')
    expect(validatePerson(withToward(['unknown']))).toContain('toward')
    // "unclear" hedged against a real destination reads as both.
    expect(validatePerson(withToward(['unclear', 'sex']))).toContain('unclear')
    expect(validatePerson(withToward(['sex', 'companionship']))).toBeNull()
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

  test('all three amendments are emitted after the drafts, rarest last', () => {
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
    // The proposals sit below the mind for the same reason the mind sits below
    // the drafts: of the three nested objects they are the rarer, so they are
    // the cheaper ones for a derailment to take with it. `profile_me` is last
    // because it is the rarest of all — most turns are about the other person.
    expect(required.indexOf('profile_them')).toBeGreaterThan(required.indexOf('mind'))
    expect(required.indexOf('profile_me')).toBeGreaterThan(required.indexOf('profile_them'))
    expect(required.at(-1)).toBe('profile_me')
  })

  test('an absent mind amendment is allowed — it means nothing was learned', () => {
    expect(validateSuggestion(ok())).toBeNull()
  })

  test('a present but malformed mind amendment is rejected, not applied', () => {
    const bad = { ...ok(), mind: { changed: true, sections: 'lots', rewrite: '' } }
    expect(validateSuggestion(bad)).toContain('mind')
  })

  test('an absent profile proposal is allowed — it means nothing was learned', () => {
    expect(validateSuggestion(ok(), { them: DOC })).toBeNull()
    expect(
      validateSuggestion({ ...ok(), profile_them: { changed: false } }, { them: DOC }),
    ).toBeNull()
  })

  test('an idle slot passes on shape alone', () => {
    const idle = {
      ...ok(),
      profile_them: { changed: false, sections: [], rewrite: '' },
      profile_me: { changed: false, sections: [], rewrite: '' },
    }
    expect(validateSuggestion(idle, { them: DOC, me: DOC })).toBeNull()
  })

  // The slot is the target, so an amendment can no longer be aimed at nothing —
  // the case the old single `profile` field needed a `target` enum to catch.
  test('each slot is checked against its own document', () => {
    const edit = change([
      {
        heading: 'Right now',
        mode: 'edit',
        old: '- Between flats (medium)',
        content: '- Moved in (high)',
      },
    ])
    // Same heading in both documents, different text under it — so the only
    // thing separating a pass from a complaint is which one the quote is
    // checked against.
    const bases = { them: DOC, me: '## Right now\n\n- Between jobs (medium)' }

    expect(validateSuggestion({ ...ok(), profile_them: edit }, bases)).toBeNull()
    expect(validateSuggestion({ ...ok(), profile_me: edit }, bases)).toContain(
      'quote the text you are replacing',
    )
  })

  test('both slots can be filled at once, and both are checked', () => {
    const both = (meHeading: string) => ({
      ...ok(),
      profile_them: change([{ heading: 'Right now', mode: 'append', content: '- Moved in' }]),
      profile_me: change([
        { heading: meHeading, mode: 'edit', old: '- Between jobs', content: '- Started at Verde' },
      ]),
    })
    const bases = { them: DOC, me: '## Where you are\n\n- Between jobs' }

    expect(validateSuggestion(both('Where you are'), bases)).toBeNull()
    // A bad quote in the second slot is not excused by a good first one.
    expect(validateSuggestion(both('Nowhere'), bases)).toContain('profile_me')
  })

  // The app refuses to invent a profile no rebuild has produced, so a proposal
  // against one would render an offer that does nothing when clicked.
  test('a proposal against a profile that does not exist yet is rejected', () => {
    const proposal = {
      ...ok(),
      profile_me: change([{ heading: 'Who you are', mode: 'append', content: '- x' }]),
    }
    expect(validateSuggestion(proposal, { them: DOC, me: '' })).toContain("isn't one yet")
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
