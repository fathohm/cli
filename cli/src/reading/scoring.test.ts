import { afterAll, describe, expect, it } from "vitest";

import { BLIND_SPOT_THRESHOLD, scoreFromFactors } from "../../../lib/demo-data";
import { deriveFactors } from "../../../workers/src/scorer";
import { eventCollector, mapEvents, type CliEvent } from "../repo/events";
import { extractRepo, type CommitRecord, type RepoExtract } from "../repo/extract";
import {
  DEFAULT_HORIZON_DAYS,
  groupEventsByPath,
  readingEvents,
  refClock,
  scoreRepo,
  type RepoReading,
} from "./scoring";
import {
  ADA,
  CLAUDE_TRAILER,
  GRACE,
  cleanupFixtureRepos,
  createFixtureRepo,
  type Identity,
} from "../../test-helpers/fixture-repo";

afterAll(() => {
  cleanupFixtureRepos();
});

/**
 * The scoring adapter, checked against numbers that already exist.
 *
 * The golden values below are not this file's opinion. `0.3184` is what a real
 * reading of the founder's own code printed for a file its only author
 * hand-wrote 44 days earlier; `0.2546` is the same shape at 101 days; `1/3` is
 * a fresh solo commit
 * and the ceiling of any PR-mediated file is its floor plus exactly 0.4. If one
 * of these moves, either the scorer changed (in which case the dashboard moved
 * too, and that is the news) or the CLI stopped running the scorer.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-31T00:00:00Z");

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

interface CommitSpec {
  daysAgo: number;
  paths: string[];
  author?: Identity;
  /** A `Co-Authored-By: Claude …` trailer — the prompted (`mixed`) shape. */
  prompted?: boolean;
  /** Two-parent: an approval, weightless, PR-mediating. */
  merge?: boolean;
  /** GitHub's squash convention: a single-parent commit ending `(#N)`. */
  squashPr?: number;
}

let serial = 0;

function commitRecord(spec: CommitSpec, now: Date): CommitRecord {
  serial += 1;
  const author = spec.author ?? ADA;
  return {
    sha: serial.toString(16).padStart(40, "0"),
    parentCount: spec.merge === true ? 2 : 1,
    authorName: author.name,
    authorEmail: author.email,
    authoredAt: daysBefore(now, spec.daysAgo),
    subject:
      spec.squashPr === undefined
        ? `change ${serial}`
        : `change ${serial} (#${spec.squashPr})`,
    body: spec.prompted === true ? `Co-Authored-By: ${CLAUDE_TRAILER}` : "",
    committerName: author.name,
    committerEmail: author.email,
    paths: spec.paths,
  };
}

/** A repository, without a repository: the extract shape, built by hand. */
function extractOf(
  specs: CommitSpec[],
  tree: Array<{ path: string; bytes: number }>,
  now: Date = NOW,
): RepoExtract<CliEvent> {
  const commits = specs.map((spec) => commitRecord(spec, now));
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

function read(extract: RepoExtract<CliEvent>, without: string[] = []): RepoReading {
  return scoreRepo(extract, { now: NOW, without });
}

function file(reading: RepoReading, path: string) {
  const found = reading.files.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`${path} is not in the reading`);
  return found;
}

describe("golden numerics — the live readings, reproduced locally", () => {
  it("scores a fresh hand-written solo commit at exactly one third", () => {
    const reading = read(
      extractOf([{ daysAgo: 0, paths: ["src/a.ts"] }], [{ path: "src/a.ts", bytes: 100 }]),
    );

    // 0.25 × recency(1.0) + 0.25 × bus(1/3) = 0.25 + 0.08333…
    expect(file(reading, "src/a.ts").floor).toBeCloseTo(1 / 3, 12);
    expect(file(reading, "src/a.ts").factors.human_author_recency).toBe(1);
    expect(file(reading, "src/a.ts").factors.bus_factor).toBeCloseTo(1 / 3, 12);
    expect(reading.floorBlindBytes).toBe(0);
  });

  it("scores hand-written-44-days-ago at 0.3184 — above the line", () => {
    const reading = read(
      extractOf([{ daysAgo: 44, paths: ["src/a.ts"] }], [{ path: "src/a.ts", bytes: 100 }]),
    );

    expect(file(reading, "src/a.ts").floor).toBeCloseTo(0.3184, 4);
    expect(file(reading, "src/a.ts").floor).toBeGreaterThan(
      BLIND_SPOT_THRESHOLD,
    );
    expect(reading.floorBlindBytes).toBe(0);
    expect(reading.scoredBytes).toBe(100);
  });

  it("scores hand-written-101-days-ago at 0.2546 — below the line", () => {
    const reading = read(
      extractOf([{ daysAgo: 101, paths: ["src/a.ts"] }], [{ path: "src/a.ts", bytes: 100 }]),
    );

    expect(file(reading, "src/a.ts").floor).toBeCloseTo(0.2546, 4);
    expect(file(reading, "src/a.ts").floor).toBeLessThan(BLIND_SPOT_THRESHOLD);
    expect(reading.floorBlindBytes).toBe(100);
  });

  it("leaves prompted-only work deep below the line, however fresh", () => {
    const reading = read(
      extractOf(
        [{ daysAgo: 0, paths: ["src/a.ts"], prompted: true }],
        [{ path: "src/a.ts", bytes: 100 }],
      ),
    );
    const scored = file(reading, "src/a.ts");

    // Weight 0.25 for a prompted commit: 0.25 × 0.25 recency + 0.25 × (0.25/3)
    // bus = 1/12. Easing the decay curve rescued hand-written code; it does
    // nothing at all for code its author never wrote.
    expect(scored.factors.human_author_recency).toBeCloseTo(0.25, 12);
    expect(scored.floor).toBeCloseTo(1 / 12, 12);
    expect(scored.floor).toBeLessThan(BLIND_SPOT_THRESHOLD / 3);
    expect(reading.floorBlindBytes).toBe(100);
  });

  it("scores a file nobody has ever touched at zero", () => {
    const reading = read(
      extractOf([{ daysAgo: 0, paths: ["src/a.ts"] }], [
        { path: "src/a.ts", bytes: 100 },
        { path: "src/orphan.ts", bytes: 400 },
      ]),
    );

    expect(file(reading, "src/orphan.ts").floor).toBe(0);
    expect(reading.floorBlindBytes).toBe(400);
    expect(reading.scoredBytes).toBe(500);
  });

  it("never re-derives factors: they are deriveFactors', unchanged", () => {
    const extract = extractOf(
      [
        { daysAgo: 3, paths: ["src/a.ts"] },
        { daysAgo: 40, paths: ["src/a.ts"], author: GRACE, prompted: true },
      ],
      [{ path: "src/a.ts", bytes: 100 }],
    );
    const reading = read(extract);
    const events = extract.history.filter((event) =>
      event.paths.includes("src/a.ts"),
    );

    expect(file(reading, "src/a.ts").factors).toEqual(
      deriveFactors(events, NOW),
    );
    expect(file(reading, "src/a.ts").floor).toBe(
      scoreFromFactors(deriveFactors(events, NOW)),
    );
  });
});

describe("the interval — who the ceiling is allowed to apply to", () => {
  const extract = extractOf(
    [
      { daysAgo: 200, paths: ["src/merged.ts"], squashPr: 12 },
      { daysAgo: 200, paths: ["src/direct.ts"] },
    ],
    [
      { path: "src/merged.ts", bytes: 100 },
      { path: "src/direct.ts", bytes: 100 },
    ],
  );

  it("gives a PR-mediated file exactly floor + 0.4", () => {
    const merged = file(read(extract), "src/merged.ts");

    expect(merged.prMediated).toBe(true);
    // Full review credit is 0.4 × 1. Asserted as the exact relationship, not as
    // a literal, so a weight change moves the test instead of hiding under it.
    expect(merged.ceiling - merged.floor).toBeCloseTo(0.4, 12);
    expect(merged.ceiling).toBeGreaterThan(BLIND_SPOT_THRESHOLD);
  });

  it("leaves a file that never saw a pull request as a point, not a range", () => {
    const direct = file(read(extract), "src/direct.ts");

    expect(direct.prMediated).toBe(false);
    expect(direct.ceiling).toBe(direct.floor);
  });

  it("counts the spread in bytes, floor and ceiling both", () => {
    const reading = read(extract);

    // Both are 200 days old and unfathomed at the floor; only the PR-mediated
    // one can be rescued by a review record git cannot see.
    expect(reading.floorBlindBytes).toBe(200);
    expect(reading.ceilingBlindBytes).toBe(100);
    expect(reading.ceilingBlindBytes).toBeLessThanOrEqual(
      reading.floorBlindBytes,
    );
  });

  it("mediates through a two-parent merge as well as a squash subject", () => {
    const reading = read(
      extractOf(
        [
          { daysAgo: 200, paths: ["src/a.ts"] },
          { daysAgo: 199, paths: ["src/a.ts"], merge: true },
        ],
        [{ path: "src/a.ts", bytes: 100 }],
      ),
    );

    expect(file(reading, "src/a.ts").prMediated).toBe(true);
    // And the merge itself earns nothing: a button press is weightless, so the
    // floor is the 200-day-old commit's and not the 199-day-old merge's.
    expect(file(reading, "src/a.ts").factors.human_author_recency).toBe(0);
    expect(file(reading, "src/a.ts").floor).toBeCloseTo(0.25 / 3, 12);
  });
});

describe("squashOnly — what the ceiling is resting on", () => {
  it("is true when only subject lines say a PR happened", () => {
    expect(
      read(
        extractOf([{ daysAgo: 1, paths: ["src/a.ts"], squashPr: 7 }], [
          { path: "src/a.ts", bytes: 10 },
        ]),
      ).squashOnly,
    ).toBe(true);
  });

  it("is false once the graph itself carries a merge", () => {
    expect(
      read(
        extractOf(
          [
            { daysAgo: 1, paths: ["src/a.ts"], squashPr: 7 },
            { daysAgo: 2, paths: ["src/a.ts"], merge: true },
          ],
          [{ path: "src/a.ts", bytes: 10 }],
        ),
      ).squashOnly,
    ).toBe(false);
  });

  it("is false for a history with no PR mediation at all", () => {
    expect(
      read(
        extractOf([{ daysAgo: 1, paths: ["src/a.ts"] }], [
          { path: "src/a.ts", bytes: 10 },
        ]),
      ).squashOnly,
    ).toBe(false);
  });
});

describe("--without — the bus-factor simulation", () => {
  const extract = extractOf(
    [
      { daysAgo: 10, paths: ["src/a.ts"], author: ADA },
      { daysAgo: 100, paths: ["src/a.ts"], author: GRACE },
    ],
    [{ path: "src/a.ts", bytes: 100 }],
  );

  it("drops the bus factor AND re-maxes recency onto whoever is left", () => {
    const withEveryone = file(read(extract), "src/a.ts");
    const withoutAda = file(read(extract, [ADA.email]), "src/a.ts");

    expect(withEveryone.factors.bus_factor).toBeCloseTo(2 / 3, 12);
    expect(withoutAda.factors.bus_factor).toBeCloseTo(1 / 3, 12);

    // Recency was Ada's 10-day-old commit; without her it falls back to Grace
    // at 100 days — the whole point of removing events rather than reweighting
    // them. Nothing here is hand-adjusted; the scorer re-runs.
    expect(withEveryone.factors.human_author_recency).toBeCloseTo(
      1 - (10 / 180) ** 2,
      12,
    );
    expect(withoutAda.factors.human_author_recency).toBeCloseTo(
      1 - (100 / 180) ** 2,
      12,
    );

    expect(withEveryone.floor).toBeGreaterThan(BLIND_SPOT_THRESHOLD);
    expect(withoutAda.floor).toBeLessThan(BLIND_SPOT_THRESHOLD);
    expect(read(extract, [ADA.email]).floorBlindBytes).toBe(100);
  });

  it("reports whether each query matched anybody", () => {
    const reading = read(extract, [ADA.name, "nobody@example.dev"]);

    expect(reading.withoutMatches).toEqual([
      { query: ADA.name, matched: true },
      { query: "nobody@example.dev", matched: false },
    ]);
  });

  it("matches a person by key, email or name — and reports the miss", () => {
    for (const query of [ADA.email, ADA.email.toUpperCase(), ADA.name, " ada lovelace "]) {
      expect(read(extract, [query]).withoutMatches).toEqual([
        { query, matched: true },
      ]);
    }
    // A silent no-op is the failure mode this field exists to prevent: the
    // reading is UNCHANGED, so without the flag the reader would conclude the
    // repo survives losing somebody it never had.
    const missed = read(extract, ["Alan Turing"]);
    expect(missed.withoutMatches).toEqual([
      { query: "Alan Turing", matched: false },
    ]);
    expect(missed.files).toEqual(read(extract).files);
  });

  it("reports the same name twice as two matches, and removes once", () => {
    const twice = read(extract, [ADA.email, ADA.name]);

    expect(twice.withoutMatches).toEqual([
      { query: ADA.email, matched: true },
      { query: ADA.name, matched: true },
    ]);
    expect(twice.files).toEqual(read(extract, [ADA.email]).files);
  });

  it("removes nobody for an empty query", () => {
    const reading = read(extract, [""]);

    expect(reading.withoutMatches).toEqual([{ query: "", matched: false }]);
    expect(reading.files).toEqual(read(extract).files);
  });

  it("hands the tide the same events the card was built from", () => {
    // The one seam. The strip takes events rather than an extract, so a caller
    // that reaches for `mapEvents` directly would draw a full-history strip
    // under a card computed without somebody.
    const { events, withoutMatches } = readingEvents(extract, [ADA.email]);

    expect(events).toHaveLength(1);
    expect(events[0].actorEmail).toBe(GRACE.email);
    expect(withoutMatches).toEqual(read(extract, [ADA.email]).withoutMatches);
  });
});

describe("one denominator", () => {
  it("weighs by the code tree, and by nothing else", () => {
    const reading = read(
      extractOf(
        [{ daysAgo: 400, paths: ["src/a.ts", "assets/logo.png", "gone.ts"] }],
        [
          { path: "src/a.ts", bytes: 100 },
          { path: "assets/logo.png", bytes: 90_000 },
          { path: "pnpm-lock.yaml", bytes: 500_000 },
        ],
      ),
    );

    // Neither the image nor the lockfile is code, so neither is in the
    // denominator — and a path the history touched but the tree no longer
    // holds is not a file to score.
    expect(reading.files.map((entry) => entry.path)).toEqual(["src/a.ts"]);
    expect(reading.scoredBytes).toBe(100);
  });

  it("lists files in path order, whatever order git listed the tree", () => {
    const reading = read(
      extractOf([{ daysAgo: 1, paths: [] }], [
        { path: "src/z.ts", bytes: 1 },
        // A root file that sorts before `src/` — extensionless, so it is code.
        // (It used to be README.md; prose no longer sits in the roster.)
        { path: "Dockerfile", bytes: 1 },
        { path: "src/a.ts", bytes: 1 },
      ]),
    );

    expect(reading.files.map((entry) => entry.path)).toEqual([
      "Dockerfile",
      "src/a.ts",
      "src/z.ts",
    ]);
  });

  it("reads an empty repository as an empty reading, not an error", () => {
    const reading = read(extractOf([], []));

    expect(reading.files).toEqual([]);
    expect(reading.scoredBytes).toBe(0);
    expect(reading.floorBlindBytes).toBe(0);
    expect(reading.ceilingBlindBytes).toBe(0);
    expect(reading.squashOnly).toBe(false);
  });
});

describe("fadesAt on the reading", () => {
  it("names the day within the default horizon", () => {
    const reading = read(
      extractOf([{ daysAgo: 0, paths: ["src/a.ts"] }], [
        { path: "src/a.ts", bytes: 100 },
      ]),
    );

    expect(DEFAULT_HORIZON_DAYS).toBe(90);
    // 2026-07-31 + 65.7267d = 2026-10-04.
    expect(file(reading, "src/a.ts").fadesAt).toBe("2026-10-04");
  });

  it("is null for a file already below the line", () => {
    const reading = read(
      extractOf([{ daysAgo: 101, paths: ["src/a.ts"] }], [
        { path: "src/a.ts", bytes: 100 },
      ]),
    );

    expect(file(reading, "src/a.ts").fadesAt).toBeNull();
  });

  it("honours a narrower horizon", () => {
    const extract = extractOf([{ daysAgo: 0, paths: ["src/a.ts"] }], [
      { path: "src/a.ts", bytes: 100 },
    ]);

    expect(
      scoreRepo(extract, { now: NOW, without: [], horizonDays: 30 }).files[0]
        .fadesAt,
    ).toBeNull();
  });
});

describe("grouping — built once, restricted to what is scored", () => {
  it("indexes only tree paths, oldest event first", () => {
    const extract = extractOf(
      [
        { daysAgo: 1, paths: ["src/a.ts"] },
        { daysAgo: 50, paths: ["src/a.ts", "deleted.ts"] },
      ],
      [
        { path: "src/a.ts", bytes: 10 },
        { path: "src/quiet.ts", bytes: 10 },
      ],
    );
    const grouped = groupEventsByPath(extract.history, [
      { path: "src/a.ts", bytes: 10 },
      { path: "src/quiet.ts", bytes: 10 },
    ]);

    expect([...grouped.keys()]).toEqual(["src/a.ts", "src/quiet.ts"]);
    expect(grouped.get("src/quiet.ts")).toEqual([]);
    const events = grouped.get("src/a.ts") ?? [];
    expect(events).toHaveLength(2);
    expect(Date.parse(events[0].occurredAt)).toBeLessThan(
      Date.parse(events[1].occurredAt),
    );
  });
});

describe("determinism", () => {
  it("produces a deep-equal reading from two identical runs", () => {
    const extract = extractOf(
      [
        { daysAgo: 3, paths: ["src/a.ts"], squashPr: 1 },
        { daysAgo: 44, paths: ["src/a.ts", "src/b.ts"], author: GRACE },
        { daysAgo: 120, paths: ["src/b.ts"], prompted: true },
        { daysAgo: 130, paths: ["src/b.ts"], merge: true },
      ],
      [
        { path: "src/a.ts", bytes: 1200 },
        { path: "src/b.ts", bytes: 900 },
        { path: "docs/notes.md", bytes: 400 },
      ],
    );

    expect(scoreRepo(extract, { now: NOW, without: [GRACE.email] })).toEqual(
      scoreRepo(extract, { now: NOW, without: [GRACE.email] }),
    );
  });

  it("does not mutate the extract it was handed", () => {
    const extract = extractOf(
      [{ daysAgo: 3, paths: ["src/a.ts"] }],
      [{ path: "src/a.ts", bytes: 10 }],
    );
    const before = JSON.stringify(extract);

    read(extract, [ADA.email]);

    expect(JSON.stringify(extract)).toBe(before);
  });

  it("takes its clock only from the caller", () => {
    const extract = extractOf(
      [{ daysAgo: 0, paths: ["src/a.ts"] }],
      [{ path: "src/a.ts", bytes: 10 }],
    );
    const later = new Date(NOW.getTime() + 200 * DAY_MS);

    expect(scoreRepo(extract, { now: NOW, without: [] }).now).toBe(NOW);
    expect(
      scoreRepo(extract, { now: later, without: [] }).files[0].floor,
    ).toBeCloseTo(0.25 / 3, 12);
  });
});

describe("--at — the reading as of a ref, on a real repository", () => {
  it("reads the ref's tree, the ref's history, and the ref's clock", async () => {
    const repo = createFixtureRepo({ prefix: "scoring-at" });
    repo.commit({
      message: "first",
      date: "2026-01-10T00:00:00Z",
      files: { "src/first.ts": "export const a = 1;\n" },
    });
    repo.tag("v1");
    repo.commit({
      message: "second",
      date: "2026-06-01T00:00:00Z",
      author: GRACE,
      files: { "src/second.ts": "export const b = 2;\n" },
    });

    const atV1 = await extractRepo(repo.dir, {
      atRef: "v1",
      sink: () => eventCollector(),
    });
    const clock = refClock(atV1);
    expect(clock).toEqual(new Date("2026-01-10T00:00:00Z"));
    if (clock === null) throw new Error("the ref has no commit");

    const then = scoreRepo(atV1, { now: clock, without: [] });
    // The tree is the ref's: src/second.ts does not exist yet.
    expect(then.files.map((entry) => entry.path)).toEqual(["src/first.ts"]);
    // And the clock is the ref's, so the file reads fresh — not five months
    // stale, which is what scoring last winter's tree against today would say.
    expect(then.files[0].floor).toBeCloseTo(1 / 3, 12);

    const head = await extractRepo(repo.dir, { sink: () => eventCollector() });
    const nowClock = refClock(head);
    if (nowClock === null) throw new Error("HEAD has no commit");
    const later = scoreRepo(head, { now: nowClock, without: [] });

    expect(later.files.map((entry) => entry.path)).toEqual([
      "src/first.ts",
      "src/second.ts",
    ]);
    // Ada's January work has decayed by June, and Grace joining lifts the bus
    // factor on her own file only.
    expect(later.files[0].floor).toBeLessThan(then.files[0].floor);
    expect(later.files[1].floor).toBeCloseTo(1 / 3, 12);
  });

  it("has no clock to offer for a history with nothing in it", () => {
    expect(refClock(extractOf([], []))).toBeNull();
  });
});
