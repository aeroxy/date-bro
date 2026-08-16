// See the note at the top of `coach/profile.test.ts` about the reference below.
/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
  applyResearchNotes,
  mergeResearchNotes,
  NOTES_LINE_CEILING,
  needsConsolidation,
  replaceResearchNotes,
} from "./research-notes";

const lines = (n: number, prefix = "fact") =>
  Array.from({ length: n }, (_, i) => `- ${prefix} ${i}`).join("\n");

describe("mergeResearchNotes", () => {
  test("appends what is new and keeps what is stored", () => {
    expect(mergeResearchNotes("- one", ["two"])).toBe("- one\n- two");
  });

  test("skips a line already present, however it was bulleted", () => {
    expect(mergeResearchNotes("- One", ["* one", "one", "two"])).toBe(
      "- One\n- two",
    );
  });

  test("returns the notes untouched when nothing came back", () => {
    expect(mergeResearchNotes("- one", [])).toBe("- one");
    expect(mergeResearchNotes("- one", ["   "])).toBe("- one");
  });
});

describe("needsConsolidation", () => {
  test("trips only past the ceiling, counting facts and not blank lines", () => {
    expect(needsConsolidation(lines(NOTES_LINE_CEILING))).toBe(false);
    expect(needsConsolidation(`${lines(NOTES_LINE_CEILING)}\n\n\n`)).toBe(
      false,
    );
    expect(needsConsolidation(lines(NOTES_LINE_CEILING + 1))).toBe(true);
  });
});

describe("replaceResearchNotes", () => {
  const snapshot =
    "- the studio closes at nine\n- studio shuts 9pm\n- one week of annual leave left";

  test("swaps the whole block for the consolidated list", () => {
    expect(
      replaceResearchNotes(snapshot, snapshot, [
        "the studio closes 9pm",
        "one week of annual leave left",
      ]),
    ).toBe("- the studio closes 9pm\n- one week of annual leave left");
  });

  // The run takes half a minute and the notes box is a free textarea the whole
  // time. The model never saw this line, so consolidation can't have dropped it
  // on purpose.
  test("keeps a line the user typed while the run was in flight", () => {
    const current = `${snapshot}\n- sings in a choir`;
    expect(
      replaceResearchNotes(snapshot, current, ["the studio closes 9pm"]),
    ).toBe("- the studio closes 9pm\n- sings in a choir");
  });

  test("does not re-add a user line the consolidation already covered", () => {
    const current = `${snapshot}\n- sings in a choir`;
    expect(
      replaceResearchNotes(snapshot, current, [
        "the studio closes 9pm",
        "Sings in a choir",
      ]),
    ).toBe("- the studio closes 9pm\n- Sings in a choir");
  });

  // A derailed run leaves this field unwritten. That must cost the tidy-up, not
  // every fact the coach has ever looked up.
  test("an empty list leaves the notes alone rather than wiping them", () => {
    expect(replaceResearchNotes(snapshot, snapshot, [])).toBe(snapshot);
    expect(replaceResearchNotes(snapshot, snapshot, ["  "])).toBe(snapshot);
  });
});

describe("applyResearchNotes", () => {
  test("appends below the ceiling", () => {
    const notes = lines(3);
    expect(applyResearchNotes(notes, notes, ["fact 9"])).toBe(
      `${notes}\n- fact 9`,
    );
  });

  test("replaces above it", () => {
    const notes = lines(NOTES_LINE_CEILING + 1);
    expect(applyResearchNotes(notes, notes, ["fact 0", "fact 1"])).toBe(
      "- fact 0\n- fact 1",
    );
  });

  // The mode comes from the snapshot the prompt was built from, so a hand edit
  // mid-run can't leave the app appending an answer that was written to replace.
  test("follows the snapshot, not the notes as they stand now", () => {
    const snapshot = lines(NOTES_LINE_CEILING + 1);
    expect(applyResearchNotes(snapshot, "- fact 0", ["merged"])).toBe(
      "- merged",
    );
  });
});
