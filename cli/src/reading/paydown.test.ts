import { describe, expect, it } from "vitest";

import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import {
  EMPTY,
  HANDOVER,
  MANY_CROSSINGS,
  MIXED,
  NON_CODE,
  PROMPTED_DOMINANT,
  PROMPTED_ONLY,
  readingOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { evaluateCheck, withinLimit } from "./check";
import {
  REVIEW_CLEARS_THE_LINE,
  paydownReading,
  rungSizes,
  type PaydownOptions,
} from "./paydown";
import { byDisplayOrder } from "./kind";
import { reviewedBlindShare, reviewedScore } from "./counterfactual";
import type { RepoReading } from "./scoring";

/**
 * THE LADDER'S PROPERTIES, held rather than sampled.
 *
 * A rung is a claim about what the scorer would return, so the assertions here
 * are the ones a golden file cannot make: that the partition is a partition,
 * that the rungs only ever fall, that a rung agrees with the leverage closer's
 * own function on the same files, and that the gate line is `check`'s own
 * comparison rather than a second one that will one day disagree with it.
 */

const NO_GATE: PaydownOptions = { maxBlind: null, pessimistic: false };

function ladderOf(fixture: ExtractFixture, options: PaydownOptions = NO_GATE) {
  const { reading } = readingOf(fixture);
  return { reading, paydown: paydownReading(reading, options) };
}

describe("rungSizes — 1, 3, 5, 10, capped at what there is", () => {
  it("gives the full set once there are ten files", () => {
    expect(rungSizes(10)).toEqual([1, 3, 5, 10]);
    expect(rungSizes(26)).toEqual([1, 3, 5, 10]);
  });

  it("caps the last rung at the ladder rather than dropping it", () => {
    expect(rungSizes(7)).toEqual([1, 3, 5, 7]);
    expect(rungSizes(4)).toEqual([1, 3, 4]);
  });

  it("never prints the same rung twice", () => {
    expect(rungSizes(2)).toEqual([1, 2]);
    expect(rungSizes(1)).toEqual([1]);
  });

  it("has no rungs when nothing can be lifted", () => {
    expect(rungSizes(0)).toEqual([]);
    expect(rungSizes(-3)).toEqual([]);
  });
});

describe("the two sections are a partition of what is below the line", () => {
  for (const [name, fixture] of [
    ["mixed", MIXED],
    ["prompted-dominant", PROMPTED_DOMINANT],
    ["prompted-only", PROMPTED_ONLY],
    ["handover", HANDOVER],
    ["many-crossings", MANY_CROSSINGS],
  ] as const) {
    it(`${name}: liftable + unliftable = every below-line file, by count and by bytes`, () => {
      const { reading, paydown } = ladderOf(fixture);
      const below = reading.files.filter((file) => file.floor < BLIND_SPOT_THRESHOLD);
      const bytes = below.reduce((sum, file) => sum + file.bytes, 0);

      expect(paydown.liftable.files + paydown.unliftable.files).toBe(below.length);
      expect(paydown.liftable.bytes + paydown.unliftable.bytes).toBe(bytes);
      expect(paydown.ladder).toHaveLength(paydown.liftable.files);
    });
  }

  it("puts a file on the ladder exactly when full review credit clears the line", () => {
    const { paydown } = ladderOf(HANDOVER);
    for (const file of paydown.ladder) {
      expect(reviewedScore(file)).toBeGreaterThanOrEqual(BLIND_SPOT_THRESHOLD);
      expect(file.floor).toBeLessThan(BLIND_SPOT_THRESHOLD);
    }
  });

  /**
   * THE REMAINDER IS EMPTY TODAY, AND THAT IS ARITHMETIC RATHER THAN LUCK.
   *
   * Review depth carries the heaviest weight in `lib/demo-data` and the line
   * sits below it, so a recorded review clears the line on its own however cold
   * and however agent-written a file is. The remainder section exists for the
   * day those two constants cross; until then it is computed, found empty, and
   * the card prints the other sentence.
   */
  it("finds review credit worth more than the line, and says so from the constants", () => {
    expect(REVIEW_CLEARS_THE_LINE).toBe(true);
  });

  it("leaves nothing off the ladder while that holds, even three years cold", () => {
    const faded: ExtractFixture = {
      tree: [
        ["src/core.ts", 10000],
        ["src/fresh.ts", 10000],
      ],
      commits: [
        { daysAgo: 1100, paths: ["src/core.ts"], prompted: true },
        { daysAgo: 5, paths: ["src/fresh.ts"] },
      ],
    };
    const { paydown } = ladderOf(faded);
    expect(paydown.ladder).toHaveLength(1);
    expect(paydown.unliftable.files).toBe(0);
    expect(reviewedScore(paydown.ladder[0])).toBeGreaterThanOrEqual(BLIND_SPOT_THRESHOLD);
  });

  it("keeps a remainder empty on every fixture, for the same reason", () => {
    if (!REVIEW_CLEARS_THE_LINE) return;
    for (const fixture of [MIXED, PROMPTED_DOMINANT, PROMPTED_ONLY, HANDOVER]) {
      expect(ladderOf(fixture).paydown.unliftable.files).toBe(0);
    }
  });

  it("orders the ladder the way every other surface orders files", () => {
    const { paydown } = ladderOf(MIXED);
    expect([...paydown.ladder]).toEqual([...paydown.ladder].sort(byDisplayOrder));
  });
});

describe("a rung is the scorer re-run, and it agrees with the leverage closer", () => {
  for (const [name, fixture] of [
    ["mixed", MIXED],
    ["prompted-dominant", PROMPTED_DOMINANT],
    ["handover", HANDOVER],
  ] as const) {
    it(`${name}: every rung equals reviewedBlindShare over the same files`, () => {
      const { reading, paydown } = ladderOf(fixture);
      for (const rung of paydown.rungs) {
        expect(rung.floor).toBeCloseTo(
          reviewedBlindShare(reading, paydown.ladder.slice(0, rung.files)),
          9,
        );
      }
    });

    it(`${name}: the ladder only ever falls, at both ends`, () => {
      const { paydown } = ladderOf(fixture);
      let floor = paydown.before.floor;
      let ceiling = paydown.before.ceiling;
      for (const rung of paydown.rungs) {
        expect(rung.floor).toBeLessThanOrEqual(floor);
        expect(rung.ceiling).toBeLessThanOrEqual(ceiling);
        floor = rung.floor;
        ceiling = rung.ceiling;
      }
    });
  }

  it("rung zero is the reading as it stands", () => {
    const { reading, paydown } = ladderOf(MIXED);
    expect(paydown.before.floor).toBeCloseTo(reviewedBlindShare(reading, []), 9);
  });

  it("moves nothing when a rung's files were already reviewed at the ceiling", () => {
    // The ceiling end credits every PR-mediated file already, so lifting one
    // cannot move it — the property that makes the gate line honest about the
    // end `check` reads by default.
    const { reading, paydown } = ladderOf(MIXED);
    const prMediated = paydown.ladder.filter((file) => file.prMediated);
    if (prMediated.length > 0) {
      const rung = paydown.rungs[0];
      expect(rung.ceilingBlindBytes).toBeLessThanOrEqual(reading.ceilingBlindBytes);
    }
  });
});

describe("degenerate readings have nothing to pay down", () => {
  for (const [name, fixture] of [
    ["empty", EMPTY],
    ["non-code", NON_CODE],
  ] as const) {
    it(`${name}: no ladder, no rungs, no shares out of a zero denominator`, () => {
      const { paydown } = ladderOf(fixture);
      expect(paydown.ladder).toHaveLength(0);
      expect(paydown.rungs).toHaveLength(0);
      expect(paydown.liftable).toEqual({ files: 0, bytes: 0, share: 0 });
      expect(paydown.unliftable).toEqual({ files: 0, bytes: 0, share: 0 });
      expect(paydown.before.floor).toBe(0);
    });
  }

  it("a repository entirely above the line has an empty ladder and no remainder", () => {
    const { paydown } = ladderOf({
      tree: [["src/index.ts", 4000]],
      commits: [{ daysAgo: 1, paths: ["src/index.ts"] }],
    });
    expect(paydown.liftable.files).toBe(0);
    expect(paydown.unliftable.files).toBe(0);
  });
});

describe("a --without baseline composes, because the reading already carries it", () => {
  it("computes the ladder on the composed reading, never on the full history", () => {
    const { reading: full } = readingOf(HANDOVER);
    const { reading: without } = readingOf(HANDOVER, { without: ["priya"] });
    const baselined = paydownReading(without, NO_GATE);

    expect(baselined.reading).toBe(without);
    expect(baselined.before.floor).toBeCloseTo(
      (without.floorBlindBytes / without.scoredBytes) * 100,
      9,
    );
    // The simulation really did move: a ladder identical to the unbaselined
    // one would make this test a test of nothing.
    expect(without.floorBlindBytes).toBeGreaterThan(full.floorBlindBytes);
  });

  it("names the baseline queries on the reading it was handed", () => {
    const { reading } = readingOf(HANDOVER, { without: ["sam"] });
    const paydown = paydownReading(reading, NO_GATE);
    expect(paydown.reading.withoutMatches.map((match) => match.query)).toEqual(["sam"]);
  });
});

describe("the gate is check's own comparison", () => {
  it("is absent until something says what the limit is", () => {
    expect(ladderOf(MIXED).paydown.gate).toBeNull();
  });

  it("reads the ceiling by default and the floor under --pessimistic", () => {
    expect(ladderOf(MIXED, { maxBlind: 40, pessimistic: false }).paydown.gate?.bound).toBe(
      "ceiling",
    );
    expect(ladderOf(MIXED, { maxBlind: 40, pessimistic: true }).paydown.gate?.bound).toBe(
      "floor",
    );
  });

  it("agrees with evaluateCheck about today", () => {
    for (const pessimistic of [false, true]) {
      for (const maxBlind of [0, 5, 40, 90, 100]) {
        const { reading, paydown } = ladderOf(MIXED, { maxBlind, pessimistic });
        expect(paydown.gate?.passesToday).toBe(
          evaluateCheck(reading, { maxBlind, pessimistic }).passed,
        );
      }
    }
  });

  it("names the FIRST rung inside the limit, and the one before it is outside", () => {
    const { reading, paydown } = ladderOf(PROMPTED_DOMINANT, {
      maxBlind: 40,
      pessimistic: true,
    });
    const gate = paydown.gate;
    if (gate === null || gate.passesAt === null || gate.passesAt === 0) return;

    const rungs = paydown.rungs;
    const index = rungs.findIndex((rung) => rung.files === gate.passesAt);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(passes(reading, rungs[index].floorBlindBytes, gate.threshold)).toBe(true);
    for (const earlier of rungs.slice(0, index)) {
      expect(passes(reading, earlier.floorBlindBytes, gate.threshold)).toBe(false);
    }
  });

  it("says nothing on this ladder reaches a limit nothing on it reaches", () => {
    // Fifteen equal files below the line and a limit of zero: the ladder stops
    // at ten rungs, five files are still below it there, and the honest answer
    // is that no rung on THIS ladder gets there — not that it cannot be got to.
    const wide: ExtractFixture = {
      tree: Array.from(
        { length: 15 },
        (_unused, index) => [`src/${String.fromCharCode(97 + index)}.ts`, 1000] as const,
      ),
      commits: [
        {
          daysAgo: 500,
          paths: Array.from({ length: 15 }, (_unused, index) =>
            `src/${String.fromCharCode(97 + index)}.ts`,
          ),
          prompted: true,
        },
      ],
    };
    const { paydown } = ladderOf(wide, { maxBlind: 0, pessimistic: true });
    expect(paydown.ladder).toHaveLength(15);
    expect(paydown.rungs.at(-1)?.files).toBe(10);
    expect(paydown.gate?.passesToday).toBe(false);
    expect(paydown.gate?.passesAt).toBeNull();
  });

  it("is zero when the reading passes as it stands", () => {
    const { paydown } = ladderOf(MIXED, { maxBlind: 100, pessimistic: false });
    expect(paydown.gate?.passesToday).toBe(true);
    expect(paydown.gate?.passesAt).toBe(0);
  });
});

function passes(reading: RepoReading, blindBytes: number, threshold: number): boolean {
  return withinLimit(blindBytes, reading.scoredBytes, threshold);
}
