import { describe, expect, it } from "vitest";

import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import type { DerivedFactors } from "../../../workers/src/scorer";
import {
  HANDOVER,
  PROMPTED_ONLY,
  buildExtract,
  offboardOf,
  type CommitFixture,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { crossingClause, floorShare, readingWithout } from "./offboard";
import { scoreRepo } from "./scoring";

/**
 * THE SIMULATION'S TWO PROMISES, held as properties rather than as examples.
 *
 * The card prints one sentence that is a claim about the SCORER and not about
 * any repository — "removing a person never raises a file's score" — and one
 * closed lexicon of clauses that each name a factor. Both are the kind of thing
 * a fixture test can only sample, so the first is checked over generated
 * histories and the second is pinned rule by rule against the near-miss that
 * would fire the wrong one.
 */

/** A factor set with only the fields the clause lexicon reads. */
function factors(options: {
  hand?: string | null;
  prompted?: string | null;
  full?: number;
  quarter?: number;
}): DerivedFactors {
  return {
    human_review_depth: 0,
    human_author_recency: 0,
    bus_factor: 0,
    question_answerability: 0,
    engagement: {
      last_hand_authored: options.hand ?? null,
      last_prompted: options.prompted ?? null,
      contributors: { full: options.full ?? 0, prompted: options.quarter ?? 0 },
    },
  };
}

const NOW = new Date("2026-08-03T00:00:00Z");
const RECENT = "2026-07-14T00:00:00Z";
const OLDER = "2026-01-15T00:00:00Z";

describe("crossingClause — one clause, and it names the factor that moved", () => {
  it("says the file has no human left when the last one goes", () => {
    expect(
      crossingClause(
        factors({ hand: RECENT, full: 1 }),
        factors({ full: 0 }),
        NOW,
      ),
    ).toBe("only human in its history");
  });

  it("names the contact date the file falls back to", () => {
    expect(
      crossingClause(
        factors({ hand: RECENT, full: 2 }),
        factors({ hand: OLDER, full: 1 }),
        NOW,
      ),
    ).toBe("newest human commit falls to 200d ago");
  });

  it("counts the names the file had when only the count moves", () => {
    expect(
      crossingClause(
        factors({ hand: OLDER, full: 2 }),
        factors({ hand: OLDER, full: 1 }),
        NOW,
      ),
    ).toBe("1 of 2 humans in its history");
    expect(
      crossingClause(
        factors({ hand: OLDER, full: 3 }),
        factors({ hand: OLDER, full: 2 }),
        NOW,
      ),
    ).toBe("1 of 3 humans in its history");
  });

  it("reads the newest contact across BOTH kinds of it", () => {
    // A prompt yesterday is more recent contact than a hand-written commit six
    // months ago, and the clause is about WHEN a human last touched the file —
    // not about which weight the scorer gave it.
    expect(
      crossingClause(
        factors({ hand: OLDER, prompted: RECENT, quarter: 1, full: 1 }),
        factors({ hand: OLDER, full: 1 }),
        NOW,
      ),
    ).toBe("newest human commit falls to 200d ago");
  });

  it("prefers the worse finding when a file answers two of them", () => {
    // Losing the last human outranks losing the newest contact, which is the
    // same file described two ways: the emptier sentence is the true one.
    expect(
      crossingClause(
        factors({ hand: RECENT, prompted: OLDER, full: 1 }),
        factors({ full: 0 }),
        NOW,
      ),
    ).toBe("only human in its history");
  });

  it("refuses to guess when nothing it can name has moved", () => {
    expect(
      crossingClause(
        factors({ hand: OLDER, full: 2 }),
        factors({ hand: OLDER, full: 2 }),
        NOW,
      ),
    ).toBe("their engagement leaves its history");
  });
});

/**
 * A history with a shape nobody chose — the only kind that can hold a claim
 * about EVERY repository.
 *
 * Deterministic, because a property test that fails on Tuesday and passes on
 * Wednesday is a property nobody will believe. One linear congruential
 * generator, seeded per case, so a failing seed can be typed back in.
 */
function generated(seed: number): { fixture: ExtractFixture; people: string[] } {
  let state = seed;
  const next = (bound: number): number => {
    // `Math.imul`, because the plain product overflows 2^53 and rounds: a
    // float-rounded LCG collapses onto a small residue set and the "shape
    // nobody chose" quietly becomes a strongly patterned one. 32-bit wrapping
    // keeps every step exact, and exact is what deterministic means here.
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state % bound;
  };

  const people = ["ada@example.dev", "grace@example.dev", "lin@example.dev"];
  const fileCount = 4 + next(6);
  const tree = Array.from(
    { length: fileCount },
    (_unused, index) => [`src/mod${index}/file${index}.ts`, 500 + next(9000)] as const,
  );

  const commits: CommitFixture[] = Array.from({ length: 6 + next(14) }, () => {
    const email = people[next(people.length)];
    const touched = Array.from({ length: 1 + next(3) }, () => tree[next(fileCount)][0]);
    return {
      daysAgo: 1 + next(500),
      paths: [...new Set(touched)],
      author: { name: email.split("@")[0], email },
      prompted: next(3) === 0,
      merge: next(5) === 0,
    };
  });

  return { fixture: { tree, commits }, people };
}

describe("removing a person never raises a score", () => {
  // The card states this as a fact about the scorer, so it is checked as one:
  // every factor is a MAXIMUM over events, and removing events cannot raise a
  // maximum. Twenty generated histories times three people is sixty readings
  // and a few thousand file comparisons.
  const SEEDS = Array.from({ length: 20 }, (_unused, index) => 1 + index * 7919);

  for (const seed of SEEDS) {
    it(`holds on generated history ${seed}`, () => {
      const { fixture, people } = generated(seed);
      const extract = buildExtract(fixture, NOW);
      const opts = { now: NOW, without: [] as readonly string[] };
      const before = scoreRepo(extract, opts);
      const beforeByPath = new Map(before.files.map((file) => [file.path, file]));

      for (const person of people) {
        const after = readingWithout(extract, opts, person);
        for (const file of after.files) {
          const was = beforeByPath.get(file.path);
          expect(was, `${file.path} vanished from the reading`).toBeDefined();
          if (was === undefined) continue;
          expect(file.floor).toBeLessThanOrEqual(was.floor + 1e-12);
          expect(file.ceiling).toBeLessThanOrEqual(was.ceiling + 1e-12);
        }
        // And therefore at the headline: the blind bytes can only grow.
        expect(after.floorBlindBytes).toBeGreaterThanOrEqual(before.floorBlindBytes);
        expect(after.ceilingBlindBytes).toBeGreaterThanOrEqual(before.ceilingBlindBytes);
      }
    });
  }
});

describe("the crossings are exactly the files that cross", () => {
  it("selects on the line, on both sides, and nothing else", () => {
    const off = offboardOf(HANDOVER, "priya");
    const beforeByPath = new Map(off.before.files.map((file) => [file.path, file]));
    const afterByPath = new Map(off.after.files.map((file) => [file.path, file]));

    for (const crossing of off.crossings) {
      expect(crossing.before).toBeGreaterThanOrEqual(BLIND_SPOT_THRESHOLD);
      expect(crossing.after).toBeLessThan(BLIND_SPOT_THRESHOLD);
    }

    const listed = new Set(off.crossings.map((crossing) => crossing.path));
    for (const [path, file] of beforeByPath) {
      const later = afterByPath.get(path);
      const crosses =
        file.floor >= BLIND_SPOT_THRESHOLD &&
        later !== undefined &&
        later.floor < BLIND_SPOT_THRESHOLD;
      expect(listed.has(path), `${path} is ${crosses ? "missing from" : "wrongly in"} the list`)
        .toBe(crosses);
    }
  });

  it("orders them the way the ledger orders files", () => {
    // Application code ahead of scaffolding, bytes descending inside a tier —
    // the same ranking `read`, `explain <n>` and the picker all use, so a
    // reader moving between commands sees one ordering of one repository.
    const off = offboardOf(HANDOVER, "priya");
    expect(off.crossings.map((crossing) => crossing.path)).toEqual([
      "lib/billing/invoice.ts",
      "lib/billing/proration.ts",
      "app/api/webhooks/route.ts",
      "lib/tax/rates.ts",
      "app/jobs/retry.ts",
      "lib/billing/tax-id.ts",
    ]);
  });
});

describe("who the simulation says it removed", () => {
  it("counts the code with their name on it and nobody else's", () => {
    const off = offboardOf(HANDOVER, "priya");
    expect(off.matched).toBe(true);
    expect(off.soleKeeper.files).toBe(3);
    // invoice + proration + tax-id, and nothing that carries a second name.
    expect(off.soleKeeper.bytes).toBe(18000 + 12000 + 3000);
    expect(off.soleKeeper.share).toBeCloseTo((33000 / off.before.scoredBytes) * 100, 9);
  });

  it("matches on the address as well as the name", () => {
    const byEmail = offboardOf(HANDOVER, "priya@acme.dev");
    const byName = offboardOf(HANDOVER, "priya");
    expect(byEmail.matched).toBe(true);
    expect(floorShare(byEmail.after)).toBeCloseTo(floorShare(byName.after), 9);
  });

  it("reports a miss rather than an unchanged reading that reads like good news", () => {
    const off = offboardOf(HANDOVER, "pryia");
    expect(off.matched).toBe(false);
    expect(off.crossings).toEqual([]);
    expect(floorShare(off.after)).toBeCloseTo(floorShare(off.before), 9);
  });

  it("names the only human in a history as one", () => {
    const off = offboardOf(PROMPTED_ONLY, "Ada Lovelace");
    expect(off.onlyHuman).toBe(true);
  });

  it("composes with a --without baseline: the two readings both drop them", () => {
    // The simulation is then "additionally without this person", so the
    // baseline is gone from the before AND the after — otherwise the delta
    // would carry somebody else's removal in it.
    const off = offboardOf(HANDOVER, "priya", { without: ["sam"] });
    const solo = offboardOf(HANDOVER, "priya");
    expect(floorShare(off.before)).toBeGreaterThan(floorShare(solo.before));
    expect(floorShare(off.after)).toBeGreaterThanOrEqual(floorShare(off.before));
  });
});

/**
 * One person, two commit addresses — the everyday GitHub-noreply split. The
 * query matches BOTH identities (dropAuthor matches on name), so every
 * sentence the card derives from the match has to treat them as one person.
 */
const TWO_ADDRESSES: ExtractFixture = {
  tree: [
    ["lib/billing/invoice.ts", 18000],
    ["lib/search/index.ts", 15000],
  ],
  commits: [
    {
      daysAgo: 30,
      paths: ["lib/billing/invoice.ts"],
      author: { name: "priya", email: "priya@acme.dev" },
    },
    {
      daysAgo: 20,
      paths: ["lib/billing/invoice.ts"],
      author: { name: "priya", email: "priya@users.noreply.github.com" },
    },
    {
      daysAgo: 25,
      paths: ["lib/search/index.ts"],
      author: { name: "sam", email: "sam@acme.dev" },
    },
  ],
};

describe("one person, several identities", () => {
  it("counts a file carrying two of their own addresses as theirs alone", () => {
    // Key-level aggregation would call `invoice` shared (two keys) and print
    // the reachable-false "every scored path they touched carries another
    // human's name" — while the HANDOVER clause for the same file says the
    // opposite. Person-level, the sole-keeper sentence and the clause agree.
    const off = offboardOf(TWO_ADDRESSES, "priya");
    expect(off.matched).toBe(true);
    expect(off.soleKeeper.files).toBe(1);
    expect(off.soleKeeper.bytes).toBe(18000);
    expect(off.onlyHuman).toBe(false);
  });
});

describe("the record claims never inherit the --without baseline", () => {
  it("keeps onlyHuman and soleKeeper claims about git's record", () => {
    // With sam and marco stripped by the baseline, the baseline events show
    // one human — but the card's sentences ("only human in this history",
    // "the only human in their history") are about the repository, and git's
    // record still shows three.
    const off = offboardOf(HANDOVER, "priya", { without: ["sam", "marco"] });
    const solo = offboardOf(HANDOVER, "priya");
    expect(off.onlyHuman).toBe(false);
    expect(off.soleKeeper).toEqual(solo.soleKeeper);
  });

  it("scopes the crossing clauses to the remaining reading", () => {
    const off = offboardOf(HANDOVER, "priya", { without: ["sam"] });
    // `invoice` never had sam in it, but the reading did: with a matched
    // baseline every history clause carries "remaining", because the factor
    // sets it reads are the baseline-composed reading's, not the record's.
    const invoice = off.crossings.find((c) => c.path === "lib/billing/invoice.ts");
    expect(invoice?.clause).toBe("only remaining human in its history");
    for (const crossing of off.crossings) {
      expect(crossing.clause).not.toBe("only human in its history");
    }
  });

  it("says nothing about remaining humans when no baseline matched", () => {
    const off = offboardOf(HANDOVER, "priya", { without: ["nobody-here"] });
    for (const crossing of off.crossings) {
      expect(crossing.clause).not.toContain("remaining");
    }
  });
});
