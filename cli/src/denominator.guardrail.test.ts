import { describe, expect, it } from "vitest";

import { explainReading } from "../../lib/reading-explained";
import {
  MIXED,
  offboardOf,
  paydownOf,
  readingOf,
  teamOf,
} from "../test-helpers/reading-fixtures";
import { parseArgs } from "./cmd/args";
import { CliError, EXIT } from "./cmd/errors";
import { evaluateCheck } from "./reading/check";
import { renderCard } from "./render/card";
import { fileEntries } from "./render/entries";
import { renderExplain } from "./render/explain";
import { renderFade } from "./render/fade";
import { renderMapPage } from "./render/html-map";
import { readDocument } from "./render/json";
import type { RenderMeta } from "./render/meta";
import { miniMapRows } from "./render/minimap";
import { renderOffboard } from "./render/offboard";
import { renderPaydown } from "./render/paydown";
import { renderTeam } from "./render/team";
import { createTerm } from "./render/term";
import { SCORER_VERSION } from "./version";

/**
 * ONE DENOMINATOR.
 *
 * `.fathohm.toml`'s `exclude` is the first thing in this product that can
 * change what counts as the codebase, which makes it the first thing that can
 * put two different denominators on one screen. The headline could divide by
 * the whole tree while the buckets divide by the filtered one, and both numbers
 * would look plausible; a reader would only ever find out by adding up the
 * bucket shares and noticing they came to ninety-four.
 *
 * So this file does not test the glob matcher (glob.test.ts does) or the config
 * parser (config.test.ts does). It tests that ONE exclusion moves SIX surfaces
 * by the same amount: the headline, the buckets, the mini-map, the per-file
 * list, the JSON document and the HTML map. They all reach the filter through
 * `codeTree`/`filterCodePaths`, and this is the test that says so.
 */

// Two patterns, both of which must bite, because the property under test is
// that ONE exclusion moves every surface by the SAME set of files — a pattern
// that removes nothing would let a broken surface pass by not being asked.
// (It used to be `**/*.md`. Prose left the code roster, so an `*.md` exclusion
// now has nothing to take out: it cannot remove what was never counted.)
const EXCLUDE = ["app/**", "**/*.json"];

function meta(): RenderMeta {
  return {
    target: "acme-api",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
  };
}

const full = readingOf(MIXED);
const trimmed = readingOf(MIXED, { exclude: EXCLUDE });

/** The files the patterns took out, computed straight from the fixture. */
const REMOVED = MIXED.tree.filter(
  ([path]) => path.startsWith("app/") || path.endsWith(".json"),
);

describe("an exclusion shrinks every surface by the same files", () => {
  it("takes exactly the matching files out of the reading", () => {
    expect(REMOVED.length).toBeGreaterThan(1);
    expect(trimmed.reading.files).toHaveLength(full.reading.files.length - REMOVED.length);
    for (const [path] of REMOVED) {
      expect(trimmed.reading.files.some((file) => file.path === path)).toBe(false);
    }
  });

  it("takes their bytes out of the headline's denominator", () => {
    const removedBytes = REMOVED.reduce((sum, [, bytes]) => sum + bytes, 0);
    expect(trimmed.reading.scoredBytes).toBe(full.reading.scoredBytes - removedBytes);
    expect(trimmed.reading.excluded.fileCount).toBe(REMOVED.length);
    expect(trimmed.reading.excluded.bytes).toBe(removedBytes);
    expect(trimmed.reading.excluded.patterns).toEqual(EXCLUDE);
  });

  it("the buckets divide by the headline's number, not the tree's", () => {
    const explained = explainReading(fileEntries(trimmed.reading), trimmed.reading.now);
    expect(explained.scoredBytes).toBe(trimmed.reading.scoredBytes);
    expect(explained.scoredFileCount).toBe(trimmed.reading.files.length);
    const shares = explained.buckets.reduce((sum, bucket) => sum + bucket.share, 0);
    expect(shares).toBeCloseTo(1, 10);
  });

  it("the mini-map's bars add up to the same whole", () => {
    const rows = miniMapRows(trimmed.reading);
    expect(rows.some((row) => row.name === "app/")).toBe(false);
    expect(rows.reduce((sum, row) => sum + row.bytes, 0)).toBe(trimmed.reading.scoredBytes);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 10);
  });

  it("the tide draws the same repository the card counted", () => {
    // Today's point is the strip's own reading of the same instant, so it has
    // to equal the headline exactly — that is the invariant an unfiltered tree
    // inside the tide would break silently.
    expect(trimmed.tide.today.floorShare).toBeCloseTo(
      trimmed.reading.floorBlindBytes / trimmed.reading.scoredBytes,
      12,
    );
  });

  it("the JSON document reports the shrunken set, and says why", () => {
    const document = readDocument({ reading: trimmed.reading, meta: meta() }, trimmed.tide);
    expect(document.files).toHaveLength(trimmed.reading.files.length);
    expect(document.headline.fileCount).toBe(trimmed.reading.files.length);
    expect(document.headline.scoredBytes).toBe(trimmed.reading.scoredBytes);
    expect(document.provenance.excluded.fileCount).toBe(REMOVED.length);
    for (const [path] of REMOVED) {
      expect(document.files?.some((file) => file.path === path)).toBe(false);
    }
  });

  it("the HTML map draws one cell per remaining file, and no others", () => {
    const html = renderMapPage(trimmed.reading, meta());
    expect((html.match(/<rect /g) ?? []).length).toBe(trimmed.reading.files.length);
    for (const [path] of REMOVED) expect(html).not.toContain(path);
  });

  it("the gate is decided on the shrunken denominator too", () => {
    const before = evaluateCheck(full.reading, { maxBlind: 50, pessimistic: true });
    const after = evaluateCheck(trimmed.reading, { maxBlind: 50, pessimistic: true });
    expect(after.scoredBytes).toBe(trimmed.reading.scoredBytes);
    expect(after.scoredBytes).toBeLessThan(before.scoredBytes);
  });

  it("says out loud that the reading was bounded", () => {
    // A shrunken denominator that nobody mentions is the same failure as an
    // unmentioned `--since` window: the number means something else now.
    const html = renderMapPage(trimmed.reading, meta());
    expect(html).toContain("excluded by .fathohm.toml");
    expect(html).toContain(`${REMOVED.length} files`);
    expect(html).toContain("app/**");
  });
});

/**
 * THE SECOND THING THAT CAN MOVE THE DENOMINATOR — and the one command it is
 * not allowed to move.
 *
 * `--scope <dir>` reads a subtree. It reaches the tree through the same
 * `codeTree` seam `exclude` does, so the six surfaces above follow it for free
 * — which is the whole reason it was put there rather than in a filter of its
 * own. What is asserted here is the part that is NOT free:
 *
 *   1. the subtree really is the denominator, on the headline and the tide;
 *   2. every scoped card SAYS which denominator it divided by, because a
 *      subtree share quoted as a repository's is a number about a codebase
 *      nobody measured, and the two read identically once the flag has
 *      scrolled off the screen;
 *   3. `check` cannot be scoped AT ALL. Its output is an exit code, a claim
 *      about a repository that a pipeline acts on without reading a word of
 *      the card — so there is no sentence that could make a scoped verdict
 *      safe, and the flag is refused before a reading is ever taken.
 */
const SCOPE = "lib";
const scoped = readingOf(MIXED, { scope: SCOPE });

/** The files the scope kept, computed straight from the fixture. */
const IN_SCOPE = MIXED.tree.filter(([path]) => path.startsWith(`${SCOPE}/`));

describe("a scope makes the subtree the whole reading", () => {
  it("keeps exactly the subtree, and nothing else", () => {
    expect(IN_SCOPE.length).toBeGreaterThan(1);
    // Sorted on both sides: a reading orders its files by path and the fixture
    // is written in whatever order reads well, and the property under test is
    // the SET.
    expect(scoped.reading.files.map((file) => file.path).sort()).toEqual(
      IN_SCOPE.map(([path]) => path).sort(),
    );
    expect(scoped.reading.scope).toBe(SCOPE);
  });

  it("divides by the subtree's bytes, on the headline and in the JSON", () => {
    const bytes = IN_SCOPE.reduce((sum, [, size]) => sum + size, 0);
    expect(scoped.reading.scoredBytes).toBe(bytes);
    expect(scoped.reading.scoredBytes).toBeLessThan(full.reading.scoredBytes);
    const document = readDocument(
      { reading: scoped.reading, meta: { ...meta(), target: "acme-api/lib" } },
      scoped.tide,
    );
    expect(document.headline.scoredBytes).toBe(bytes);
    expect(document.headline.fileCount).toBe(IN_SCOPE.length);
  });

  it("draws the tide over the same files the card counted", () => {
    // The strip takes the tree separately from the scorer, so this is the one
    // surface a scope could miss silently — and it would show up as a trend
    // that contradicts the number printed above it.
    expect(scoped.tide.today.floorShare).toBeCloseTo(
      scoped.reading.floorBlindBytes / scoped.reading.scoredBytes,
      12,
    );
  });

  it("says which denominator it divided by, on every scoped command", () => {
    const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
    const scopedMeta = { ...meta(), target: "acme-api/lib" };
    const file = scoped.reading.files[0];
    const surfaces: Array<[string, readonly string[]]> = [
      ["read", renderCard(scoped.reading, scoped.tide, term, scopedMeta)],
      ["explain", renderExplain(scoped.reading, file, term, scopedMeta)],
      ["fade", renderFade(scoped.reading, term, scopedMeta)],
      ["team", renderTeam(teamOf(MIXED, { scope: SCOPE }), term, scopedMeta)],
      ["paydown", renderPaydown(paydownOf(MIXED, { scope: SCOPE }), term, scopedMeta)],
      [
        "offboard",
        renderOffboard(offboardOf(MIXED, "Ada Lovelace", { scope: SCOPE }), term, scopedMeta),
      ],
    ];
    for (const [name, lines] of surfaces) {
      const text = lines.join(" ").replace(/\s+/g, " ");
      expect(text, `${name} never states its denominator`).toContain(
        `Reading: ${SCOPE}/ -- ${IN_SCOPE.length} files`,
      );
      expect(text, `${name} never says the repository's number differs`).toContain(
        "the repository's own number is different",
      );
    }
  });

  it("never labels a scoped number as the repository's", () => {
    const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
    const card = renderCard(scoped.reading, scoped.tide, term, {
      ...meta(),
      target: "acme-api/lib",
    }).join(" ");
    // The mini-map heading is the one line that names what the bars are a
    // share OF, so on a subtree it has to name the reading rather than the
    // repository — `lib/ 100%` under "share of this repository" would be false
    // in the most quotable line on the card.
    expect(card).toContain("share of this reading");
    expect(card).not.toContain("share of this repository");
  });

  it("REFUSES to gate on a subtree — the flag never reaches a reading", () => {
    // Asserted at the ARGUMENT surface, which is the only place it can be
    // asserted as an impossibility: `check`'s exit code is computed from
    // `evaluateCheck(reading, …)`, and this is what guarantees no scoped
    // `reading` can ever be the one handed to it.
    expect(() => parseArgs(["check", "--scope", SCOPE, "--max-blind", "40"])).toThrow(
      /whole repository/,
    );
    try {
      parseArgs(["check", "--scope", SCOPE, "--max-blind", "40"]);
    } catch (error) {
      expect((error as CliError).exitCode).toBe(EXIT.usage);
    }
    // …and the other five still take it, so the refusal is a rule about
    // `check` rather than a flag that quietly stopped working.
    for (const command of ["read", "explain", "fade", "team", "paydown"]) {
      const argv = command === "explain" ? [command, "lib/palette.ts"] : [command];
      expect(parseArgs([...argv, "--scope", SCOPE]).flags.scope).toBe(SCOPE);
    }
  });

  it("normalizes the three spellings of one directory to one string", () => {
    // The scope string is printed in the header AND compared against tree
    // paths, so two spellings would be two claims about one number.
    for (const spelling of ["lib", "./lib", "lib/"]) {
      expect(parseArgs(["read", "--scope", spelling]).flags.scope).toBe(SCOPE);
    }
    // A path with no meaning here is refused rather than resolved.
    for (const bad of ["/etc", "../secrets", "."]) {
      expect(() => parseArgs(["read", "--scope", bad]), bad).toThrow(/inside the repository/);
    }
  });
});

describe("no exclusion changes nothing", () => {
  it("an empty pattern list leaves the reading identical", () => {
    const same = readingOf(MIXED, { exclude: [] });
    expect(same.reading.files.map((file) => file.path)).toEqual(
      full.reading.files.map((file) => file.path),
    );
    expect(same.reading.scoredBytes).toBe(full.reading.scoredBytes);
    expect(same.reading.excluded).toEqual({ patterns: [], fileCount: 0, bytes: 0 });
  });

  it("a pattern that matches nothing is reported as excluding nothing", () => {
    const none = readingOf(MIXED, { exclude: ["nowhere/**"] });
    expect(none.reading.files).toHaveLength(full.reading.files.length);
    expect(none.reading.excluded.fileCount).toBe(0);
    // …and the provenance stays quiet about it rather than announcing a
    // filter that did not fire.
    expect(renderMapPage(none.reading, meta())).not.toContain("excluded by .fathohm.toml");
  });
});
