import { describe, expect, it } from "vitest";

import { ADA, GRACE } from "../../test-helpers/fixture-repo";
import {
  MIXED,
  readingOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { createTerm } from "./term";
import {
  DRILL_SHARE,
  MAX_ROWS,
  QUIET_ROWS,
  miniMapRows,
  renderMiniMap,
  type MiniMapRow,
} from "./minimap";

/** The goldens' terminal: 80 columns, no colour, no unicode. */
function term() {
  return createTerm({ columns: 80, noColor: true, ascii: true, isTTY: false, env: {} });
}

/**
 * THE MINI-MAP'S ROWS — what WHERE is a row of, before anything is drawn.
 *
 * The subject here is the drilldown, and the reason it exists is a reading that
 * answered nothing: a repository keeping everything under `src/` printed one
 * row at 78%, which is the headline again with a bar round it. So a group over
 * `DRILL_SHARE` is replaced by its children until no group dominates or the row
 * budget is spent — and the two properties that were true before have to stay
 * true after: the bars still sum to the whole reading, and the same input
 * renders the same rows.
 *
 * Ordering and folding are asserted here rather than in the golden files
 * because a golden pins one repository's bytes; these pin the rule.
 */

/** A tree, with one commit so the reading is not the empty-repo state. */
function treeOf(tree: ReadonlyArray<readonly [string, number]>): ExtractFixture {
  return { tree, commits: [{ daysAgo: 200, paths: [] }] };
}

function names(fixture: ExtractFixture, maxRows: number = MAX_ROWS): string[] {
  return miniMapRows(readingOf(fixture).reading, maxRows).map((row) => row.name);
}

describe("the drill threshold", () => {
  it("is the exported constant the doc comment names", () => {
    expect(DRILL_SHARE).toBe(0.4);
  });
});

describe("a dominant directory is taken apart", () => {
  it("replaces the row with its children", () => {
    // src/ is 80% of the bytes: one row saying so is the headline again.
    const rows = names(
      treeOf([
        ["src/app/page.ts", 40_000],
        ["src/lib/db.ts", 40_000],
        ["other/x.ts", 20_000],
      ]),
    );
    expect(rows).toEqual(["src/app/", "src/lib/", "other/"]);
  });

  it("stops as soon as nothing dominates, rather than drilling to the floor", () => {
    // Each child lands on exactly 40% — no longer over the line — so the map
    // keeps `src/app/` whole instead of exposing `src/app/routes/`.
    const rows = names(
      treeOf([
        ["src/app/routes/a.ts", 40_000],
        ["src/lib/db/b.ts", 40_000],
        ["other/x.ts", 20_000],
      ]),
    );
    expect(rows).toEqual(["src/app/", "src/lib/", "other/"]);
  });

  it("walks down a chain of single-child directories", () => {
    // Splitting once here would just move the same 90% one level down, which
    // is why the loop repeats rather than running exactly once.
    const rows = names(
      treeOf([
        ["src/main/deep/core.ts", 90_000],
        ["other/x.ts", 10_000],
      ]),
    );
    // It stops at the deepest directory that still has a level below it —
    // `src/main/deep/` holds only loose files, so there is nothing left to
    // split and no `*` row is manufactured for a group of one kind of child.
    expect(rows).toEqual(["src/main/deep/", "other/"]);
  });

  it("gathers files sitting directly in the drilled directory under `*`", () => {
    const rows = names(
      treeOf([
        ["src/index.ts", 50_000],
        ["src/boot.ts", 0],
        ["src/app/page.ts", 30_000],
        ["other/x.ts", 20_000],
      ]),
    );
    // `src/*` is 50% and still not split: there is no level below "the files
    // loose in src/", so a `*` row is a leaf however heavy it is.
    expect(rows).toEqual(["src/*", "src/app/", "other/"]);
  });

  it("never drills the repository root, whatever share it holds", () => {
    const rows = names(
      treeOf([
        ["Dockerfile", 90_000],
        ["src/x.ts", 10_000],
      ]),
    );
    expect(rows).toEqual(["./", "src/"]);
  });
});

describe("the threshold is a STRICT boundary", () => {
  it("leaves a directory holding exactly 40% alone", () => {
    const rows = names(
      treeOf([
        ["src/a/x.ts", 40_000],
        ["b/y.ts", 30_000],
        ["c/z.ts", 30_000],
      ]),
    );
    // Firing on equality would split a mirrored two-directory repository
    // forever, one rounding error at a time.
    expect(rows).toEqual(["src/", "b/", "c/"]);
  });

  it("splits a directory one byte over it", () => {
    const rows = names(
      treeOf([
        ["src/a/x.ts", 40_001],
        ["b/y.ts", 29_999],
        ["c/z.ts", 30_000],
      ]),
    );
    expect(rows).toEqual(["src/a/", "c/", "b/"]);
  });
});

describe("a repository with no dominant directory is unchanged", () => {
  const fixture = treeOf([
    ["a/one.ts", 35_000],
    ["b/two.ts", 35_000],
    ["c/three.ts", 30_000],
  ]);

  it("keeps one row per top-level directory", () => {
    expect(names(fixture)).toEqual(["a/", "b/", "c/"]);
  });

  it("names no row below the top level", () => {
    for (const name of names(fixture)) {
      expect(name.split("/").filter((segment) => segment !== "")).toHaveLength(1);
    }
  });

  it("holds for the real mixed reading too", () => {
    // fathohm's shape: four top-level directories, none of them dominant.
    expect(miniMapRows(readingOf(MIXED).reading).every((row) => row.name.split("/").length <= 2))
      .toBe(true);
  });
});

describe("the bars still add up to the whole reading", () => {
  const drilled = treeOf([
    ["src/app/page.ts", 44_000],
    ["src/app/api/route.ts", 12_000],
    ["src/lib/db.ts", 19_000],
    ["src/boot.ts", 5_000],
    ["other/x.ts", 20_000],
  ]);

  for (const [label, fixture] of [
    ["a drilled repository", drilled],
    ["an undrilled one", MIXED],
  ] as const) {
    it(`sums to the scored bytes on ${label}`, () => {
      const { reading } = readingOf(fixture);
      const rows = miniMapRows(reading);
      expect(rows.reduce((sum, row) => sum + row.bytes, 0)).toBe(reading.scoredBytes);
      expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 10);
    });
  }

  it("keeps every row's dark share a byte-weighted fraction of the files under it", () => {
    // `score` (the byte-weighted mean comprehension score) left the row at
    // 1.5.0; `darkShare` replaced it, because the headline over the map is the
    // dark share and a bar ramping on a different quantity than the number
    // above it is two scales on one card. The BOUND is the property this test
    // has always defended: a fraction, never a percentage and never NaN on an
    // empty group.
    const { reading } = readingOf(drilled);
    for (const row of miniMapRows(reading)) {
      expect(row.darkShare).toBeGreaterThanOrEqual(0);
      expect(row.darkShare).toBeLessThanOrEqual(1);
    }
  });
});

describe("the fold row survives the drilldown", () => {
  // Four groups after the split, against a three-row budget.
  const fixture = treeOf([
    ["src/a/1.ts", 30_000],
    ["src/b/2.ts", 25_000],
    ["src/c/3.ts", 20_000],
    ["other/x.ts", 25_000],
  ]);

  it("folds the tail rather than dropping it", () => {
    const rows = miniMapRows(readingOf(fixture).reading, 3);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.name)).toEqual(["src/a/", "other/", ""]);
    expect(rows[2].directoryCount).toBe(2);
    expect(rows[2].bytes).toBe(45_000);
  });

  it("still sums to the whole, which is the entire reason for folding", () => {
    const { reading } = readingOf(fixture);
    const rows = miniMapRows(reading, 3);
    expect(rows.reduce((sum, row) => sum + row.bytes, 0)).toBe(reading.scoredBytes);
  });

  it("spends the row budget before it spends the drilldown", () => {
    // Two top-level groups against a two-row budget: no room to split, and
    // nothing to fold either. The dominant row stays whole rather than being
    // taken apart into rows the terminal has no space for.
    expect(miniMapRows(readingOf(fixture).reading, 2).map((row) => row.name)).toEqual([
      "src/",
      "other/",
    ]);
  });
});

describe("how much of THIS row is below the line", () => {
  /**
   * The row's own denominator, and the only second one on the card.
   *
   * The bar and the percentage beside it are shares of the repository; this is
   * a share of the directory. Without it the block ramp is the row's only
   * quality signal, and an average hides its own distribution — a folder of one
   * pristine file and one abandoned one reads as "fine".
   */
  const SPLIT: ExtractFixture = {
    tree: [
      ["fresh/a.ts", 1000],
      ["fresh/b.ts", 1000],
      ["stale/c.ts", 1000],
      ["stale/d.ts", 3000],
    ],
    commits: [
      { daysAgo: 400, paths: ["stale/c.ts", "stale/d.ts"], prompted: true },
      { daysAgo: 3, paths: ["fresh/a.ts", "fresh/b.ts"], author: ADA },
      { daysAgo: 2, paths: ["fresh/a.ts", "fresh/b.ts"], author: GRACE },
    ],
  };

  it("is the row's OWN dark bytes over the row's own bytes", () => {
    const rows = miniMapRows(readingOf(SPLIT).reading);
    const stale = rows.find((row) => row.name === "stale/") as MiniMapRow;
    const fresh = rows.find((row) => row.name === "fresh/") as MiniMapRow;
    expect(stale.darkShare).toBe(1);
    expect(fresh.darkShare).toBe(0);
  });

  it("is a share of the DIRECTORY, never of the repository", () => {
    // `stale/` is 4000 of 6000 bytes — two thirds of the reading — and all of
    // it is dark. The two numbers on the row are different questions.
    const stale = miniMapRows(readingOf(SPLIT).reading).find(
      (row) => row.name === "stale/",
    ) as MiniMapRow;
    expect(stale.share).toBeCloseTo(4 / 6, 10);
    expect(stale.darkShare).toBe(1);
  });

  it("weighs the fold row by bytes, like every other average here", () => {
    const many: ExtractFixture = {
      tree: Array.from({ length: MAX_ROWS + 4 }, (_unused, index) => [
        `d${index}/f.ts`,
        1000,
      ] as const),
      commits: [
        {
          daysAgo: 400,
          paths: Array.from({ length: MAX_ROWS + 4 }, (_unused, index) => `d${index}/f.ts`),
          prompted: true,
        },
      ],
    };
    const rows = miniMapRows(readingOf(many).reading);
    const fold = rows[rows.length - 1];
    expect(fold.directoryCount).toBeGreaterThan(1);
    expect(fold.darkShare).toBe(1);
  });

  it("says zero rather than nothing when a directory is entirely lit", () => {
    const fresh = miniMapRows(readingOf(SPLIT).reading).find(
      (row) => row.name === "fresh/",
    ) as MiniMapRow;
    // A blank would read as "not measured", which is the one thing it is not.
    expect(fresh.darkShare).toBe(0);
  });
});

describe("determinism", () => {
  it("renders identical rows for the same reading, twice", () => {
    for (const fixture of [
      MIXED,
      treeOf([
        ["src/app/page.ts", 60_000],
        ["src/app/api/route.ts", 20_000],
        ["src/index.ts", 8_000],
        ["other/x.ts", 12_000],
      ]),
    ]) {
      const { reading } = readingOf(fixture);
      expect(miniMapRows(reading)).toEqual(miniMapRows(reading));
    }
  });

  it("breaks a byte tie on name, not on the order the tree listed", () => {
    // A mirrored tree makes equal-weight siblings routinely; "whichever git
    // named first" is exactly the ordering luck the contract forbids.
    const rows = names(
      treeOf([
        ["src/zeta/z.ts", 30_000],
        ["src/alpha/a.ts", 30_000],
        ["other/x.ts", 40_000],
      ]),
    );
    expect(rows).toEqual(["other/", "src/alpha/", "src/zeta/"]);
  });
});

/**
 * A COLUMN OF ZEROS IS NOT TWELVE FACTS.
 *
 * With nothing dark anywhere, every row's clause reads `0% dark` and the two
 * encodings collapse to one — the block ramp has no direction left to show. On
 * the founder's own repository that printed twelve identical clauses under a
 * legend explaining a second encoding no row carried, and it was the largest
 * block on a card whose whole finding was that there was nothing to find.
 */
describe("a reading with nothing dark draws a size chart, not a dark map", () => {
  const lit: ExtractFixture = {
    tree: [
      ["src/a.ts", 40_000],
      ["src/b.ts", 30_000],
      ["lib/c.ts", 20_000],
      ["docs/d.ts", 10_000],
      ["one/e.ts", 400],
      ["two/f.ts", 300],
      ["three/g.ts", 200],
      ["four/h.ts", 100],
    ],
    // Every path touched inside the 180-day window, so nothing here is dark.
    commits: [
      {
        daysAgo: 3,
        author: ADA,
        paths: [
          "src/a.ts",
          "src/b.ts",
          "lib/c.ts",
          "docs/d.ts",
          "one/e.ts",
          "two/f.ts",
          "three/g.ts",
          "four/h.ts",
        ],
      },
    ],
  };

  it("is the fixture it claims to be", () => {
    expect(readingOf(lit).reading.darkBytes).toBe(0);
    expect(readingOf(MIXED).reading.darkBytes).toBeGreaterThan(0);
  });

  it("drops the dark clause from every row", () => {
    const { reading } = readingOf(lit);
    const rows = renderMiniMap(reading, term());
    for (const row of rows) expect(row).not.toMatch(/dark$/);
  });

  it("keeps the clause when there IS something dark to compare", () => {
    const rows = renderMiniMap(readingOf(MIXED).reading, term());
    expect(rows.every((row) => /\d dark$|% dark$/.test(row))).toBe(true);
  });

  it("spends fewer rows on it, and says the folded ones are clean too", () => {
    const rows = renderMiniMap(readingOf(lit).reading, term());
    expect(rows).toHaveLength(QUIET_ROWS);
    expect(rows[QUIET_ROWS - 1]).toContain("more, none dark");
  });

  it("still folds rather than truncates: the bars sum to the whole reading", () => {
    const { reading } = readingOf(lit);
    const rows = miniMapRows(reading, QUIET_ROWS);
    const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    expect(bytes).toBe(reading.scoredBytes);
  });
});
