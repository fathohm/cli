import { describe, expect, it } from "vitest";

import {
  KINDS_BELOW,
  MIXED,
  readingOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { initialSelector, stepSelector, type SelectorRow } from "../tty/selector";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import { TOP_PATHS, darkRows } from "./below";
import { renderCard } from "./card";
import type { RenderMeta } from "./meta";
import { hintLine, renderSelector } from "./selector";
import { INDENT } from "./text";

function term(options: { ascii?: boolean; color?: boolean; columns?: number } = {}): Term {
  return createTerm({
    noColor: options.color !== true,
    ascii: options.ascii === true,
    env: options.color === true ? { FORCE_COLOR: "1" } : {},
    isTTY: false,
    columns: options.columns ?? 80,
  });
}

const META: RenderMeta = {
  target: "acme-api",
  quiet: false,
  full: false,
  horizonDays: 90,
  scorerVersion: SCORER_VERSION,
};

/** The rows the card printed, in the shape the picker takes them. */
function cardRows(shared: Term, fixture: ExtractFixture = MIXED): SelectorRow[] {
  const { reading } = readingOf(fixture);
  return darkRows(reading, shared).map((row) => ({
    path: row.file.path,
    body: row.body,
  }));
}

describe("the picker lists what the card printed", () => {
  // Two trees: one with no declared kinds in it at all, and one whose four
  // biggest files below the line are a stylesheet, a schema dump, a test and a
  // script. The picker never sorts — it is handed `darkRows` — so the
  // second case is here to PROVE that rather than to assume it.
  for (const { name, fixture } of [
    { name: "mixed", fixture: MIXED },
    { name: "kinds below the line", fixture: KINDS_BELOW },
  ] as const) {
    for (const columns of [80, 100, 132]) {
      it(`${name}, ${columns} columns: every listed row is a line of the card, verbatim`, () => {
        // THE assertion this whole layer rests on. The picker sits directly
        // under the card's BELOW THE LINE section; a row here that the card did
        // not print would be a second rendering of the same file, and the
        // reader would be looking at both at once.
        const shared = term({ ascii: true, columns });
        const { reading, tide } = readingOf(fixture);
        const card = renderCard(reading, tide, shared, META);
        const block = renderSelector(initialSelector(cardRows(shared, fixture)), shared);

        for (const line of block.slice(1, -1)) {
          expect(card, `not on the card: ${line}`).toContain(INDENT + line.slice(INDENT.length));
        }
      });
    }
  }

  it("lists the demoted tiers in the card's order, not in byte order", () => {
    // The 30KB stylesheet and the 22KB test are the biggest files below the
    // line; the picker still opens on the 9KB route, because the picker does
    // not sort — it is handed `darkRows`.
    const shared = term({ ascii: true, columns: 100 });
    expect(cardRows(shared, KINDS_BELOW).map((row) => row.path)).toEqual([
      "app/api/route.ts",
      "workers/src/drain.ts",
      "supabase/migrations/20260719195925_remote_schema.sql",
      "scripts/seed.ts",
      "app/bridge.css",
    ]);
  });

  it("lists files only — a heading is never a row the cursor can land on", () => {
    // A cursor that could land on "AGENT-AUTHORED, NO REVIEW ON GIT'S RECORD"
    // and be asked to explain it would be offering a file that does not exist.
    const shared = term({ ascii: true, columns: 100 });
    const listed = renderSelector(
      initialSelector(cardRows(shared, KINDS_BELOW)),
      shared,
    ).slice(1, -1);
    // Every listed line is a FILE: it opens with a path and closes with the
    // dim clause the card printed beside it. The old form of this assertion
    // looked for the `0.NN` score column, which left the row at 1.5.0 — a
    // comprehension-debt score beside a file selected for going dark reads as
    // the reason it is listed. So the test asks for the property that actually
    // distinguishes a row from a heading: a path, and no shouted group title.
    for (const line of listed) expect(line).toMatch(/\S+\.\w+ {2}/);
    expect(listed.some((line) => /[A-Z]{4,}/.test(line))).toBe(false);
  });

  it("lists at most the five rows the card names", () => {
    // ON A FIXTURE THAT HAS MORE THAN FIVE. This ran on MIXED until 2026-08-11,
    // which holds exactly five dark files — so the cap was never exercised and
    // the test would have stayed green if `darkRows` had returned every file in
    // the tree. KINDS_BELOW has six, so removing the cap now turns this red.
    const shared = term({ ascii: true });
    const { reading } = readingOf(KINDS_BELOW);
    expect(reading.files.filter((file) => file.factors.human_author_recency === 0).length)
      .toBeGreaterThan(TOP_PATHS);

    const rows = cardRows(shared, KINDS_BELOW);
    expect(rows.length).toBe(TOP_PATHS);
    // One blank, five rows, one hint.
    expect(renderSelector(initialSelector(rows), shared).length).toBe(rows.length + 2);
  });

  it("renders nothing when there is nothing to pick", () => {
    expect(renderSelector(initialSelector([]), term())).toEqual([]);
  });
});

describe("the cursor cell", () => {
  const rows = cardRows(term({ ascii: true }));

  it("marks the selected row and only the selected row", () => {
    const shared = term({ ascii: true });
    let state = initialSelector(rows);
    state = stepSelector(state, { kind: "down" }).state;
    const block = renderSelector(state, shared);
    const listed = block.slice(1, -1);

    expect(listed[1].startsWith("> ")).toBe(true);
    for (const index of [0, 2, 3, 4]) {
      expect(listed[index].startsWith(INDENT)).toBe(true);
      expect(listed[index].startsWith("> ")).toBe(false);
    }
  });

  it("is exactly the card's indent wide, so the columns line up", () => {
    // A list shifted one column right of the section it mirrors reads as a
    // second, subtly different list.
    for (const ascii of [true, false]) {
      const shared = term({ ascii });
      const listed = renderSelector(initialSelector(rows), shared).slice(1, -1);
      expect([...listed[0]].length - [...listed[0].slice(INDENT.length)].length).toBe(
        INDENT.length,
      );
      expect(listed[1].slice(0, INDENT.length)).toBe(INDENT);
    }
  });
});

describe("the hint line", () => {
  it("names the keys and what they do, and claims nothing else", () => {
    const text = hintLine(term());
    expect(text).toContain("pick a file");
    expect(text).toContain("enter: factor by factor");
    expect(text).toContain("q: quit");
    // The card's copy rules apply here too: no claim the reading cannot back.
    for (const word of ["risk", "critical", "danger", "worst", "top "]) {
      expect(text.toLowerCase(), `the hint says "${word}"`).not.toContain(word);
    }
  });

  it("is the only thing the picker colours — the rows arrive as the card set them", () => {
    // The rows carry the card's own ink now (the score at its depth, the clause
    // dim), and they must arrive here UNTOUCHED: a picker that re-painted them
    // would be a second rendering of the same file sitting directly under the
    // first. So the assertion is the property — the picker adds a cursor cell
    // and nothing else — rather than "there are no escapes below the hint",
    // which was only ever true because the section above had none either.
    const colored = term({ color: true });
    const rows = cardRows(colored);
    const block = renderSelector(initialSelector(rows), colored);
    block.slice(1, -1).forEach((line, index) => {
      expect(line.slice(INDENT.length)).toBe(rows[index].body);
    });
    expect(block[block.length - 1]).toContain(`${String.fromCharCode(27)}[2m`);
  });

  it("emits no escape at all when colour is off", () => {
    const plain = term();
    const escape = String.fromCharCode(27);
    for (const line of renderSelector(initialSelector(cardRows(plain)), plain)) {
      expect(line).not.toContain(escape);
    }
  });
});

describe("--ascii is total here too", () => {
  it("renders no byte above 0x7f, cursor and arrows included", () => {
    const shared = term({ ascii: true });
    let state = initialSelector(cardRows(shared));
    state = stepSelector(state, { kind: "down" }).state;
    for (const line of renderSelector(state, shared)) {
      const offender = [...line].find((character) => character.charCodeAt(0) > 127);
      expect(offender, `non-ascii ${JSON.stringify(offender)} in: ${line}`).toBeUndefined();
    }
  });

  it("uses the unicode glyphs when it may", () => {
    const shared = term();
    const block = renderSelector(initialSelector(cardRows(shared)), shared);
    expect(block[1].startsWith(shared.glyph("cursor"))).toBe(true);
    expect(hintLine(shared)).toContain(shared.glyph("up"));
    expect(hintLine(shared)).toContain(shared.glyph("down"));
  });
});

describe("the block fits its terminal", () => {
  for (const columns of [80, 100, 132]) {
    it(`no line exceeds ${columns} columns`, () => {
      const shared = term({ ascii: true, columns });
      const block = renderSelector(initialSelector(cardRows(shared)), shared);
      for (const line of block) {
        expect([...line].length, `too wide: ${line}`).toBeLessThanOrEqual(columns);
      }
    });
  }

  it("never emits trailing whitespace", () => {
    const shared = term({ ascii: true });
    for (const line of renderSelector(initialSelector(cardRows(shared)), shared)) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });
});
