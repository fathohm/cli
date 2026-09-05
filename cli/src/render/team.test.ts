import { describe, expect, it } from "vitest";

import {
  LONG_NAMES,
  PROMPTED_ONLY,
  teamOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import type { RenderMeta } from "./meta";
import { renderTeam } from "./team";

/**
 * THE COLUMN BUDGET — the part of the keeper table a golden file cannot pin.
 *
 * The goldens hold the layout on fixtures whose names are `priya` and `sam`.
 * Real repositories are not like that, and every column on this row has to give
 * way in some order when they are not: the bar first, the name column next, the
 * clause never. These are the assertions that say which — and that the column
 * is sized off the LONGEST label rather than the shortest, which is a one-word
 * mistake that a fixture full of short names would never show.
 */

function term(columns: number, ascii = true): Term {
  return createTerm({ noColor: true, ascii, env: {}, isTTY: false, columns });
}

function meta(overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target: "enterprise-platform",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

describe("the name column is sized off the longest label", () => {
  it("gives a wide terminal enough room for the whole name", () => {
    const lines = renderTeam(teamOf(LONG_NAMES), term(132), meta());
    const row = lines.find((line) => line.includes("Konstantin"));
    expect(row, "the keeper row is missing").toBeDefined();
    expect(row).toContain("Konstantin Vasi");
  });

  it("spends the columns on the name before it spends them on the bar", () => {
    // At eighty the clause `· agent-authored, by declared signals` takes half
    // the row, so something has to give. The bar goes first: the share it
    // encodes is printed in figures immediately beside it, and a name cut to
    // six characters on a card whose subject is who is in this history is the
    // one economy this table cannot make.
    const narrow = renderTeam(teamOf(LONG_NAMES), term(80), meta());
    const wide = renderTeam(teamOf(LONG_NAMES), term(132), meta());
    for (const line of narrow) expect(line.length).toBeLessThanOrEqual(80);
    expect(barCells(wide)).toBeGreaterThan(barCells(narrow));
  });

  it("prints names in full under --quiet, where there is no bar to pay for", () => {
    const lines = renderTeam(
      teamOf(PROMPTED_ONLY),
      term(80),
      meta({ quiet: true, target: "prompted-only" }),
    );
    expect(lines.some((line) => line.includes("Ada Lovelace"))).toBe(true);
  });
});

/** The widest run of bar cells anywhere in the rendering. */
function barCells(lines: readonly string[]): number {
  return Math.max(
    0,
    ...lines.map((line) => {
      const run = /[#.]+/.exec(line.replace(/^ {2}\S+/, ""));
      return run === null ? 0 : run[0].length;
    }),
  );
}

/**
 * A long name and a removal that moves nothing printed, on one table: the
 * leave column's worst case. The delta column carries a 29-character sentence,
 * the name is 31 characters, and the row has to fit anyway — by giving the
 * NAME column way, exactly as the keeper table above it does.
 */
const WIDE_LEAVE: ExtractFixture = {
  tree: [
    ["src/app/main.ts", 20000],
    ["src/app/legacy.ts", 20000],
  ],
  commits: [
    {
      daysAgo: 10,
      paths: ["src/app/main.ts"],
      author: {
        name: "Konstantin Vasilevsky-Andersson",
        email: "konstantin.vasilevsky@enterprise-platform.example",
      },
    },
    {
      daysAgo: 400,
      paths: ["src/app/legacy.ts"],
      author: {
        name: "Marguerite Oyelaran-Fitzgerald",
        email: "marguerite.oyelaran@enterprise-platform.example",
      },
    },
  ],
};

describe("the leave table fits its terminal", () => {
  it("gives the name column way rather than overflowing the row", () => {
    const lines = renderTeam(teamOf(WIDE_LEAVE, { full: true }), term(80), meta());
    for (const line of lines) {
      expect(line.length, `too wide: ${line}`).toBeLessThanOrEqual(80);
    }
    // The sentence delta still prints in full — it is the cell that never
    // gives way — and the moves-nothing row is really on this table.
    expect(lines.join("\n")).toContain("moves nothing the card prints");
  });
});

describe("what the no-human clause claims", () => {
  it("states the property, not the authorship, when a file shows no commit", () => {
    const preWindow: ExtractFixture = {
      tree: [
        ["src/old.ts", 9000],
        ["src/new.ts", 3000],
      ],
      commits: [
        {
          daysAgo: 10,
          paths: ["src/new.ts"],
          author: { name: "Claude", email: "noreply@anthropic.com" },
        },
      ],
    };
    const text = renderTeam(teamOf(preWindow, { full: true }), term(100), meta()).join("\n");
    expect(text).toContain("no human engagement in this reading");
    expect(text).not.toContain("agent-authored, by declared signals");
  });
});
