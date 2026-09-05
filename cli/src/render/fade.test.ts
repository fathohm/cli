import { describe, expect, it } from "vitest";

import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import {
  EMPTY,
  FIXTURE_NOW,
  MIXED,
  PROMPTED_ONLY,
  buildExtract,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { holdsAtCeiling } from "../reading/fade";
import { scoreRepo } from "../reading/scoring";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import { renderFade } from "./fade";
import type { RenderMeta } from "./meta";

function term(): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
}

function meta(overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target: "fixture",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

function fade(fixture: ExtractFixture, horizonDays = 90): string {
  const extract = buildExtract(fixture, FIXTURE_NOW);
  const reading = scoreRepo(extract, { now: FIXTURE_NOW, without: [], horizonDays });
  return renderFade(reading, term(), meta({ horizonDays })).join("\n");
}

describe("the table", () => {
  const text = fade(MIXED);

  it("lists soonest first", () => {
    const dates = [...text.matchAll(/^\s+\+?\s*(\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]);
    expect(dates.length).toBeGreaterThan(1);
    expect(dates).toEqual([...dates].sort());
  });

  it("holds exactly the files with a crossing inside the horizon", () => {
    const extract = buildExtract(MIXED, FIXTURE_NOW);
    const reading = scoreRepo(extract, { now: FIXTURE_NOW, without: [], horizonDays: 90 });
    const crossing = reading.files.filter((file) => file.fadesAt !== null);
    expect(crossing.length).toBeGreaterThan(0);
    for (const file of crossing) expect(text).toContain(file.path);

    // Already below the line is not "about to fade" — it has faded, and a
    // table that kept pointing at it would never point at the one still worth
    // saving.
    for (const file of reading.files) {
      if (file.floor >= BLIND_SPOT_THRESHOLD) continue;
      expect(text.includes(`${file.path}\n`) || text.endsWith(file.path)).toBe(false);
    }
  });

  it("marks the rows a review record would save, and only those", () => {
    const extract = buildExtract(MIXED, FIXTURE_NOW);
    const reading = scoreRepo(extract, { now: FIXTURE_NOW, without: [], horizonDays: 90 });
    for (const file of reading.files) {
      if (file.fadesAt === null) continue;
      const row = text.split("\n").find((line) => line.endsWith(file.path));
      expect(row, `no row for ${file.path}`).toBeDefined();
      expect(row?.trimStart().startsWith("+")).toBe(holdsAtCeiling(file));
    }
    expect(text).toContain("holds if reviews credited");
  });

  it("respects --horizon in the reading and in the copy", () => {
    const short = fade(MIXED, 7);
    expect(short).toContain("crossings within 7 days");
    const long = fade(MIXED, 90);
    const count = (body: string) => [...body.matchAll(/\d{4}-\d{2}-\d{2}\s/g)].length;
    expect(count(short)).toBeLessThan(count(long));
  });
});

describe("the silences are two different sentences", () => {
  it("says so plainly when everything has already gone under", () => {
    const text = fade(PROMPTED_ONLY);
    expect(text).toContain("already below the line");
    expect(text).not.toContain("fades on");
  });

  it("says so plainly when nothing crosses inside the horizon", () => {
    // A horizon of one day: the crossings are real, they are just further out.
    const text = fade(MIXED, 1);
    expect(text).toContain("No file crosses the line within 1 days");
    expect(text).toContain("holding above it");
  });

  it("says there is no code rather than that nothing fades", () => {
    expect(fade(EMPTY)).toContain("Nothing to fathom here yet");
  });
});
