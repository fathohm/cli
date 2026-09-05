import { describe, expect, it } from "vitest";

import {
  AGENT_ONLY,
  HANDOVER,
  PROMPTED_ONLY,
  buildExtract,
  teamOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { floorShare, readingWithoutKey } from "./offboard";
import { printedShare } from "../render/ledger";
import { scoreRepo } from "./scoring";
import { teamReading, type TeamReading } from "./team";

/**
 * THE PARTITION GUARDRAIL.
 *
 * The keeper table's whole claim is in the sentence under it: these rows
 * partition the scored code. That is checkable in two places and it has to hold
 * in both — the BYTES must add to the denominator (or the table is measuring
 * something other than the repository), and the PRINTED INTEGERS must add to a
 * hundred (or the reader adding the column in a screenshot finds the product
 * refuting itself).
 *
 * The two are different properties. Bytes add up by construction; the printed
 * column adds up only because the units are ALLOCATED by largest remainder
 * rather than rounded row by row, and only because the cap folds small keepers
 * into a row that still carries their bytes instead of dropping them.
 */

const NOW = new Date("2026-07-31T00:00:00Z");
const UNITS = 100;

function bytesOf(team: TeamReading): number {
  return team.rows.reduce((sum, row) => sum + row.bytes, 0);
}

function filesOf(team: TeamReading): number {
  return team.rows.reduce((sum, row) => sum + row.files, 0);
}

/**
 * The visible column, with the ledger's own exception.
 *
 * A row prints something other than its units only when its exact share is
 * inside `<1` or `>99`, where an integer claim would be a lie in the other
 * direction — a repository that is 99.6% one person's must not read `100%`
 * beside `0%`. Everywhere else the column must add up, and where a floor is in
 * play it may only fall short by the units those floors could not claim.
 */
function expectColumnAddsUp(team: TeamReading): void {
  const floored = team.rows.filter((row) => row.share > 0 && (row.share < 1 || row.share > 99));
  const printed = team.rows.reduce((sum, row) => sum + row.units, 0);
  if (floored.length === 0) {
    expect(printed).toBe(UNITS);
    return;
  }
  expect(printed).toBeLessThanOrEqual(UNITS);
  expect(printed).toBeGreaterThanOrEqual(UNITS - floored.length);
}

/**
 * A repository with more sole keepers than the table will print: twenty people
 * with a file each, against one large agent-authored module. Every one of them
 * rounds below a printed unit, which is exactly the case the cap exists for.
 */
const CROWDED: ExtractFixture = {
  tree: [
    ["src/core/engine.ts", 400_000],
    ...Array.from(
      { length: 20 },
      (_unused, index) => [`src/mod${index}/unit.ts`, 1000 + index * 10] as const,
    ),
  ],
  commits: [
    {
      daysAgo: 120,
      paths: ["src/core/engine.ts"],
      author: { name: "Claude", email: "noreply@anthropic.com" },
    },
    ...Array.from({ length: 20 }, (_unused, index) => ({
      daysAgo: 30 + index,
      paths: [`src/mod${index}/unit.ts`],
      author: { name: `dev${index}`, email: `dev${index}@example.dev` },
    })),
  ],
};

/**
 * One person on almost all of it, and a generated file nobody touched: the
 * shape where BOTH display floors are in play at once.
 */
const LOPSIDED: ExtractFixture = {
  tree: [
    ["src/core.ts", 500_000],
    ["src/generated.ts", 900],
  ],
  commits: [
    { daysAgo: 20, paths: ["src/core.ts"], author: { name: "solo", email: "solo@example.dev" } },
    {
      daysAgo: 40,
      paths: ["src/generated.ts"],
      author: { name: "Claude", email: "noreply@anthropic.com" },
    },
  ],
};

describe("the rows partition the scored bytes", () => {
  for (const [name, fixture] of [
    ["acme-api", HANDOVER],
    ["one human", PROMPTED_ONLY],
    ["no humans", AGENT_ONLY],
    ["twenty keepers", CROWDED],
    ["one dominant keeper", LOPSIDED],
  ] as const) {
    it(`${name}: every scored file lands in exactly one row`, () => {
      const team = teamOf(fixture);
      expect(bytesOf(team)).toBe(team.reading.scoredBytes);
      expect(filesOf(team)).toBe(team.reading.files.length);
    });

    it(`${name}: the printed column adds to a hundred, floors excepted`, () => {
      expectColumnAddsUp(teamOf(fixture));
    });

    it(`${name}: --full changes who is listed, never the denominator`, () => {
      const full = teamOf(fixture, { full: true });
      expect(bytesOf(full)).toBe(full.reading.scoredBytes);
      expect(filesOf(full)).toBe(full.reading.files.length);
      expectColumnAddsUp(full);
    });
  }
});

describe("the display floors survive the allocation", () => {
  it("prints both floors rather than the absolutes they have not earned", () => {
    // 99.8% and 0.2%. Rounded independently these are `100%` and `0%` — a
    // repository one person owns entirely, and a file nobody wrote at all,
    // neither of which is true. The units the floors cannot claim stay
    // unclaimed, which is the ledger's one documented exception.
    const team = teamOf(LOPSIDED);
    expect(team.rows.map((row) => printedShare(row.units, row.share))).toEqual([
      ">99%",
      "<1%",
    ]);
  });
});

describe("the cap keeps the partition rather than breaking it", () => {
  it("folds the keepers below a printed unit into one row that carries them", () => {
    const team = teamOf(CROWDED);
    const coda = team.rows.filter((row) => row.kind === "more");
    expect(coda).toHaveLength(1);
    expect(coda[0].people).toBe(20);
    // The largest load among the folded, which is what the row's clause says.
    expect(coda[0].largest).toBe(1000 + 19 * 10);
    expect(coda[0].bytes).toBe(
      Array.from({ length: 20 }, (_unused, index) => 1000 + index * 10).reduce(
        (sum, bytes) => sum + bytes,
        0,
      ),
    );
    // Nobody is listed twice: the coda's people are exactly the ones without a
    // row of their own.
    expect(team.rows.filter((row) => row.kind === "keeper")).toHaveLength(0);
  });

  it("lists every human under --full, and then there is no coda", () => {
    const team = teamOf(CROWDED, { full: true });
    expect(team.rows.filter((row) => row.kind === "more")).toHaveLength(0);
    expect(team.rows.filter((row) => row.kind === "keeper")).toHaveLength(20);
    expect(team.leave).toHaveLength(20);
  });

  it("prints a leave row for exactly the people it listed", () => {
    const team = teamOf(HANDOVER);
    expect(team.leave.map((row) => row.name)).toEqual(
      team.rows.filter((row) => row.kind === "keeper").map((row) => row.name),
    );
  });
});

describe("the leave column is offboard, run per person", () => {
  it("is the same function, to the last decimal", () => {
    const extract = buildExtract(HANDOVER, NOW);
    const opts = { now: NOW, without: [] as readonly string[] };
    const reading = scoreRepo(extract, opts);
    const team = teamReading(extract, opts, reading, { full: false });

    for (const row of team.leave) {
      expect(row.before).toBeCloseTo(floorShare(reading), 12);
      expect(row.after).toBeCloseTo(
        floorShare(readingWithoutKey(extract, opts, row.key)),
        12,
      );
      // Monotone, for the same reason the offboard card can print it.
      expect(row.after).toBeGreaterThanOrEqual(row.before - 1e-12);
    }
  });

  it("removes by identity key, so two people with one name stay two people", () => {
    const shared: ExtractFixture = {
      tree: [
        ["src/a.ts", 5000],
        ["src/b.ts", 5000],
      ],
      commits: [
        { daysAgo: 10, paths: ["src/a.ts"], author: { name: "Alex", email: "alex@one.dev" } },
        { daysAgo: 10, paths: ["src/b.ts"], author: { name: "Alex", email: "alex@two.dev" } },
      ],
    };
    const team = teamOf(shared);
    expect(team.humans).toHaveLength(2);
    // Both rows are called "Alex" and neither leave row takes the other's code
    // with it: a name-matched removal would empty the whole repository twice.
    expect(new Set(team.leave.map((row) => row.name))).toEqual(new Set(["Alex"]));
    for (const row of team.leave) {
      expect(row.after).toBeLessThan(UNITS);
    }
  });

  it("a name-shaped key still removes one identity, not everyone with the name", () => {
    // A commit with no author email gets its NAME as its identity key
    // (`authorKeyFor`'s fallback). The leave row must remove exactly that
    // identity: back through the broad reader-facing matcher, the name-shaped
    // key would also take the other Alex's events, and both rows would print
    // the whole repository emptying — a number about nobody.
    const nameKeyed: ExtractFixture = {
      tree: [
        ["src/a.ts", 10000],
        ["src/b.ts", 10000],
      ],
      commits: [
        { daysAgo: 20, paths: ["src/a.ts"], author: { name: "Alex", email: "" } },
        { daysAgo: 25, paths: ["src/b.ts"], author: { name: "Alex", email: "alex@corp.dev" } },
      ],
    };
    const team = teamOf(nameKeyed, { full: true });
    expect(team.humans).toHaveLength(2);
    expect(team.leave).toHaveLength(2);
    for (const row of team.leave) {
      // One identity removed → one 10K file loses its human, the other stays.
      expect(row.after).toBeCloseTo(50, 9);
    }
  });
});

describe("what the no-human row may claim", () => {
  it("says agent-authored where every no-human file shows a commit", () => {
    // HANDOVER's no-human files are all agent-committed on a whole history:
    // the label is checkable against the clone, so the card makes it.
    expect(teamOf(HANDOVER).noHumanAgentAuthored).toBe(true);
  });

  it("refuses the label when a no-human file shows no commit at all", () => {
    // A tracked file with no events in the reading (nothing but weightless
    // approvals, or nothing at all) supports no authorship claim.
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
    expect(teamOf(preWindow).noHumanAgentAuthored).toBe(false);
  });

  it("refuses the label when the reading is not the whole history", () => {
    // Under `--since` (or a shallow clone) the commits that could refute
    // "agent-authored" are exactly the ones the reading cannot see.
    const windowed: ExtractFixture = {
      ...AGENT_ONLY,
      provenance: { sinceBound: "2026-01-01T00:00:00Z" },
    };
    expect(teamOf(AGENT_ONLY).noHumanAgentAuthored).toBe(true);
    expect(teamOf(windowed).noHumanAgentAuthored).toBe(false);
  });
});

describe("the edges", () => {
  it("says nothing about people on a history with none", () => {
    const team = teamOf(AGENT_ONLY);
    expect(team.humans).toEqual([]);
    expect(team.leave).toEqual([]);
    expect(team.rows.map((row) => row.kind)).toEqual(["no-human"]);
  });

  it("renders one human honestly rather than suppressing the table", () => {
    const team = teamOf(PROMPTED_ONLY);
    expect(team.humans).toHaveLength(1);
    expect(team.rows.map((row) => row.kind)).toEqual(["keeper"]);
    expect(team.leave).toHaveLength(1);
  });

  it("orders keepers by the bytes at risk, heaviest first", () => {
    const team = teamOf(HANDOVER);
    const keepers = team.rows.filter((row) => row.kind === "keeper");
    expect(keepers.map((row) => row.name)).toEqual(["priya", "sam", "marco"]);
    for (let index = 1; index < keepers.length; index += 1) {
      expect(keepers[index - 1].bytes).toBeGreaterThanOrEqual(keepers[index].bytes);
    }
  });

  it("keeps a merge's presser out of the files it merged", () => {
    // An approval with zero comments is weightless, so pressing merge does not
    // put a name in a file's history — the UI files stay in the `no human` row.
    const team = teamOf(HANDOVER);
    const noHuman = team.rows.find((row) => row.kind === "no-human");
    expect(noHuman?.files).toBe(3);
  });
});
