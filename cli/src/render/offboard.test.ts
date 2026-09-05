import { describe, expect, it } from "vitest";

import { HANDOVER, offboardOf, type ExtractFixture } from "../../test-helpers/reading-fixtures";
import { ceilingShare, floorShare } from "../reading/offboard";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import type { RenderMeta } from "./meta";
import { renderOffboard } from "./offboard";

/**
 * THE CLAIMS THE GOLDENS CANNOT PIN — the offboard card's two suppression
 * seams, on the fixtures built to split them.
 *
 * The goldens hold the card on readings where the floor and the ceiling move
 * together and there is no `--without` baseline. These are the assertions for
 * the other arrangements: a floor that holds still while the ceiling moves
 * (where "moves nothing the card prints" would be refuted two words later),
 * and a baseline that makes "today" the wrong name for the before-reading.
 */

function term(): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
}

/** The card as one line of prose, so a phrase assertion survives the wrap. */
function flat(lines: readonly string[]): string {
  return lines.join(" ").replace(/\s+/g, " ");
}

function meta(overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target: "acme-api",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

/**
 * One stale prompted file whose ONLY pull-request mediation is the removed
 * person's squash commit, plus one fresh file that anchors the floor: removing
 * `priya` leaves the floor byte-identical (her file was already below the
 * line) while the ceiling collapses (the PR mediation left with her).
 */
const CEILING_ONLY: ExtractFixture = {
  tree: [
    ["src/core.ts", 10000],
    ["src/fresh.ts", 10000],
  ],
  commits: [
    {
      daysAgo: 300,
      paths: ["src/core.ts"],
      author: { name: "priya", email: "priya@acme.dev" },
      prompted: true,
      squashPr: 7,
    },
    {
      daysAgo: 10,
      paths: ["src/fresh.ts"],
      author: { name: "grace", email: "grace@acme.dev" },
    },
  ],
};

describe("the moves-nothing claim is about the whole card", () => {
  it("is suppressed the moment the ceiling moves, even with the floor held", () => {
    const off = offboardOf(CEILING_ONLY, "priya");
    // The fixture's own contract, asserted so a scorer change cannot silently
    // turn this into a test of nothing: floor held, ceiling moved.
    expect(floorShare(off.after)).toBeCloseTo(floorShare(off.before), 9);
    expect(ceilingShare(off.after)).toBeGreaterThan(ceilingShare(off.before));

    const text = flat(renderOffboard(off, term(), meta()));
    expect(text).toContain("the same share as today");
    expect(text).not.toContain("moves nothing the card prints");
  });

  it("still makes the whole-card claim when nothing at all moved", () => {
    // Removing a person who was never PR-mediation and whose files were
    // already below the line: both ends hold, and the card may say so.
    const alreadyBlind: ExtractFixture = {
      tree: [
        ["src/core.ts", 10000],
        ["src/fresh.ts", 10000],
      ],
      commits: [
        {
          daysAgo: 300,
          paths: ["src/core.ts"],
          author: { name: "priya", email: "priya@acme.dev" },
          prompted: true,
        },
        {
          daysAgo: 10,
          paths: ["src/fresh.ts"],
          author: { name: "grace", email: "grace@acme.dev" },
        },
      ],
    };
    const off = offboardOf(alreadyBlind, "priya");
    expect(floorShare(off.after)).toBeCloseTo(floorShare(off.before), 9);
    expect(ceilingShare(off.after)).toBeCloseTo(ceilingShare(off.before), 9);

    const text = flat(renderOffboard(off, term(), meta()));
    expect(text).toContain("moves nothing the card prints");
  });
});

describe("a --without baseline is named, and today stays today", () => {
  it("names the baseline in the header and in the comparison", () => {
    const off = offboardOf(HANDOVER, "priya", { without: ["sam"] });
    const text = flat(renderOffboard(off, term(), meta()));
    // The header follows explain's rule: the simulation named as typed.
    expect(text).toContain("baseline: without sam");
    // The before-reading is not today's repository, so the comparison says
    // what it actually is instead. (The monotonicity line's "below the line
    // today" stays — that sentence really is about today: scores only fall
    // further as removals compose.)
    expect(text).toContain("without sam (worst case, git evidence alone)");
    expect(text).not.toContain("today (worst case");
    // Every printed command reproduces this card's reading: the baseline
    // travels with the explain cross-reference.
    expect(text).toContain("--without sam --without priya");
  });

  it("keeps calling the before-reading today when there is no baseline", () => {
    const off = offboardOf(HANDOVER, "priya");
    const text = flat(renderOffboard(off, term(), meta()));
    expect(text).toContain("today (worst case, git evidence alone)");
    expect(text).not.toContain("baseline:");
  });

  it("fits eighty columns with the baseline part in the header", () => {
    const off = offboardOf(HANDOVER, "priya", { without: ["sam", "marco"] });
    for (const line of renderOffboard(off, term(), meta()).join("\n").split("\n")) {
      expect(line.length, `too wide: ${line}`).toBeLessThanOrEqual(80);
    }
  });
});
