import { describe, expect, it } from "vitest";

import { MIXED, PROMPTED_ONLY, readingOf } from "../../test-helpers/reading-fixtures";
import { mapEvents } from "../repo/events";
import type { CommitRecord } from "../repo/extract";
import { groupEventsByPath } from "./scoring";
import { SIGNATURE_NOTE, signatureBytes } from "./signatures";

/**
 * BYTES BY SIGNATURE — the aggregation, and the three ways it could lie.
 *
 * The tally answers "which tool's name is on the code nobody has a name on",
 * and every failure mode of it is a mis-attribution rather than a crash:
 * counting a human file, counting a file twice, or quietly filing unrecognised
 * agent work under "human". So the assertions are about the PARTITION — what
 * lands where, and that the columns are disjoint and never exceed the
 * denominator.
 */

const NOW = new Date("2026-07-31T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function record(options: {
  daysAgo: number;
  paths: string[];
  name?: string;
  email?: string;
  trailer?: string;
}): CommitRecord {
  return {
    sha: "0".repeat(40),
    parentCount: 1,
    authorName: options.name ?? "Ada Lovelace",
    authorEmail: options.email ?? "ada@example.dev",
    authoredAt: new Date(NOW.getTime() - options.daysAgo * DAY_MS).toISOString(),
    subject: "a change",
    body: options.trailer === undefined ? "" : `Co-Authored-By: ${options.trailer}`,
    committerName: options.name ?? "Ada Lovelace",
    committerEmail: options.email ?? "ada@example.dev",
    paths: options.paths,
  };
}

function tally(tree: ReadonlyArray<readonly [string, number]>, commits: CommitRecord[]) {
  const entries = tree.map(([path, bytes]) => ({ path, bytes }));
  return signatureBytes(entries, groupEventsByPath(mapEvents(commits), entries));
}

describe("bytes by declared signature", () => {
  it("files a Claude trailer under claude_code, at the file's whole size", () => {
    const bytes = tally(
      [["src/a.ts", 1000]],
      [record({ daysAgo: 5, paths: ["src/a.ts"], trailer: "Claude <noreply@anthropic.com>" })],
    );
    expect(bytes).toEqual({ claude_code: 1000, copilot: 0, cursor: 0, unsigned: 0 });
  });

  it("counts no bytes for a file only humans ever touched", () => {
    // The columns are about agent declarations. A human file is not `unsigned`
    // — it is not in this partition at all, and putting it there would make
    // the one column people are most likely to misread even larger.
    const bytes = tally([["src/a.ts", 1000]], [record({ daysAgo: 5, paths: ["src/a.ts"] })]);
    expect(bytes).toEqual({ claude_code: 0, copilot: 0, cursor: 0, unsigned: 0 });
  });

  it("leaves a trailer this vocabulary does not know out of the tally entirely", () => {
    // Not `unsigned`, and this is worth pinning because it is the thing most
    // people would guess: an unrecognised trailer does not make a commit
    // agent-authored at all — `detectAuthorship` reads it as human work, the
    // provenance line says exactly that on every card ("undeclared agent work
    // reads as human"), and the tally follows the label rather than inventing
    // a fourth category the scorer does not have.
    const bytes = tally(
      [["src/a.ts", 700]],
      [record({ daysAgo: 5, paths: ["src/a.ts"], trailer: "Devbot <bot@example.dev>" })],
    );
    expect(bytes).toEqual({ claude_code: 0, copilot: 0, cursor: 0, unsigned: 0 });
  });

  it("never lets a merge overwrite the declaration on the code it landed", () => {
    // THE DEFECT THIS PINS, found by running it on fathohm's own history: a
    // merge is an acceptance, not authorship — it produced no content, so
    // `events.ts` records no signature for it. Counting it as a path's newest
    // declaration therefore moved every file whose last touch was a merge out
    // of `claude_code` and into `unsigned`: 776K of code filed under "no
    // signature" whose signature was recorded two commits earlier.
    const merge = {
      ...record({ daysAgo: 1, paths: ["src/a.ts"], trailer: "Claude <noreply@anthropic.com>" }),
      parentCount: 2,
    };
    const bytes = tally(
      [["src/a.ts", 900]],
      [
        record({ daysAgo: 10, paths: ["src/a.ts"], trailer: "Claude <noreply@anthropic.com>" }),
        merge,
      ],
    );
    expect(bytes).toEqual({ claude_code: 900, copilot: 0, cursor: 0, unsigned: 0 });
  });

  it("attributes a file touched by two tools to the newer declaration, once", () => {
    // A file cannot be split between them: git measures no share of a file per
    // author, and inventing one would be the only number on this document that
    // nothing could check.
    const bytes = tally(
      [["src/a.ts", 500]],
      [
        record({ daysAgo: 40, paths: ["src/a.ts"], trailer: "Copilot <copilot@github.com>" }),
        record({ daysAgo: 5, paths: ["src/a.ts"], trailer: "Claude <noreply@anthropic.com>" }),
      ],
    );
    expect(bytes).toEqual({ claude_code: 500, copilot: 0, cursor: 0, unsigned: 0 });
  });

  it("never counts a file that is not in the tree", () => {
    // The denominator is the tree the headline divides by, so a deleted path
    // with a long agent history contributes nothing — the same rule every
    // other surface follows.
    const bytes = tally(
      [["src/a.ts", 300]],
      [record({ daysAgo: 5, paths: ["src/gone.ts"], trailer: "Claude <noreply@anthropic.com>" })],
    );
    expect(bytes).toEqual({ claude_code: 0, copilot: 0, cursor: 0, unsigned: 0 });
  });

  it("never adds up to more than the reading it is taken from", () => {
    // The property that makes the columns quotable beside the headline: each
    // file lands in at most one of them, so the total is a share of the same
    // scored bytes every other number here divides by.
    for (const fixture of [MIXED, PROMPTED_ONLY]) {
      const { reading } = readingOf(fixture);
      const total = Object.values(reading.signatures).reduce((sum, value) => sum + value, 0);
      expect(total).toBeLessThanOrEqual(reading.scoredBytes);
    }
  });

  it("carries a note that forbids the reading that would invert it", () => {
    expect(SIGNATURE_NOTE).toContain("unsigned means no recognised trailer, not human");
  });

  it("finds the prompted work in the fixture the goldens are cut from", () => {
    // Non-vacuity: MIXED has prompted commits with a Claude trailer, so a
    // tally that returned all zeros here would be a broken aggregation
    // passing every case above by measuring nothing.
    const { reading } = readingOf(MIXED);
    expect(reading.signatures.claude_code).toBeGreaterThan(0);
  });
});
