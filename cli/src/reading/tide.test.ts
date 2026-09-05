import { describe, expect, it } from "vitest";

import { mapEvents, type CliEvent } from "../repo/events";
import type { CommitRecord, RepoExtract, TreeEntry } from "../repo/extract";
import { scoreRepo } from "./scoring";
import { tideSeries, TIDE_MONTHS, type TidePoint } from "./tide";

/**
 * The tide, checked for the two properties that make it evidence.
 *
 * It has to AGREE with the number printed above it — today's point is the
 * headline or the strip is decoration — and it has to move only for reasons
 * fathohm can name. A frozen repository (every commit older than the whole
 * window) can do exactly one thing across a year: fade. If the strip ever dips
 * on such a repo, something in it is generating a story rather than reading
 * one.
 */

const CLAUDE_TRAILER = "Claude <noreply@anthropic.com>";

interface CommitSpec {
  at: string;
  paths: string[];
  author?: string;
  prompted?: boolean;
  squashPr?: number;
}

let serial = 0;

function commitRecord(spec: CommitSpec): CommitRecord {
  serial += 1;
  const email = spec.author ?? "ada@example.dev";
  return {
    sha: serial.toString(16).padStart(40, "0"),
    parentCount: 1,
    authorName: email,
    authorEmail: email,
    authoredAt: new Date(spec.at).toISOString(),
    subject:
      spec.squashPr === undefined
        ? `change ${serial}`
        : `change ${serial} (#${spec.squashPr})`,
    body: spec.prompted === true ? `Co-Authored-By: ${CLAUDE_TRAILER}` : "",
    committerName: email,
    committerEmail: email,
    paths: spec.paths,
  };
}

function extractOf(specs: CommitSpec[], tree: TreeEntry[]): RepoExtract<CliEvent> {
  const commits = specs.map(commitRecord);
  return {
    tip: commits[0] ?? null,
    history: mapEvents(commits),
    tree,
    provenance: {
      shallow: false,
      grafted: false,
      emptyRepo: false,
      sinceBound: null,
      atRef: null,
      submodulesSkipped: 0,
    },
    root: "/fixture/repo",
  };
}

function eventsOf(extract: RepoExtract<CliEvent>): CliEvent[] {
  return extract.history;
}

/** A file touched on one day by `people` distinct hand-writing authors. */
function authoredBy(people: number, at: string, paths: string[]): CommitSpec[] {
  return Array.from({ length: people }, (_, index) => ({
    at,
    paths,
    author: `dev${index}@example.dev`,
  }));
}

describe("shape", () => {
  // The record opens in 2024 so the strip's own SHAPE is what is under test
  // here: past points are trimmed to the first event (see "a strip never draws
  // a repository that did not exist yet"), and a fixture whose history started
  // last month would measure that trim instead of the monthly stepping.
  const extract = extractOf(
    [
      { at: "2024-01-01T00:00:00Z", paths: ["src/a.ts"] },
      { at: "2026-06-01T00:00:00Z", paths: ["src/a.ts"] },
    ],
    [{ path: "src/a.ts", bytes: 100 }],
  );
  const now = new Date("2026-07-31T00:00:00Z");

  it("is twelve monthly points, oldest first, then today", () => {
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(TIDE_MONTHS).toBe(12);
    expect(tide.past).toHaveLength(12);
    expect(tide.past[0].at).toBe("2025-07-31T00:00:00.000Z");
    expect(tide.past[11].at).toBe("2026-06-30T00:00:00.000Z");
    expect(tide.today.at).toBe("2026-07-31T00:00:00.000Z");
  });

  it("forecasts every thirty days out to the horizon", () => {
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(tide.forecast.map((point) => point.at)).toEqual([
      "2026-08-30T00:00:00.000Z",
      "2026-09-29T00:00:00.000Z",
      "2026-10-29T00:00:00.000Z",
    ]);
  });

  it("closes an uneven horizon on the horizon itself", () => {
    const tide = tideSeries(eventsOf(extract), extract.tree, {
      now,
      forecastDays: 45,
    });

    expect(tide.forecast.map((point) => point.at)).toEqual([
      "2026-08-30T00:00:00.000Z",
      "2026-09-14T00:00:00.000Z",
    ]);
  });

  it("forecasts nothing when asked for nothing", () => {
    expect(
      tideSeries(eventsOf(extract), extract.tree, { now, forecastDays: 0 })
        .forecast,
    ).toEqual([]);
    expect(
      tideSeries(eventsOf(extract), extract.tree, { now, months: 0 }).past,
    ).toEqual([]);
  });

  it("steps back a calendar month without sliding off a long one", () => {
    const tide = tideSeries(eventsOf(extract), extract.tree, {
      now: new Date("2026-03-31T12:00:00Z"),
      months: 2,
    });

    // One month before the 31st of March is the 28th of February, not the 3rd
    // of March — otherwise a strip of "monthly" points quietly is not one.
    expect(tide.past.map((point) => point.at)).toEqual([
      "2026-01-31T12:00:00.000Z",
      "2026-02-28T12:00:00.000Z",
    ]);
  });
});

/**
 * A point earlier than the first commit reads every file as unfathomed, so it
 * renders 100% — a number about a repository that did not exist. On the
 * founder's own ten-week-old repo that filled ten of twelve cells at the deep
 * end of the ramp and printed a year-long cleanup that never happened.
 */
describe("a strip never draws a repository that did not exist yet", () => {
  const now = new Date("2026-07-31T00:00:00Z");

  it("keeps only the months git's record covers, and says where it starts", () => {
    const extract = extractOf(
      [{ at: "2026-05-20T00:00:00Z", paths: ["src/a.ts"] }],
      [{ path: "src/a.ts", bytes: 100 }],
    );

    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    // 2026-06-30 survives; 2026-05-31 does too — both follow the first commit.
    // Everything back to 2025-07-31 is before the repository had a commit.
    expect(tide.past.map((point) => point.at)).toEqual([
      "2026-05-31T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
    ]);
    expect(tide.recordStartsAt).toBe("2026-05-20T00:00:00.000Z");
    expect(tide.monthsRequested).toBe(TIDE_MONTHS);
  });

  it("draws the full year when the record covers it", () => {
    const extract = extractOf(
      [{ at: "2020-01-01T00:00:00Z", paths: ["src/a.ts"] }],
      [{ path: "src/a.ts", bytes: 100 }],
    );

    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(tide.past).toHaveLength(TIDE_MONTHS);
    expect(tide.past).toHaveLength(tide.monthsRequested);
  });

  it("ignores events on paths this reading does not weigh", () => {
    // An excluded or vanished path enters no point on the strip, so letting one
    // open the record would restore the very months every scored point still
    // reads 100% across.
    const extract = extractOf(
      [
        { at: "2020-01-01T00:00:00Z", paths: ["assets/logo.png"] },
        { at: "2026-05-20T00:00:00Z", paths: ["src/a.ts"] },
      ],
      [
        { path: "src/a.ts", bytes: 100 },
        { path: "assets/logo.png", bytes: 90_000 },
      ],
    );

    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(tide.recordStartsAt).toBe("2026-05-20T00:00:00.000Z");
    expect(tide.past).toHaveLength(2);
  });

  it("has no record to trim to when there are no events at all", () => {
    const extract = extractOf([], [{ path: "src/a.ts", bytes: 100 }]);

    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(tide.recordStartsAt).toBeNull();
    expect(tide.past).toHaveLength(TIDE_MONTHS);
  });
});

describe("today's point is the headline", () => {
  const extract = extractOf(
    [
      { at: "2026-01-01T00:00:00Z", paths: ["src/reviewed.ts"], squashPr: 3 },
      { at: "2026-01-01T00:00:00Z", paths: ["src/stale.ts"] },
      { at: "2026-07-01T00:00:00Z", paths: ["src/prompted.ts"], prompted: true },
    ],
    [
      { path: "src/reviewed.ts", bytes: 300 },
      { path: "src/stale.ts", bytes: 500 },
      { path: "src/prompted.ts", bytes: 200 },
      { path: "assets/logo.png", bytes: 90_000 },
    ],
  );
  const now = new Date("2026-07-31T00:00:00Z");

  it("matches scoreRepo exactly, floor and ceiling", () => {
    const reading = scoreRepo(extract, { now, without: [] });
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(tide.today.floorShare).toBe(
      reading.floorBlindBytes / reading.scoredBytes,
    );
    expect(tide.today.ceilingShare).toBe(
      reading.ceilingBlindBytes / reading.scoredBytes,
    );
    // Not vacuously equal: at the floor this repo reads wholly unfathomed, and
    // the missing review record is worth 300 of its 1000 bytes.
    expect(tide.today.floorShare).toBeCloseTo(1, 12);
    expect(tide.today.ceilingShare).toBeCloseTo(700 / 1000, 12);
  });

  it("divides by the code tree, so the strip cannot outvote the card", () => {
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    // The 90kB image is not code; if it were in the denominator every share
    // here would be a rounding error instead of a reading.
    expect(tide.today.floorShare).toBeGreaterThan(0.5);
  });

  it("takes a pre-filtered tree and a raw one identically", () => {
    const raw = tideSeries(eventsOf(extract), extract.tree, { now });
    const filtered = tideSeries(
      eventsOf(extract),
      extract.tree.filter((entry) => !entry.path.endsWith(".png")),
      { now },
    );

    expect(filtered).toEqual(raw);
  });
});

describe("a frozen repository can only fade", () => {
  // Every commit predates the oldest point on the strip, so across the whole
  // year the event set never changes and the ONLY moving part is the clock.
  const FROZEN = "2025-06-15T00:00:00Z";
  const now = new Date("2026-07-01T00:00:00Z");
  const extract = extractOf(
    [
      ...authoredBy(1, FROZEN, ["src/solo.ts"]),
      ...authoredBy(2, FROZEN, ["src/pair.ts"]),
      ...authoredBy(3, FROZEN, ["src/crowd.ts"]),
    ],
    [
      { path: "src/solo.ts", bytes: 100 },
      { path: "src/pair.ts", bytes: 100 },
      { path: "src/crowd.ts", bytes: 100 },
    ],
  );

  function strip(): TidePoint[] {
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });
    return [...tide.past, tide.today, ...tide.forecast];
  }

  it("never dips: the blind share only rises, point to point", () => {
    let previous = -1;
    for (const point of strip()) {
      expect(point.floorShare).toBeGreaterThanOrEqual(previous);
      previous = point.floorShare;
    }
  });

  it("crosses in the order the bus factor predicts", () => {
    // Solo crosses ~66 days after the commit, the pair ~123, the crowd ~161 —
    // three distinct steps, so the monotonicity above is not monotone-and-flat.
    const shares = strip().map((point) => point.floorShare);

    expect(shares[0]).toBe(0);
    expect(new Set(shares.map((share) => share.toFixed(6))).size).toBe(4);
    expect(shares[shares.length - 1]).toBe(1);
  });

  it("keeps the ceiling at or under the floor at every point", () => {
    for (const point of strip()) {
      expect(point.ceilingShare).toBeLessThanOrEqual(point.floorShare);
    }
  });
});

describe("history moves the clock and the events", () => {
  it("counts a file as unfathomed before the commit that created it", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    const extract = extractOf(
      [{ at: "2026-07-25T00:00:00Z", paths: ["src/new.ts"] }],
      [{ path: "src/new.ts", bytes: 100 }],
    );
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    // Today's tree is held constant, so the file is on the strip all year —
    // with no events behind it, and therefore no comprehension, until it was
    // written. That is the simplification the renderer states out loud.
    expect(tide.past.every((point) => point.floorShare === 1)).toBe(true);
    expect(tide.today.floorShare).toBe(0);
  });

  it("holds the whole event set from today forward", () => {
    // A commit dated after `now` (clock skew, a rebase with a bad date) is
    // inside today's reading because the scorer clamps its age — so it must
    // not vanish from today and reappear at +30d.
    const now = new Date("2026-07-31T00:00:00Z");
    const extract = extractOf(
      [{ at: "2026-08-15T00:00:00Z", paths: ["src/a.ts"] }],
      [{ path: "src/a.ts", bytes: 100 }],
    );
    const reading = scoreRepo(extract, { now, without: [] });
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(reading.floorBlindBytes).toBe(0);
    expect(tide.today.floorShare).toBe(0);
    expect(tide.forecast[0].floorShare).toBe(0);
  });
});

describe("nextToFade", () => {
  const now = new Date("2026-07-31T00:00:00Z");

  it("names the earliest crossing, largest file first on a tie", () => {
    const extract = extractOf(
      [
        // One commit, two files: identical evidence, identical fade date.
        { at: "2026-07-31T00:00:00Z", paths: ["src/big.ts", "src/small.ts"] },
        // Two authors, so this one holds out about twice as long.
        ...authoredBy(2, "2026-07-31T00:00:00Z", ["src/later.ts"]),
      ],
      [
        { path: "src/big.ts", bytes: 5000 },
        { path: "src/small.ts", bytes: 10 },
        { path: "src/later.ts", bytes: 100_000 },
      ],
    );
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    expect(tide.nextToFade).toEqual({ path: "src/big.ts", at: "2026-10-04" });
  });

  it("breaks a size tie on the path, so two runs name the same file", () => {
    const extract = extractOf(
      [{ at: "2026-07-31T00:00:00Z", paths: ["src/b.ts", "src/a.ts"] }],
      [
        { path: "src/b.ts", bytes: 100 },
        { path: "src/a.ts", bytes: 100 },
      ],
    );

    expect(
      tideSeries(eventsOf(extract), extract.tree, { now }).nextToFade,
    ).toEqual({ path: "src/a.ts", at: "2026-10-04" });
  });

  it("ignores files that have already gone under", () => {
    const extract = extractOf(
      [
        { at: "2026-01-01T00:00:00Z", paths: ["src/gone.ts"] },
        { at: "2026-07-31T00:00:00Z", paths: ["src/going.ts"] },
      ],
      [
        { path: "src/gone.ts", bytes: 100_000 },
        { path: "src/going.ts", bytes: 10 },
      ],
    );
    const tide = tideSeries(eventsOf(extract), extract.tree, { now });

    // The big one is the bigger problem, but it is not NEXT — it already
    // faded, and a strip that keeps pointing backwards never points at the
    // file still worth saving.
    expect(tide.nextToFade?.path).toBe("src/going.ts");
  });

  it("is null when nothing crosses inside the forecast", () => {
    const extract = extractOf(
      [{ at: "2026-07-31T00:00:00Z", paths: ["src/a.ts"] }],
      [{ path: "src/a.ts", bytes: 100 }],
    );

    expect(
      tideSeries(eventsOf(extract), extract.tree, { now, forecastDays: 30 })
        .nextToFade,
    ).toBeNull();
  });

  it("is null for a repository where everything is already below", () => {
    const extract = extractOf(
      [{ at: "2026-01-01T00:00:00Z", paths: ["src/a.ts"] }],
      [{ path: "src/a.ts", bytes: 100 }],
    );

    expect(
      tideSeries(eventsOf(extract), extract.tree, { now }).nextToFade,
    ).toBeNull();
  });
});

describe("determinism", () => {
  const now = new Date("2026-07-31T00:00:00Z");
  const extract = extractOf(
    [
      { at: "2026-07-01T00:00:00Z", paths: ["src/a.ts"], squashPr: 4 },
      { at: "2026-03-01T00:00:00Z", paths: ["src/b.ts"], prompted: true },
      ...authoredBy(2, "2025-12-01T00:00:00Z", ["src/c.ts"]),
    ],
    [
      { path: "src/a.ts", bytes: 700 },
      { path: "src/b.ts", bytes: 300 },
      { path: "src/c.ts", bytes: 1100 },
    ],
  );

  it("produces a deep-equal series from two identical runs", () => {
    expect(tideSeries(eventsOf(extract), extract.tree, { now })).toEqual(
      tideSeries(eventsOf(extract), extract.tree, { now }),
    );
  });

  it("does not mutate the events it walks", () => {
    // The strip reuses one growing array per file rather than cloning the
    // history sixteen times; what it must never do is grow the caller's.
    const events = eventsOf(extract);
    const before = JSON.stringify(events);

    tideSeries(events, extract.tree, { now });

    expect(JSON.stringify(events)).toBe(before);
    expect(events).toHaveLength(4);
  });

  it("reads the same series whether or not the caller reuses the events", () => {
    const shared = eventsOf(extract);

    expect(tideSeries(shared, extract.tree, { now })).toEqual(
      tideSeries(shared, extract.tree, { now }),
    );
  });

  it("empties gracefully", () => {
    const tide = tideSeries([], [], { now });

    expect(tide.today).toEqual({
      at: "2026-07-31T00:00:00.000Z",
      floorShare: 0,
      ceilingShare: 0,
    });
    expect(tide.nextToFade).toBeNull();
  });
});
