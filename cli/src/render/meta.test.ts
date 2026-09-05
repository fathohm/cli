import { describe, expect, it } from "vitest";

import { renderHeader } from "./meta";
import { DARK_256, LIGHT_256 } from "./ramp";
import { createTerm } from "./term";

/**
 * THE HEADER'S SCOPE MARKER.
 *
 * Three runs in a row all opened with the same six characters, so scrollback
 * could not tell a whole repository from one file. These assert the rules the
 * marker was added under, not the string it currently prints.
 */

const ESC = "\u001b";

function term(options: { color?: boolean; width?: number } = {}) {
  return createTerm({
    noColor: false,
    ascii: true,
    // Colour is resolved from the environment, not from a flag alone: these
    // renders are not a TTY, so an ink only appears when something forces it.
    env: options.color === true ? { FORCE_COLOR: "1" } : { NO_COLOR: "1" },
    isTTY: false,
    columns: options.width ?? 80,
  });
}

/** The SGR foreground index in a coloured string, if there is one. */
function inkOf(line: string): number | null {
  // `38;5;N` may be followed by further attributes in the SAME sequence — the
  // wordmark is `38;5;97;1m`. Matching only the `...m` form silently found
  // nothing and made the assertion below vacuous.
  const match = /\[38;5;(\d+)[;m]/.exec(line);
  return match === null ? null : Number(match[1]);
}

/**
 * Every index EITHER ground's scale lands on.
 *
 * Both tables, not just the one this handle draws with: a reader on a light
 * terminal must not meet chrome wearing a colour the dark table spends on a
 * reading, and the union is the only set that holds for every reader.
 */
const RESERVED = new Set([...DARK_256, ...LIGHT_256]);

describe("renderHeader scope", () => {
  it("marks a file reading and leaves a repository reading unmarked", () => {
    const repo = renderHeader(term(), ["git-only reading of acme (12 code files)"]);
    const file = renderHeader(term(), ["lib/utils.js", "in acme"], "file");

    // The default is silent on purpose: most commands read a repository, and a
    // tag on every header is noise that stops being read by the second screen.
    expect(repo[0]).not.toContain("ONE FILE");
    expect(file[0]).toContain("ONE FILE");
  });

  it("says it in a WORD, so --no-color and a pipe keep the distinction", () => {
    // The places scrollback confusion is worst — a pipe, a CI log, NO_COLOR —
    // are exactly the places an ANSI code is gone. If colour were carrying this,
    // the fix would evaporate where it is needed most.
    const plain = renderHeader(term({ color: false }), ["lib/utils.js"], "file")[0];

    expect(plain).not.toContain(ESC);
    expect(plain).toContain("ONE FILE");
  });

  it("never draws the tag in a colour the depth ramp uses", () => {
    // THE GUARDRAIL. Every index the ramp lands on means a comprehension value
    // somewhere on the same card. Chrome wearing one of them is a
    // number-coloured word that is not a number, and "harmonising" the tag onto
    // the palette is the tidy-looking change that would do it.
    const reserved = RESERVED;
    const ink = inkOf(renderHeader(term({ color: true }), ["lib/utils.js"], "file")[0]);

    expect(ink).not.toBeNull();
    expect(reserved.has(ink as number)).toBe(false);
  });

  it("never lends the wordmark a colour from the depth ramp", () => {
    // WHAT THE RULE ACTUALLY WAS. This asserted `FATHOHM` was bold and nothing
    // else, but the reason recorded beside it was narrower than the assertion:
    // colouring the brand would make it "a data colour, which is the one thing
    // the ramp is not allowed to be lent to". That forbids the SCALE on the
    // wordmark, not ink. The mark now carries the structure ink — a hue that is
    // provably not on the ramp — and the rule it was protecting is unbroken:
    // the wordmark is identical on every card, in every scope, at every score,
    // so it can never read as a status light.
    const reserved = RESERVED;
    for (const scope of ["repository", "file"] as const) {
      const head = renderHeader(term({ color: true }), ["lib/utils.js"], scope)[0];
      const ink = inkOf(head);
      expect(ink).not.toBeNull();
      expect(reserved.has(ink as number)).toBe(false);
    }

    // And it does not MOVE: same bytes for the mark whatever the card is about.
    const a = renderHeader(term({ color: true }), ["a.js"], "file")[0];
    const b = renderHeader(term({ color: true }), ["b.js"], "repository")[0];
    const mark = (line: string): string => line.slice(0, line.indexOf("FATHOHM") + 7);
    expect(mark(a)).toBe(mark(b));
  });

  it("keeps the subject on line one when the lenses do not fit", () => {
    // A wrapped header must not strand the subject: the file being explained is
    // the reason the card exists, and a narrow terminal is not a reason to bury
    // it under a clock.
    const lines = renderHeader(
      term({ width: 80 }),
      ["src/some/deeply/nested/module/with/a/long/name.ts", "in acme", "scorer v4"],
      "file",
    );

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain("name.ts");
    expect(lines[0]).toContain("ONE FILE");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
  });
});
