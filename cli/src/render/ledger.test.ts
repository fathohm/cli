import { describe, expect, it } from "vitest";

import { exactBlindShare, formatBlindShare } from "../../../lib/blind-share-format";
import { BLIND_SPOT_THRESHOLD, scoreFromFactors } from "../../../lib/demo-data";
import { darkBytesOf, darkReasonOf, isDark, newestContact } from "../reading/dark";
import type { ScoredFile } from "../reading/scoring";
import {
  ALL_SET_ASIDE,
  KINDS_BELOW,
  MANY_CROSSINGS,
  MIXED,
  PROMPTED_DOMINANT,
  PROMPTED_ONLY,
  SHALLOW,
  SQUASH_ONLY,
  readingOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { byDisplayOrder, kindRank } from "../reading/kind";
import { reviewedBlindShare } from "../reading/counterfactual";
import { TOP_PATHS, allocateRows, ledgerOf } from "./ledger";

/**
 * THE LEDGER MUST ADD UP.
 *
 * This is the file the whole ledger rests on. A decomposition that does not sum
 * to the number above it does not merely look untidy — it refutes the one claim
 * this product makes, which is that its screenshots are checkable. So the sums
 * are asserted twice over, on every fixture the card has: once in BYTES, where
 * the partition either is total or is not, and once in the PRINTED integers,
 * where a reader with a calculator is going to check it.
 *
 * WHAT THE COLUMN ADDS UP TO CHANGED AT 1.5.0 AND THESE ASSERTIONS DID NOT.
 * The ledger used to decompose the FLOOR BLIND BYTES into `explainReading`'s
 * below-the-line buckets; it now decomposes the DARK BYTES into `darkGroups` —
 * the same predicate the card headlines, `human_author_recency === 0`. So every
 * "below the line" in this file became "dark", `reading.floorBlindBytes` became
 * `reading.darkBytes`, `group.bucket` became `group.group` and `ledger.above`
 * became `ledger.lit`. Nothing about the ARITHMETIC moved, which is the point:
 * the property being defended was never "the buckets add up", it was "the
 * printed decomposition adds up to the printed headline", and that survives a
 * change of what is being decomposed.
 *
 * THE TOTALITY IS ASSERTED AGAINST `reading.files` DIRECTLY, never against the
 * ledger's own idea of what the repository contains. A guardrail that summed
 * the groups and compared them to a number the same module computed would pass
 * on a partition that had quietly dropped a reason.
 */

/**
 * ONE FILE PER REASON, AT EXACTLY A THIRD EACH — the shape none of the shared
 * fixtures has, because a repository built to exercise the SCORE spreads its
 * files across the line rather than across the dark reasons.
 *
 * `src/imported.ts` is in the tree and in no commit at all, which is how a file
 * reaches `never`: the record carries no human hand on it, hand-written or
 * prompted. That is the import-commit case `darkLedgerLine` is careful to phrase
 * as "in git's record" rather than "never".
 */
const THREE_REASONS: ExtractFixture = {
  tree: [
    ["src/hand.ts", 3000],
    ["src/prompted.ts", 3000],
    ["src/imported.ts", 3000],
  ],
  commits: [
    { daysAgo: 400, paths: ["src/hand.ts"] },
    { daysAgo: 400, paths: ["src/prompted.ts"], prompted: true },
  ],
};

/** All but a sliver dark: the dark group is inside `>99` and the coda inside `<1`. */
const ALL_BUT_A_SLIVER: ExtractFixture = {
  tree: [
    ["src/legacy.ts", 100000],
    ["src/live.ts", 50],
  ],
  commits: [
    { daysAgo: 400, paths: ["src/legacy.ts"] },
    { daysAgo: 3, paths: ["src/live.ts"] },
  ],
};

/** The mirror: a sliver dark, so the floors land on the other row. */
const A_SLIVER_DARK: ExtractFixture = {
  tree: [
    ["src/live.ts", 100000],
    ["src/legacy.ts", 50],
  ],
  commits: [
    { daysAgo: 400, paths: ["src/legacy.ts"] },
    { daysAgo: 3, paths: ["src/live.ts"] },
  ],
};

/**
 * A floored group BESIDE two ordinary ones — the case the floors' exception has
 * to be narrow enough to survive. 62.4% + 0.12% + 37.5%: the tiny group prints
 * `<1%` and takes no unit, and the two rows that CAN show their integers still
 * add to a hundred on the screen.
 */
const A_FLOORED_GROUP: ExtractFixture = {
  tree: [
    ["src/legacy.ts", 100000],
    ["src/tiny.ts", 200],
    ["src/live.ts", 60000],
  ],
  commits: [
    { daysAgo: 400, paths: ["src/legacy.ts"] },
    { daysAgo: 400, paths: ["src/tiny.ts"], prompted: true },
    { daysAgo: 3, paths: ["src/live.ts"] },
  ],
};

/**
 * EXACTLY 74.5 DARK — the arrangement the coda's remainder rule exists for.
 *
 * Two complementary shares rounded independently can both be correct and still
 * print 101: 74.5 and 25.5 round to 75 and 26. The coda takes what is left of a
 * hundred instead, so the column closes at 75 and 25.
 */
const A_HALF_UNIT: ExtractFixture = {
  tree: [
    ["src/legacy.ts", 7450],
    ["src/live.ts", 2550],
  ],
  commits: [
    { daysAgo: 400, paths: ["src/legacy.ts"] },
    { daysAgo: 3, paths: ["src/live.ts"] },
  ],
};

/**
 * TWO GROUPS BOTH BIG ENOUGH TO FILL THE CARD — the only shape that can tell
 * "five rows shared by weight" apart from "the first five of the ordering".
 *
 * Six faded-hand files against two faded-prompted ones, three quarters of the
 * bytes to one quarter, so the budget splits four and one. Take the first five
 * of the order instead and the second heading prints with nothing under it,
 * which is a group asserting a finding and then declining to evidence it.
 */
const ROW_SHARING: ExtractFixture = {
  tree: [
    ["src/a.ts", 10000],
    ["src/b.ts", 10000],
    ["src/c.ts", 10000],
    ["src/d.ts", 10000],
    ["src/e.ts", 10000],
    ["src/f.ts", 10000],
    ["lib/x.ts", 10000],
    ["lib/y.ts", 10000],
  ],
  commits: [
    {
      daysAgo: 400,
      paths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"],
    },
    { daysAgo: 400, paths: ["lib/x.ts", "lib/y.ts"], prompted: true },
  ],
};

/** Hand-written long ago, prompted since: the newest contact is the prompt. */
const PROMPTED_SINCE: ExtractFixture = {
  tree: [["src/old.ts", 1000]],
  commits: [
    { daysAgo: 900, paths: ["src/old.ts"] },
    { daysAgo: 300, paths: ["src/old.ts"], prompted: true },
  ],
};

/** The mirror: prompted long ago, hand-written since. */
const HAND_WRITTEN_SINCE: ExtractFixture = {
  tree: [["src/old.ts", 1000]],
  commits: [
    { daysAgo: 900, paths: ["src/old.ts"], prompted: true },
    { daysAgo: 300, paths: ["src/old.ts"] },
  ],
};

/**
 * EVERY GUARDRAIL RUNS OVER BOTH LISTS, and the second list is not optional.
 *
 * The shared fixtures are built to exercise the SCORE — files spread across the
 * line, in the shapes real repositories have. Cut on the dark predicate every
 * one of them collapses to a SINGLE group and no display floor: one commit is
 * one kind of contact, so a fixture whose history is one prompt is one reason.
 * A totality guardrail that only ever saw one group would pass on a partition
 * that had dropped a reason, and a floor guardrail that never reached a floor
 * would be asserting the empty set. So the shapes the dark cut needs are
 * fixtures here in their own right and go round the same loops.
 */
const FIXTURES: ReadonlyArray<{ name: string; fixture: ExtractFixture }> = [
  { name: "mixed", fixture: MIXED },
  { name: "prompted-dominant", fixture: PROMPTED_DOMINANT },
  { name: "prompted-only", fixture: PROMPTED_ONLY },
  { name: "shallow", fixture: SHALLOW },
  { name: "squash-only", fixture: SQUASH_ONLY },
  { name: "kinds-below", fixture: KINDS_BELOW },
  { name: "all-set-aside", fixture: ALL_SET_ASIDE },
  { name: "many-crossings", fixture: MANY_CROSSINGS },
  { name: "three-reasons", fixture: THREE_REASONS },
  { name: "all-but-a-sliver", fixture: ALL_BUT_A_SLIVER },
  { name: "a-sliver-dark", fixture: A_SLIVER_DARK },
  { name: "a-floored-group", fixture: A_FLOORED_GROUP },
  { name: "row-sharing", fixture: ROW_SHARING },
  { name: "a-half-unit", fixture: A_HALF_UNIT },
  { name: "prompted-since", fixture: PROMPTED_SINCE },
  { name: "hand-written-since", fixture: HAND_WRITTEN_SINCE },
];

/** A printed share as the units it claims: the two display floors included. */
function unitsOf(printed: string): number {
  const value = printed.replace(/[%]/g, "");
  if (value === "<1") return 0;
  if (value === ">99") return 99;
  return Number.parseInt(value, 10);
}

/** The printed headline the whole column is allocated under. */
function printedHeadline(reading: { darkBytes: number; scoredBytes: number }): string {
  return formatBlindShare(exactBlindShare(reading.darkBytes, reading.scoredBytes));
}

/**
 * The byte-weighted LIT fraction of a file set, computed here the long way
 * round — through the exported predicate, over the bytes the files carry — so
 * the assertion is a second derivation of the quantity rather than a repeat of
 * the module's own call.
 */
function litFractionOf(files: readonly ScoredFile[]): number {
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (bytes <= 0) return 0;
  return 1 - darkBytesOf(files) / bytes;
}

/** Every row the card's column contains: the dark groups, then the coda. */
function printedRows(ledger: ReturnType<typeof ledgerOf>) {
  return [
    ...ledger.groups.map((group) => ({
      printed: group.printed,
      units: group.units,
      share: group.group.share,
    })),
    ...(ledger.lit === null
      ? []
      : [{ printed: ledger.lit.printed, units: ledger.lit.units, share: ledger.lit.group.share }]),
  ];
}

describe("the partition guardrail — bytes", () => {
  for (const { name, fixture } of FIXTURES) {
    it(`${name}: every scored file is in exactly one group or the coda`, () => {
      // TOTAL AND DISJOINT, asserted against `reading.files` itself. This is the
      // load-bearing property of the whole ledger: `darkReasonOf` is a total
      // function with no null case, so "the groups plus the coda are the
      // repository" is arithmetic rather than a promise — and a partition that
      // dropped a reason would show up here as a missing path, not as a rounded
      // percentage nobody notices.
      const { reading } = readingOf(fixture);
      const ledger = ledgerOf(reading);
      const listed = [
        ...ledger.groups.flatMap((group) => group.files),
        ...(ledger.lit === null ? [] : ledger.lit.group.files),
      ].map((file) => file.path);
      expect(new Set(listed).size).toBe(listed.length);
      expect([...listed].sort()).toEqual(reading.files.map((file) => file.path).sort());
    });

    it(`${name}: the shares of the whole partition sum to one`, () => {
      // The same statement in the units the printed column is allocated from.
      // Exact-value arithmetic, so a group whose share was computed against a
      // denominator of its own would fail here rather than at the third decimal
      // place of something a reader sees.
      const { reading } = readingOf(fixture);
      const ledger = ledgerOf(reading);
      const shares = printedRows(ledger).reduce((sum, row) => sum + row.share, 0);
      expect(shares).toBeCloseTo(1, 12);
    });

    it(`${name}: the groups' bytes ARE the dark bytes, exactly`, () => {
      // Byte arithmetic, not shares: this is the property that makes every
      // printed sum below it possible, and it is either exact or broken. The
      // numerator is `reading.darkBytes` — the card's own headline numerator,
      // summed by the scorer in the same pass as the blind bytes.
      const { reading } = readingOf(fixture);
      const ledger = ledgerOf(reading);
      const grouped = ledger.groups.reduce((sum, group) => sum + group.group.bytes, 0);
      expect(grouped).toBe(reading.darkBytes);
    });

    it(`${name}: the groups plus the coda ARE the repository`, () => {
      const { reading } = readingOf(fixture);
      const ledger = ledgerOf(reading);
      const grouped = ledger.groups.reduce((sum, group) => sum + group.group.bytes, 0);
      const lit = ledger.lit === null ? 0 : ledger.lit.group.bytes;
      expect(grouped + lit).toBe(reading.scoredBytes);
    });

    it(`${name}: every dark file is in exactly one group, and no lit file is`, () => {
      const { reading } = readingOf(fixture);
      const ledger = ledgerOf(reading);
      const dark = reading.files.filter(isDark);
      const listed = ledger.groups.flatMap((group) => group.files.map((file) => file.path));
      expect(new Set(listed).size).toBe(listed.length);
      expect([...listed].sort()).toEqual(dark.map((file) => file.path).sort());
      // The coda is lifted out of the groups rather than printed among them —
      // a lit group in the dark column would be the decomposition contradicting
      // the heading it sits under.
      expect(ledger.groups.map((group) => group.group.id)).not.toContain("lit");
      if (ledger.lit !== null) {
        for (const file of ledger.lit.group.files) expect(isDark(file)).toBe(false);
      }
    });
  }

  it("the coda is null exactly when nothing in the repository is lit", () => {
    // Not "when the share rounds to zero": a repository with one fresh file in
    // it has a coda, and the ledger's sum needs the row even when it prints a
    // floor. `kinds-below` is wholly dark; `mixed` is not.
    expect(ledgerOf(readingOf(KINDS_BELOW).reading).lit).toBeNull();
    expect(ledgerOf(readingOf(MIXED).reading).lit).not.toBeNull();
    expect(ledgerOf(readingOf(A_SLIVER_DARK).reading).lit).not.toBeNull();
  });
});

describe("the partition guardrail — the printed integers", () => {
  for (const { name, fixture } of FIXTURES) {
    it(`${name}: the printed group shares sum to the printed headline`, () => {
      // The headline is the AUTHORITY and it is computed here the way the card
      // computes it — `formatBlindShare` over the dark bytes — rather than read
      // back off the ledger, so a ledger that allocated under its own idea of
      // the headline would fail rather than agree with itself.
      const { reading } = readingOf(fixture);
      const ledger = ledgerOf(reading);
      const printed = ledger.groups.reduce((sum, group) => sum + unitsOf(group.printed), 0);
      expect(printed).toBe(unitsOf(printedHeadline(reading)));
    });

    it(`${name}: the allocated units always sum to a hundred`, () => {
      const ledger = ledgerOf(readingOf(fixture).reading);
      const grouped = ledger.groups.reduce((sum, group) => sum + group.units, 0);
      expect(grouped + (ledger.lit === null ? 0 : ledger.lit.units)).toBe(100);
    });

    it(`${name}: the printed groups and coda sum to a hundred, floors excepted`, () => {
      // The floors are the ONE exception and they are exactly characterised: a
      // row prints something other than its units only when its exact share is
      // inside `<1` or `>99`, where an integer claim would be a lie in the
      // other direction. Everywhere else the visible column must add up.
      const ledger = ledgerOf(readingOf(fixture).reading);
      const rows = printedRows(ledger);
      const floored = rows.filter(
        (row) => row.printed.startsWith("<") || row.printed.startsWith(">"),
      );
      for (const row of floored) {
        const percent = row.share * 100;
        expect(percent > 0 && percent < 1, row.printed).toBe(row.printed.startsWith("<"));
        expect(percent > 99 && percent < 100, row.printed).toBe(row.printed.startsWith(">"));
      }
      if (floored.length === 0) {
        expect(rows.reduce((sum, row) => sum + unitsOf(row.printed), 0)).toBe(100);
      }
    });
  }

  it("three reasons of a third each print 34, 33, 33 rather than three lost units", () => {
    // The case that made the allocation necessary: independent rounding prints
    // 33 three times and a reader counts 99 against a headline of 100.
    //
    // It takes a purpose-built fixture now. Cut on the LINE, three files under
    // one 400-day-old commit landed in three different buckets; cut on the DARK
    // predicate they are one group, because one commit is one kind of contact.
    // Three reasons need three histories — a hand, a prompt, and a file git has
    // no human record of at all.
    const ledger = ledgerOf(readingOf(THREE_REASONS).reading);
    expect(ledger.groups).toHaveLength(3);
    const units = ledger.groups.map((group) => unitsOf(group.printed));
    expect(units.reduce((sum, unit) => sum + unit, 0)).toBe(100);
    // Allocated, not rounded: the leftover unit lands on ONE group rather than
    // being spread or dropped, so no two rows differ by more than a unit.
    expect(Math.max(...units) - Math.min(...units)).toBeLessThanOrEqual(1);
  });

  it("prints the coda as the remainder, so 74.5 and 25.5 never read 101", () => {
    // The coda is NOT `formatBlindShare` of the lit group. Two complementary
    // shares rounded independently can both be right and still overshoot the
    // hundred, and closing the sum is the one thing this line exists to do.
    const { reading } = readingOf(A_HALF_UNIT);
    const ledger = ledgerOf(reading);
    expect(exactBlindShare(reading.darkBytes, reading.scoredBytes)).toBe(74.5);
    expect(unitsOf(ledger.groups[0].printed) + unitsOf((ledger.lit as { printed: string }).printed))
      .toBe(100);
    // And the headline is the authority: the dark row keeps the value the card
    // prints at hero size, so the give is on the coda's side.
    expect(ledger.groups[0].printed).toBe(printedHeadline(reading));
  });

  it("carries all three reasons, in rule order, when their bytes tie", () => {
    // `faded-hand` first: a file humans once wrote by hand and then left is the
    // finding a reader can act on. The tie-break is what makes a small
    // repository's ledger print the same way twice.
    expect(ledgerOf(readingOf(THREE_REASONS).reading).groups.map((group) => group.group.id)).toEqual(
      ["faded-hand", "faded-prompted", "never"],
    );
  });
});

describe("the display floors survive the allocation", () => {
  /*
   * WHAT USED TO STAND HERE was the same pair of assertions against
   * PROMPTED_DOMINANT, which was 99%+ below the line. Cut on the dark predicate
   * that repository is 16% dark — agent-written throughout, but prompted inside
   * the window, which is exactly the difference the 1.5.0 headline exists to
   * report. So the floors get fixtures that actually reach them; the property
   * is unchanged and is asserted at both ends of the scale rather than one.
   */

  it("a repository all but a sliver dark prints both floors, not both absolutes", () => {
    const ledger = ledgerOf(readingOf(ALL_BUT_A_SLIVER).reading);
    expect(ledger.groups.map((group) => group.printed)).toContain(">99%");
    expect(ledger.lit).not.toBeNull();
    expect((ledger.lit as { printed: string }).printed).toBe("<1%");
    // The UNITS still balance — 99 and 1 — while the text shows both floors
    // rather than the absolutes (`100%` beside `0%`) they have not earned: one
    // would claim a codebase with no human hand anywhere in it.
    expect(ledger.groups[0].units).toBe(99);
    expect((ledger.lit as { units: number }).units).toBe(1);
  });

  it("a sliver of dark takes no unit it cannot show", () => {
    // The mirror, and the strict half of the rule: a group inside `<1` is
    // PINNED to the units its floor can defend rather than handed a remainder
    // unit that would vanish between the number and the text.
    const ledger = ledgerOf(readingOf(A_SLIVER_DARK).reading);
    expect(ledger.groups[0].printed).toBe("<1%");
    expect(ledger.groups[0].units).toBe(0);
    expect((ledger.lit as { printed: string }).printed).toBe(">99%");
    expect((ledger.lit as { units: number }).units).toBe(100);
  });

  it("a floored group leaves the rows that can show their integers adding up", () => {
    const ledger = ledgerOf(readingOf(A_FLOORED_GROUP).reading);
    const rows = printedRows(ledger);
    const floored = rows.filter((row) => row.printed.startsWith("<"));
    expect(floored).toHaveLength(1);
    expect(floored[0].units).toBe(0);
    const shown = rows.filter((row) => !row.printed.startsWith("<"));
    expect(shown.reduce((sum, row) => sum + unitsOf(row.printed), 0)).toBe(100);
  });

  it("never prints an absolute a repository has not earned", () => {
    for (const { fixture } of FIXTURES) {
      for (const row of printedRows(ledgerOf(readingOf(fixture).reading))) {
        const percent = row.share * 100;
        if (percent > 0 && percent < 1) expect(row.printed).toBe("<1%");
        if (percent > 99 && percent < 100) expect(row.printed).toBe(">99%");
      }
    }
  });
});

describe("the row budget", () => {
  it("shares five rows across the groups by weight", () => {
    expect(allocateRows(
      [
        { bytes: 800, fileCount: 10 },
        { bytes: 200, fileCount: 10 },
      ],
      5,
    )).toEqual([4, 1]);
  });

  it("never asks a group for more rows than it holds", () => {
    // The one-file group takes its one row and the rest go to the neighbour,
    // rather than being lost to a cap.
    expect(allocateRows(
      [
        { bytes: 900, fileCount: 1 },
        { bytes: 100, fileCount: 9 },
      ],
      5,
    )).toEqual([1, 4]);
  });

  it("stops when the groups run out of files rather than looping", () => {
    expect(allocateRows([{ bytes: 900, fileCount: 2 }], 5)).toEqual([2]);
  });

  it("falls back to counting files when there are no bytes to weigh", () => {
    // A REPOSITORY OF EMPTY FILES IS NOT A REPOSITORY WITH NOTHING TO SAY.
    // Byte-share is the right weight whenever there are bytes, and it silently
    // becomes the wrong one at zero: a dark group of three empty files got
    // three files, a heading, and zero rows under it — the card naming a group
    // and then refusing to name any of its members. Worse, `--full` listed the
    // very files the ledger had just declined to show, so the two halves of one
    // card disagreed about whether anything was there.
    //
    // File count is the only weight left when every byte is zero, and it is the
    // one a reader would use: three files with nothing in them still take three
    // rows, because the row's job here is to name a path.
    expect(allocateRows([{ bytes: 0, fileCount: 3 }], 5)).toEqual([3]);
    // Still bounded by the budget, and still bounded by what each group holds.
    expect(allocateRows([{ bytes: 0, fileCount: 9 }], 5)).toEqual([5]);
    expect(allocateRows(
      [
        { bytes: 0, fileCount: 1 },
        { bytes: 0, fileCount: 8 },
      ],
      5,
    )).toEqual([1, 4]);
    // Nothing to weigh and nothing to name stays empty.
    expect(allocateRows([], 5)).toEqual([]);
    expect(allocateRows([{ bytes: 0, fileCount: 0 }], 5)).toEqual([0]);
  });

  it("shares the five across the groups rather than taking the first five", () => {
    // NOT the head of the ordering. The budget is shared by weight, so a small
    // group's row sits below a big group's fourth file and the big group's
    // fifth is left to `--full` — the guarantee that every heading the card
    // prints has evidence under it.
    const ledger = ledgerOf(readingOf(ROW_SHARING).reading);
    expect(ledger.groups.map((group) => group.rowCount)).toEqual([4, 1]);
    expect(ledger.rows.length).toBe(TOP_PATHS);
    // The proof that the two rules differ on this reading: the first group
    // holds more files than it printed, so "the first five" would have printed
    // five of ITS files and none of the second group's.
    expect(ledger.groups[0].files.length).toBeGreaterThan(ledger.groups[0].rowCount);
    expect(ledger.rows.map((file) => file.path)).not.toEqual(
      ledger.order.slice(0, TOP_PATHS).map((file) => file.path),
    );
  });

  for (const { name, fixture } of FIXTURES) {
    it(`${name}: prints at most five rows, and never more than a group holds`, () => {
      const ledger = ledgerOf(readingOf(fixture).reading);
      expect(ledger.rows.length).toBeLessThanOrEqual(TOP_PATHS);
      for (const group of ledger.groups) {
        expect(group.rowCount).toBeLessThanOrEqual(group.files.length);
      }
      if (ledger.order.length >= TOP_PATHS) expect(ledger.rows.length).toBe(TOP_PATHS);
      else expect(ledger.rows.length).toBe(ledger.order.length);
    });

    it(`${name}: row one is the first file of the first group`, () => {
      // The hero line, the `explain` nudge and `explain 1` all name this file.
      const ledger = ledgerOf(readingOf(fixture).reading);
      if (ledger.rows.length === 0) return;
      expect(ledger.rows[0]).toBe(ledger.order[0]);
      expect(ledger.groups[0].rowCount).toBeGreaterThan(0);
    });
  }
});

describe("the print order", () => {
  for (const { name, fixture } of FIXTURES) {
    it(`${name}: order IS the full dark set, group by group`, () => {
      // The FULL set, not the printed rows: `fathohm explain 7` resolves the
      // seventh entry of this ordering on a card that printed five, so an
      // `order` truncated to what fits would renumber the files a reader is
      // being invited to open.
      const { reading } = readingOf(fixture);
      const ledger = ledgerOf(reading);
      expect(ledger.order.map((file) => file.path)).toEqual(
        ledger.groups.flatMap((group) => group.files.map((file) => file.path)),
      );
      expect([...ledger.order].map((file) => file.path).sort()).toEqual(
        reading.files.filter(isDark).map((file) => file.path).sort(),
      );
    });

    it(`${name}: the groups run byte-share descending, so the biggest finding leads`, () => {
      const bytes = ledgerOf(readingOf(fixture).reading).groups.map((group) => group.group.bytes);
      expect(bytes).toEqual([...bytes].sort((a, b) => b - a));
    });

    it(`${name}: inside a group, the order is byDisplayOrder over the group's own members`, () => {
      // Rebuilt from the reading rather than re-sorted from the ledger: this
      // asserts both WHICH files are under the heading and in what order, so a
      // group that sorted correctly over the wrong membership still fails.
      const { reading } = readingOf(fixture);
      for (const group of ledgerOf(reading).groups) {
        const expected = reading.files
          .filter((file) => darkReasonOf(file) === group.group.id)
          .sort(byDisplayOrder)
          .map((file) => file.path);
        expect(group.files.map((file) => file.path)).toEqual(expected);
      }
    });

    it(`${name}: tier ascending, then bytes descending, then path`, () => {
      const ledger = ledgerOf(readingOf(fixture).reading);
      for (const group of ledger.groups) {
        for (let index = 1; index < group.files.length; index += 1) {
          const previous = group.files[index - 1];
          const current = group.files[index];
          if (kindRank(previous.path) !== kindRank(current.path)) {
            expect(kindRank(previous.path)).toBeLessThan(kindRank(current.path));
            continue;
          }
          if (previous.bytes === current.bytes) expect(previous.path < current.path).toBe(true);
          else expect(previous.bytes).toBeGreaterThan(current.bytes);
        }
      }
    });

    it(`${name}: rows is a SUBSEQUENCE of order, capped at five`, () => {
      // A row number that went backwards would make `explain 3` name a file
      // above `explain 2` on the card that printed them.
      const ledger = ledgerOf(readingOf(fixture).reading);
      const positions = ledger.rows.map((file) => ledger.order.indexOf(file));
      for (const position of positions) expect(position).toBeGreaterThan(-1);
      expect(new Set(positions).size).toBe(positions.length);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(ledger.rows.length).toBe(Math.min(ledger.order.length, TOP_PATHS));
    });
  }

  it("puts a 9KB route above a 22KB test and a 30KB stylesheet", () => {
    const ledger = ledgerOf(readingOf(KINDS_BELOW).reading);
    const order = ledger.order.map((file) => file.path);
    expect(order.indexOf("app/api/route.ts")).toBeLessThan(
      order.indexOf("cli/src/extract.test.ts"),
    );
    expect(order.indexOf("app/api/route.ts")).toBeLessThan(order.indexOf("app/bridge.css"));
    // Demotion, never exclusion: all six are still on the list.
    expect(order).toHaveLength(6);
  });
});

describe("the group's place on the card's one colour scale", () => {
  for (const { name, fixture } of FIXTURES) {
    it(`${name}: every group's score is the byte-weighted LIT fraction of its own files`, () => {
      // COMPUTED, not written as the two constants it currently evaluates to.
      // The expectation is a second derivation — the exported predicate, over
      // the bytes the files carry — so a group that is only partly dark would
      // colour itself correctly instead of inheriting a literal that stopped
      // being true. A mixed group cannot be built through this partition (the
      // reasons are cut on the predicate), which is exactly why the assertion
      // is the arithmetic rather than the value.
      const ledger = ledgerOf(readingOf(fixture).reading);
      for (const group of ledger.groups) {
        expect(group.score).toBe(litFractionOf(group.files));
      }
      if (ledger.lit !== null) {
        expect(ledger.lit.score).toBe(litFractionOf(ledger.lit.group.files));
      }
    });
  }

  it("a group of wholly dark files sits at one pole and the coda at the other", () => {
    // The ledger's whole argument, made without a word: "these are the dark
    // ones, that one is not". The two poles are asserted TOGETHER with the fact
    // that produces them — every file under a heading is dark, every file in
    // the coda is not — so a score of 0 beside a lit file would fail here.
    const ledger = ledgerOf(readingOf(MIXED).reading);
    expect(ledger.groups.length).toBeGreaterThan(0);
    for (const group of ledger.groups) {
      for (const file of group.files) expect(isDark(file)).toBe(true);
      expect(group.score).toBe(0);
    }
    expect(ledger.lit).not.toBeNull();
    const lit = ledger.lit as { score: number; group: { files: readonly ScoredFile[] } };
    for (const file of lit.group.files) expect(isDark(file)).toBe(false);
    expect(lit.score).toBe(1);
    // The scale spans: a card whose headings and coda took the same colour
    // would be a scale with one value on it, which is decoration.
    expect(lit.score).not.toBe(ledger.groups[0].score);
  });

  it("weighs the fraction by BYTES, not by file count", () => {
    // The coda of `all but a sliver` holds one file of fifty bytes against a
    // hundred thousand dark ones; the group's own fraction is over its own
    // members, so it reads 0 rather than something diluted by the repository
    // around it.
    const ledger = ledgerOf(readingOf(ALL_BUT_A_SLIVER).reading);
    expect(ledger.groups[0].score).toBe(litFractionOf(ledger.groups[0].files));
    expect((ledger.lit as { score: number }).score).toBe(1);
  });
});

describe("a file is classified on its NEWEST human-weighted contact", () => {
  it("hand-written 900 days ago and prompted 300 days ago is `faded-prompted`", () => {
    // Newest, not strongest. Recency is a MAX over events, so the newest
    // contact is the one that would have kept the file lit and did not.
    const { reading } = readingOf(PROMPTED_SINCE);
    const file = reading.files[0];
    expect(isDark(file)).toBe(true);
    expect(darkReasonOf(file)).toBe("faded-prompted");
    expect(newestContact(file.factors.engagement)).toBe(file.factors.engagement.last_prompted);

    // And the age the heading prints is the SMALLER of the two — the most
    // favourable claim that is still true, so the card can never overstate the
    // staleness of a file somebody has touched since.
    const [group] = ledgerOf(reading).groups;
    expect(group.group.id).toBe("faded-prompted");
    expect(group.group.ageDays).toBe(300);
  });

  it("prompted 900 days ago and hand-written 300 days ago is `faded-hand`", () => {
    const { reading } = readingOf(HAND_WRITTEN_SINCE);
    const file = reading.files[0];
    expect(darkReasonOf(file)).toBe("faded-hand");
    expect(newestContact(file.factors.engagement)).toBe(
      file.factors.engagement.last_hand_authored,
    );
    const [group] = ledgerOf(reading).groups;
    expect(group.group.id).toBe("faded-hand");
    expect(group.group.ageDays).toBe(300);
  });

  it("a file with no human in git's record is `never`, and claims no age at all", () => {
    // `ageDays` is `faded-*` only: a heading that said "N+ days ago" over a file
    // nobody has ever touched would be inventing a date out of an absence.
    const { reading } = readingOf(THREE_REASONS);
    const imported = reading.files.find((file) => file.path === "src/imported.ts") as ScoredFile;
    expect(darkReasonOf(imported)).toBe("never");
    expect(newestContact(imported.factors.engagement)).toBeNull();
    const never = ledgerOf(reading).groups.find((group) => group.group.id === "never");
    expect(never?.group.ageDays).toBeUndefined();
  });

  it("a file a human touched inside the window is `lit`, whichever hand it was", () => {
    // `lit` is a MEMBER of the partition rather than an absence — it is the coda
    // the card closes the sum with, so the classifier has to name it.
    const { reading } = readingOf(MIXED);
    for (const file of reading.files) {
      expect(darkReasonOf(file) === "lit").toBe(!isDark(file));
    }
  });

  it("a group's age is the NEWEST contact in it, so no file under it is younger", () => {
    // "N+ days ago" over a group means every file here is at least that stale.
    const { reading } = readingOf(MIXED);
    for (const group of ledgerOf(reading).groups) {
      if (group.group.ageDays === undefined) continue;
      for (const file of group.files) {
        const contact = newestContact(file.factors.engagement);
        if (contact === null) continue;
        const days = (reading.now.getTime() - Date.parse(contact)) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThanOrEqual(group.group.ageDays);
      }
    }
  });
});

describe("the reviewed counterfactual is recomputed, not estimated", () => {
  /*
   * The card's LEVERAGE line was deleted at 1.5.0 — a recorded review cannot
   * make a file lit, so a line recommending one under a dark headline would be
   * an action that provably cannot move the number above it. `reviewedScore`
   * and `reviewedBlindShare` did not go with it: `fathohm paydown` builds every
   * rung out of them and `fathohm check` gates on the bytes. They are still the
   * one place the counterfactual is computed, so they are still tested here.
   */

  it("re-runs the scorer over the named files and re-weighs the blind bytes", () => {
    // Computed here the long way round — file by file, through the same
    // `scoreFromFactors` — so the test would fail if the module ever swapped in
    // arithmetic that merely agreed.
    const { reading } = readingOf(MIXED);
    const ledger = ledgerOf(reading);
    const lifted = new Set(ledger.rows.map((file) => file.path));
    let blind = 0;
    for (const file of reading.files) {
      const score = lifted.has(file.path)
        ? scoreFromFactors({ ...file.factors, human_review_depth: 1 })
        : file.floor;
      if (score < BLIND_SPOT_THRESHOLD) blind += file.bytes;
    }
    expect(reviewedBlindShare(reading, ledger.rows)).toBe(
      exactBlindShare(blind, reading.scoredBytes),
    );
  });

  it("moves the number, on a repository where five files are most of it", () => {
    const { reading } = readingOf(MIXED);
    const ledger = ledgerOf(reading);
    const before = exactBlindShare(reading.floorBlindBytes, reading.scoredBytes);
    expect(reviewedBlindShare(reading, ledger.rows)).toBeLessThan(before);
  });

  it("changes nothing when nothing is reviewed", () => {
    const { reading } = readingOf(MIXED);
    expect(reviewedBlindShare(reading, [])).toBe(
      exactBlindShare(reading.floorBlindBytes, reading.scoredBytes),
    );
  });
});

describe("the ledger is a pure function of the reading", () => {
  for (const { name, fixture } of FIXTURES) {
    it(`${name}: two readings of the same fixture ledger identically`, () => {
      const one = ledgerOf(readingOf(fixture).reading);
      const two = ledgerOf(readingOf(fixture).reading);
      expect(one.groups.map((group) => [group.group.id, group.printed, group.rowCount])).toEqual(
        two.groups.map((group) => [group.group.id, group.printed, group.rowCount]),
      );
      expect(one.order.map((file) => file.path)).toEqual(two.order.map((file) => file.path));
    });
  }

  it("does not reorder the reading it was handed", () => {
    const { reading } = readingOf(MIXED);
    const before = reading.files.map((file) => file.path);
    ledgerOf(reading);
    expect(reading.files.map((file) => file.path)).toEqual(before);
  });
});
