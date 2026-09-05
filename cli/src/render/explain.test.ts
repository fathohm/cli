import { describe, expect, it } from "vitest";

import { BLIND_SPOT_THRESHOLD, scoreFromFactors, WEIGHTS } from "../../../lib/demo-data";
import { GRACE } from "../../test-helpers/fixture-repo";
import {
  ALL_SET_ASIDE,
  KINDS_BELOW,
  MIXED,
  PROMPTED_DOMINANT,
  readingOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { EXIT, isCliError } from "../cmd/errors";
import { holdsAtCeiling } from "../reading/fade";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import { darkFiles, darkRows } from "./below";
import { renderExplain, selectFile } from "./explain";
import { kindRank } from "../reading/kind";
import { ledgerOf } from "./ledger";
import type { RenderMeta } from "./meta";

function term(): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
}

const META: RenderMeta = {
  target: "fixture",
  quiet: false,
  full: false,
  horizonDays: 90,
  scorerVersion: SCORER_VERSION,
};

function explain(path: string, fixture = MIXED): string {
  const { reading } = readingOf(fixture);
  return renderExplain(reading, selectFile(reading, path), term(), META).join("\n");
}

describe("selectFile", () => {
  const { reading } = readingOf(MIXED);

  it("takes the path as written", () => {
    expect(selectFile(reading, "workers/src/scorer.ts").path).toBe("workers/src/scorer.ts");
  });

  it("forgives a leading ./ and a backslash separator", () => {
    expect(selectFile(reading, "./workers/src/scorer.ts").path).toBe("workers/src/scorer.ts");
    expect(selectFile(reading, "workers\\src\\scorer.ts").path).toBe("workers/src/scorer.ts");
  });

  it("takes an unambiguous tail, which is how people type a path they can see", () => {
    expect(selectFile(reading, "src/scorer.ts").path).toBe("workers/src/scorer.ts");
    expect(selectFile(reading, "scorer.ts").path).toBe("workers/src/scorer.ts");
  });

  it("refuses an ambiguous basename rather than guessing which one you meant", () => {
    // `index.ts` exists under both workers/src and cli/src.
    expect(() => selectFile(reading, "index.ts")).toThrowError(/no file named/);
  });

  it("exits 2 with the nearest path — the repository read fine, the argument did not", () => {
    try {
      selectFile(reading, "workers/src/scorrer.ts");
      expect.unreachable("a path that is not in the tree must throw");
    } catch (error) {
      expect(isCliError(error)).toBe(true);
      if (!isCliError(error)) return;
      expect(error.exitCode).toBe(EXIT.usage);
      expect(error.hint).toContain("workers/src/scorer.ts");
    }
  });

  it("points at the surfaces that list paths when nothing is close", () => {
    try {
      selectFile(reading, "nothing/like/this/at/all.rb");
      expect.unreachable("an unrelated path must throw");
    } catch (error) {
      if (!isCliError(error)) throw error;
      expect(error.hint).toContain("fathohm read --full");
    }
  });
});

/**
 * `fathohm explain 3` — the row number the card just printed.
 *
 * The card names five paths and then says "3 more gone dark". A reader
 * looking at that section should not have to retype
 * `supabase/migrations/20260719195925_remote_schema.sql` to open the row under
 * their cursor. So the ordinal is the card's own numbering, and these tests pin
 * it to the card rather than to a literal: if the ordering ever moves, the row
 * and the ordinal move together or this fails.
 */
describe("selectFile by ordinal", () => {
  // KINDS_BELOW, not MIXED. The ordinal's whole subject is that N indexes the
  // ORDER rather than the five printed rows, which is only testable on a
  // fixture whose list is longer than the card. MIXED was that fixture while
  // this list was cut on the comprehension line; at 1.5.0 it holds exactly five
  // dark files, so every case here would have passed vacuously against a list
  // the card prints in full.
  const { reading } = readingOf(KINDS_BELOW);
  const below = darkFiles(reading);
  const rows = darkRows(reading, term());

  it("has a fixture with more dark files than the card shows", () => {
    // The precondition every case under here depends on: five rows printed,
    // more than five dark files, so "indexes the whole list" is testable.
    expect(rows.length).toBe(5);
    expect(below.length).toBeGreaterThan(rows.length);
  });

  it("resolves N to the Nth file of the printed ORDER, not the Nth printed row", () => {
    // The ledger shares five rows across its groups, so the printed rows are a
    // SUBSEQUENCE of the order rather than its head: a small group's row can
    // sit above a big group's fourth file. N indexes the order — the thing
    // `--full` lists in full and the thing that does not change when the card
    // decides how many rows each group gets.
    below.forEach((file, index) => {
      expect(selectFile(reading, String(index + 1)).path).toBe(file.path);
    });
  });

  it("resolves 1 to the row the card leads with, which is the one N is for", () => {
    // The guarantee that survives the sharing-out: row one of the section, the
    // hero line at the top of the card and `explain 1` are one file.
    expect(selectFile(reading, "1").path).toBe(rows[0].file.path);
    expect(selectFile(reading, "1").path).toBe(below[0].path);
  });

  it("numbers every printed row somewhere in the order it lists", () => {
    for (const row of rows) {
      const ordinal = below.findIndex((file) => file.path === row.file.path) + 1;
      expect(ordinal).toBeGreaterThan(0);
      expect(selectFile(reading, String(ordinal)).path).toBe(row.file.path);
    }
  });

  it("indexes the whole list, not the five rows the card printed", () => {
    // `--full` changes what is PRINTED, never what N means. The last dark file
    // is reachable by number from the default card.
    expect(selectFile(reading, String(below.length)).path).toBe(below[below.length - 1].path);
    expect(selectFile(reading, "6").path).toBe(below[5].path);
  });

  it("resolves the same file twice — a numbering that moved would be a trap", () => {
    const first = readingOf(KINDS_BELOW).reading;
    const second = readingOf(KINDS_BELOW).reading;
    for (let n = 1; n <= below.length; n += 1) {
      expect(selectFile(first, String(n)).path).toBe(selectFile(second, String(n)).path);
    }
  });

  it("reads `./3` as a path, not as a row — the shorthand is digits alone", () => {
    // Normalization strips the `./`, so this must not become an ordinal on the
    // way through: somebody who typed a path meant a path.
    expect(() => selectFile(reading, "./3")).toThrowError(/no file named/);
  });

  /**
   * A repository can contain a file called `1`. When it does, the path wins:
   * a positional convenience must never shadow somebody's actual source.
   */
  const NAMED_DIGIT: ExtractFixture = {
    tree: [
      ["1", 900],
      ["src/huge.ts", 40000],
      ["src/small.ts", 1200],
    ],
    commits: [
      { daysAgo: 400, paths: ["1", "src/huge.ts", "src/small.ts"] },
      { daysAgo: 380, paths: ["1", "src/huge.ts", "src/small.ts"], author: GRACE },
    ],
  };

  it("gives an exact path the argument before the ordinal ever sees it", () => {
    const digit = readingOf(NAMED_DIGIT).reading;
    const ordered = darkFiles(digit);
    // The fixture is only interesting if row 1 is NOT the file named `1`.
    expect(ordered[0].path).toBe("src/huge.ts");
    expect(selectFile(digit, "1").path).toBe("1");
    // And the rows the file does not occupy still resolve by number.
    expect(selectFile(digit, "2").path).toBe(ordered[1].path);
  });
});

/**
 * N INDEXES THE DISPLAYED ORDERING.
 *
 * The card puts tests, stylesheets, sql and scripts last, so `explain 1` is
 * whatever the card printed at the top — not the biggest file below the line.
 * A number that meant something the reader could not see on screen would be
 * worse than no number, so this is pinned against the card's own rows rather
 * than against a literal path.
 */
describe("the ordinal counts the card's rows, kinds and all", () => {
  it("resolves 1 to the first row of the first group, not to the biggest file", () => {
    const { reading } = readingOf(KINDS_BELOW);
    const biggest = [...reading.files].sort((a, b) => b.bytes - a.bytes)[0];
    expect(biggest.path).toBe("app/bridge.css");
    expect(kindRank(biggest.path)).toBe(2);

    expect(selectFile(reading, "1").path).toBe("app/api/route.ts");
    expect(selectFile(reading, "2").path).toBe("workers/src/drain.ts");
    // The scaffolding next, then the styles — demotion, never exclusion, so
    // every one of the six is still reachable by number.
    expect(selectFile(reading, "3").path).toBe(
      "supabase/migrations/20260719195925_remote_schema.sql",
    );
    expect(selectFile(reading, "6").path).toBe("cli/src/extract.test.ts");
    expect(darkFiles(reading)).toHaveLength(6);
  });

  it("resolves 1 to the file the card's HERO LINE names", () => {
    // The hero line, the section's first row, the `explain` nudge and this
    // number are one file, or the card is pointing somewhere it did not print.
    const { reading } = readingOf(KINDS_BELOW);
    expect(selectFile(reading, "1").path).toBe(ledgerOf(reading).rows[0].path);
  });

  it("numbers exactly what the card printed, row for row", () => {
    const { reading } = readingOf(KINDS_BELOW);
    darkRows(reading, term()).forEach((row, index) => {
      expect(selectFile(reading, String(index + 1)).path).toBe(row.file.path);
    });
  });

  it("still resolves when every file below the line is a demoted kind", () => {
    // No special case: the tiers run out of application code before they run
    // out of rows, so row 1 is the biggest of the first tier that has anything
    // in it and the numbering carries on as normal.
    const { reading } = readingOf(ALL_SET_ASIDE);
    const ordered = darkFiles(reading);
    expect(ordered.every((file) => kindRank(file.path) > 0)).toBe(true);
    expect(selectFile(reading, "1").path).toBe("db/schema.sql");
    ordered.forEach((file, index) => {
      expect(selectFile(reading, String(index + 1)).path).toBe(file.path);
    });
  });
});

describe("an ordinal outside the list", () => {
  const { reading } = readingOf(MIXED);
  const count = darkFiles(reading).length;

  function refusal(request: string): { message: string; hint: string; code: number } {
    try {
      selectFile(reading, request);
      expect.unreachable(`\`explain ${request}\` must throw`);
    } catch (error) {
      if (!isCliError(error)) throw error;
      return { message: error.message, hint: error.hint ?? "", code: error.exitCode };
    }
  }

  for (const request of ["0", String(count + 1), "-1", "999999"]) {
    it(`refuses ${request} with the range it could have named`, () => {
      const { message, hint, code } = refusal(request);
      // Exit 2: the repository read perfectly well, the argument did not.
      expect(code).toBe(EXIT.usage);
      expect(message).toContain(`no dark row ${Number.parseInt(request, 10)}`);
      expect(hint).toContain(`${count} dark files`);
      expect(hint).toContain(`1 through ${count}`);
    });
  }

  /** Everything above the line: there is no row to number, and it says so. */
  const ALL_ABOVE: ExtractFixture = {
    tree: [
      ["src/a.ts", 2400],
      ["src/b.ts", 1800],
    ],
    commits: [
      { daysAgo: 6, paths: ["src/a.ts", "src/b.ts"] },
      { daysAgo: 4, paths: ["src/a.ts", "src/b.ts"], author: GRACE },
      { daysAgo: 2, paths: ["src/a.ts", "src/b.ts"], merge: true },
    ],
  };

  it("says nothing has gone dark rather than naming an empty range", () => {
    const clean = readingOf(ALL_ABOVE).reading;
    expect(darkFiles(clean)).toEqual([]);
    try {
      selectFile(clean, "1");
      expect.unreachable("an ordinal against an empty list must throw");
    } catch (error) {
      if (!isCliError(error)) throw error;
      expect(error.exitCode).toBe(EXIT.usage);
      expect(error.hint).toContain("nothing in this reading has gone dark");
      expect(error.hint).not.toContain("1 through");
    }
  });
});

describe("the factor table is the whole decomposition", () => {
  const text = explain("workers/src/scorer.ts");

  it("shows all four weighted factors with their weights", () => {
    for (const [key, label] of [
      ["human_review_depth", "human review depth"],
      ["human_author_recency", "human author recency"],
      ["bus_factor", "bus factor"],
      ["question_answerability", "question answerability"],
    ] as const) {
      expect(text).toContain(label);
      expect(text).toContain(WEIGHTS[key].toFixed(2));
    }
  });

  it("prints contributions that add up to the score above them", () => {
    const { reading } = readingOf(MIXED);
    const file = selectFile(reading, "workers/src/scorer.ts");
    expect(text).toContain(file.floor.toFixed(3));
    const sum = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce(
      (total, key) => total + file.factors[key] * WEIGHTS[key],
      0,
    );
    expect(sum).toBeCloseTo(file.floor, 10);
  });

  it("states the line rather than restating its value", () => {
    expect(text).toContain(`the line is ${BLIND_SPOT_THRESHOLD.toFixed(2)}`);
  });
});

describe("what the file's reading means", () => {
  it("says a never-PR-mediated file's interval is a point, and why", () => {
    const text = explain("workers/src/scorer.ts");
    expect(text).toContain("never pull-request mediated");
    expect(text).toContain("its ceiling is its floor");
  });

  it("gives a PR-mediated file the ceiling column and says what earned it", () => {
    const text = explain("src/agents/router.ts", PROMPTED_DOMINANT);
    expect(text).toContain("pull-request mediated");
    expect(text).toContain(WEIGHTS.human_review_depth.toFixed(3));
  });

  it("reuses the reading's own bucket sentence, not a bucket of one file", () => {
    const text = explain("src/agents/router.ts", PROMPTED_DOMINANT);
    expect(text).toContain("in this reading it sits with:");
    expect(text).toContain("of the scored bytes were prompted");
    // A one-file bucket would have printed the file as its own whole world.
    expect(text).not.toContain("100% of the scored bytes were prompted");
  });

  it("distinguishes already-faded from holds-past-the-horizon", () => {
    expect(explain("src/agents/router.ts", PROMPTED_DOMINANT)).toContain(
      "already below the line",
    );
    expect(explain("workers/src/scorer.ts")).toContain("holds past the horizon");
  });

  it("names a fade date when there is one, in days as well as in date", () => {
    const { reading } = readingOf(MIXED);
    const file = selectFile(reading, "workers/src/index.ts");
    expect(file.fadesAt).not.toBeNull();
    const text = explain("workers/src/index.ts");
    expect(text).toContain(`crosses the line on ${file.fadesAt}`);
  });

  it("adds the ceiling-holds line exactly when the computation says so", () => {
    const { reading } = readingOf(MIXED);
    for (const path of ["app/api/route.ts", "workers/src/scorer.ts"]) {
      const file = selectFile(reading, path);
      expect(explain(path).includes("holds if reviews credited")).toBe(holdsAtCeiling(file));
    }
  });

  it("shows the two contacts, and the quarter-credit line only when it is true", () => {
    expect(explain("workers/src/scorer.ts")).toContain("last hand-written:");
    expect(explain("src/agents/router.ts", PROMPTED_DOMINANT)).toContain("prompted-only");
    expect(explain("workers/src/scorer.ts")).not.toContain("prompted-only --");
  });
});


describe("the header carries the file's own reading", () => {
  const ESC = String.fromCharCode(27);
  const INK = new RegExp(`${ESC}\\[38;5;(\\d+)m`);

  function colorTerm() {
    return createTerm({
      env: { FORCE_COLOR: "1" },
      ascii: true,
      isTTY: false,
      columns: 100,
    });
  }

  /** Every 256-colour foreground in a line, in the order they are set. */
  function inks(line: string): number[] {
    const all = line.match(new RegExp(INK.source, "g")) ?? [];
    return all.map((each) => Number(INK.exec(each)?.[1]));
  }

  it("paints the path in the same colour the score line gives its floor", () => {
    // THE CLAIM THE COLOUR MAKES. A reader scrolling back past a stack of
    // `explain` cards should be able to take the verdict off the header without
    // reading the number under it — which is only true if the header and the
    // number agree. Asserted as an EQUALITY between two renderings of the same
    // fact, never as the index either of them happens to be today.
    for (const path of ["workers/src/scorer.ts", "app/page.tsx"]) {
      const { reading } = readingOf(MIXED);
      const file = selectFile(reading, path);
      const lines = renderExplain(reading, file, colorTerm(), META);

      const header = lines[0];
      const score = lines.find((line) => line.includes("score ")) ?? "";

      // The header sets the wordmark's attributes, the scope tag, then the
      // path; the score line sets the floor first. Those two are the pair.
      const headerPath = inks(header).at(-1);
      const scoreFloor = inks(score)[0];

      expect(headerPath).toBeDefined();
      expect(headerPath).toBe(scoreFloor);
    }
  });

  it("says nothing in colour that it does not also say in text", () => {
    // The header is the one line that now carries a reading as pure hue. Under
    // `--no-color` the path is still the path and the score two lines down is
    // still printed, so nothing is lost — this pins that the ink is the only
    // difference between the two renderings.
    const { reading } = readingOf(MIXED);
    const file = selectFile(reading, "workers/src/scorer.ts");
    const painted = renderExplain(reading, file, colorTerm(), META);
    const plain = renderExplain(
      reading,
      file,
      createTerm({ noColor: true, env: {}, ascii: true, isTTY: false, columns: 100 }),
      META,
    );

    const strip = (line: string): string =>
      line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
    expect(painted.map(strip)).toEqual(plain);
  });
});


describe("the factor a repository cannot earn", () => {
  const ESC = String.fromCharCode(27);

  function colorTerm() {
    return createTerm({ env: { FORCE_COLOR: "1" }, ascii: true, isTTY: false, columns: 100 });
  }

  function rowFor(lines: readonly string[], label: string): string {
    const found = lines.find((line) =>
      line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "").trimStart().startsWith(label),
    );
    expect(found, `no row for ${label}`).toBeDefined();
    return found as string;
  }

  const { reading } = readingOf(MIXED);
  const file = selectFile(reading, "workers/src/scorer.ts");

  it("says the score is capped, and says by how much", () => {
    // THE DISCLOSURE. `scoredAnswerability` returns 0 unconditionally since
    // scorer v3, so the arithmetic stops short of 1 on every file in every
    // repository — and this card, whose entire job is decomposing a score, said
    // nothing about it. The gallery caption and the top-driver panel both
    // already exclude the factor for exactly this reason; the CLI was the last
    // surface still presenting it as a reading.
    const text = renderExplain(reading, file, term(), META).join("\n");
    const cap = scoreFromFactors({
      human_review_depth: 1,
      human_author_recency: 1,
      bus_factor: 1,
      question_answerability: 0,
    });

    expect(cap).toBeLessThan(1);
    expect(text).toContain(cap.toFixed(3));
    expect(text).toContain("question answerability reads 0 on every file");
  });

  it("never paints the unearned row from the depth ramp", () => {
    // AN ENCODING THAT NEVER VARIES CARRIES NO INFORMATION. This row is zero on
    // every card that will ever be printed, so a ramp colour on it would be an
    // identical red alarm everywhere, reading as a finding about THIS file. The
    // row is dim — subordinate, not a measurement.
    const row = rowFor(renderExplain(reading, file, colorTerm(), META), "question answerability");

    expect(row).toContain(`${ESC}[2m`);
    expect(row).not.toMatch(/\[38;5;/);
  });

  it("does paint the three the record can move", () => {
    // The other side of the same rule: withholding the scale from every row
    // because ONE row cannot carry it was the mistake this replaced.
    const lines = renderExplain(reading, file, colorTerm(), META);
    for (const label of ["human review depth", "human author recency", "bus factor"]) {
      expect(rowFor(lines, label), label).toMatch(/\[38;5;/);
    }
  });
});
