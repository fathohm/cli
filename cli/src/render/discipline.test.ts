import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGENT_ONLY,
  HANDOVER,
  LONG_NAMES,
  MIXED,
  PROMPTED_DOMINANT,
  PROMPTED_ONLY,
  SHALLOW,
  SQUASH_ONLY,
  offboardOf,
  paydownOf,
  readingOf,
  teamOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { evaluateCheck } from "../reading/check";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import { renderCard } from "./card";
import { renderCheck } from "./check";
import { renderExplain, selectFile } from "./explain";
import { renderFade } from "./fade";
import { renderMapNote } from "./html-map";
import type { RenderMeta } from "./meta";
import { renderOffboard } from "./offboard";
import { renderPaydown } from "./paydown";
import { renderTeam } from "./team";

/**
 * OUTPUT DISCIPLINE — the promises the renderers make about their own bytes,
 * asserted rather than reviewed.
 *
 * Three of them, and each has already been broken once by somebody careful:
 *
 *   1. NO HAND-WRITTEN NUMBERS. Every percentage on the card must come out of
 *      a computed value. A literal in a renderer is not a typo risk, it is a
 *      claim the code cannot check — the same failure as a green test pinning
 *      a hex that had become unreadable.
 *   2. `--ascii` IS TOTAL. A flag that swaps most of the glyphs is a
 *      half-promise; the terminals that need it (CI logs, Windows consoles,
 *      old SSH) render the remainder as mojibake.
 *   3. THE CARD FITS. `COLUMNS`, floored at 80, is the width the layout is
 *      designed against, and a wrapped line ruins a screenshot.
 */

const RENDER_DIR = path.join(process.cwd(), "cli", "src", "render");

function sources(): Array<{ name: string; code: string }> {
  return readdirSync(RENDER_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({
      name,
      // Comment lines are stripped by their own leading marker rather than by
      // a block matcher: a naive `/* … */` sweep would eat a `https://` inside
      // a string and could hide exactly what this test looks for.
      code: readFileSync(path.join(RENDER_DIR, name), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join("\n"),
    }));
}

describe("every rendered number is a computed value", () => {
  it("no renderer source contains a percent sign at all", () => {
    for (const { name, code } of sources()) {
      // Not "no `42%`" but "no `%`": the percent sign only ever reaches the
      // terminal through lib/blind-share-format, which owns the `<1%`/`>99%`
      // floors. A renderer that formats its own share has bypassed them.
      expect(code, `${name} formats a percentage of its own`).not.toMatch(/%/);
    }
  });

  it("no renderer restates a scoring constant", () => {
    // The line (0.30) and the review weight (0.40) live in lib/demo-data.ts.
    // A copy here is a second definition that no test would ever see move.
    for (const { name, code } of sources()) {
      expect(code, `${name} restates a scoring constant`).not.toMatch(/\b0\.(3|30|4|40)\b/);
    }
  });
});

const FIXTURES: ReadonlyArray<{
  name: string;
  fixture: ExtractFixture;
  path: string;
  /** Somebody `offboard` can be pointed at. A miss is its own golden. */
  person: string;
}> = [
  { name: "mixed", fixture: MIXED, path: "workers/src/scorer.ts", person: "Ada Lovelace" },
  {
    name: "prompted-dominant",
    fixture: PROMPTED_DOMINANT,
    path: "src/agents/router.ts",
    person: "ada@example.dev",
  },
  { name: "prompted-only", fixture: PROMPTED_ONLY, path: "src/index.ts", person: "Ada Lovelace" },
  { name: "shallow", fixture: SHALLOW, path: "app/page.tsx", person: "Grace Hopper" },
  { name: "squash-only", fixture: SQUASH_ONLY, path: "src/parse.ts", person: "Ada Lovelace" },
  // The two people-shaped cards, on the fixture built for them and on one with
  // no humans in it at all: the widest clause on either is longer than anything
  // the reading card prints, so they are where the 80-column floor gets tested.
  { name: "handover", fixture: HANDOVER, path: "lib/billing/invoice.ts", person: "priya" },
  { name: "agent-only", fixture: AGENT_ONLY, path: "src/router.ts", person: "priya" },
  // Real repositories are not called `acme-api` and real people are not called
  // `sam`. Every column on the keeper table has to give way in some order when
  // the names are long, and this is the fixture that decides which.
  {
    name: "long-names",
    fixture: LONG_NAMES,
    path: "packages/platform/services/billing/reconciliation-engine.ts",
    person: "Konstantin Vasilevsky-Andersson",
  },
];

function meta(overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target: "fixture",
    quiet: false,
    full: true,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

/** Every line every command emits, for one fixture and one terminal. */
function everyLine(
  fixture: ExtractFixture,
  filePath: string,
  person: string,
  term: Term,
): string[] {
  const { reading, tide } = readingOf(fixture);
  return [
    ...renderCard(reading, tide, term, meta()),
    ...renderExplain(reading, selectFile(reading, filePath), term, meta()),
    ...renderFade(reading, term, meta()),
    ...renderCheck(
      reading,
      evaluateCheck(reading, { maxBlind: 40, pessimistic: false }),
      term,
      meta(),
    ),
    // A long absolute path is the realistic case for `--out`, and the one that
    // would break the width promise if anything padded around it.
    ...renderMapNote(reading, "/tmp/fathohm/fathohm-map.html", 51_200, term, meta()),
    ...renderOffboard(offboardOf(fixture, person, { full: true }), term, meta()),
    // The gate flags are set here rather than left null so the widest line the
    // paydown card can print — a `check` invocation carrying a baseline, a
    // limit and a bound — is measured WITH its suffixes, in the column it
    // actually lands in.
    ...renderPaydown(
      paydownOf(fixture, { full: true, maxBlind: 40, pessimistic: true }),
      term,
      meta(),
    ),
    ...renderTeam(teamOf(fixture, { full: true }), term, meta()),
  ];
}

describe("--ascii is total", () => {
  const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });

  for (const { name, fixture, path: filePath, person } of FIXTURES) {
    it(`${name} renders no byte above 0x7f`, () => {
      for (const line of everyLine(fixture, filePath, person, term)) {
        const offender = [...line].find((character) => character.charCodeAt(0) > 127);
        expect(offender, `non-ascii ${JSON.stringify(offender)} in: ${line}`).toBeUndefined();
      }
    });
  }
});

describe("the card fits its terminal", () => {
  for (const columns of [80, 100, 132]) {
    it(`no line exceeds ${columns} columns`, () => {
      const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns });
      for (const { fixture, path: filePath, person } of FIXTURES) {
        for (const line of everyLine(fixture, filePath, person, term)) {
          expect(line.length, `too wide: ${line}`).toBeLessThanOrEqual(columns);
        }
      }
    });
  }

  it("wraps the header tail rather than trusting it to fit", () => {
    // `explain --without <query>` puts reader-typed text in the header's TAIL
    // (the simulated() part travels with the timestamp and scorer version),
    // and the tail is several wrappable tokens — the one-unbreakable-token
    // exemption that covers a long path does not cover a joined lens list.
    const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
    const { reading } = readingOf(LONG_NAMES, {
      without: ["konstantin.vasilevsky@enterprise-platform.example"],
    });
    const lines = renderExplain(
      reading,
      selectFile(reading, "packages/platform/services/search/query-planner.ts"),
      term,
      meta(),
    );
    for (const line of lines) {
      expect(line.length, `too wide: ${line}`).toBeLessThanOrEqual(80);
    }
    // The simulation is still named — wrapped, never dropped.
    expect(lines.join("\n")).toContain("(simulated)");
  });

  it("never emits trailing whitespace", () => {
    const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
    for (const { fixture, path: filePath, person } of FIXTURES) {
      for (const line of everyLine(fixture, filePath, person, term)) {
        expect(line, `trailing whitespace: ${JSON.stringify(line)}`).toBe(line.replace(/\s+$/, ""));
      }
    }
  });
});

describe("colour is a layer, never the encoding", () => {
  const plain = createTerm({ noColor: true, env: {}, isTTY: false, columns: 80 });
  const colored = createTerm({ env: { FORCE_COLOR: "1" }, isTTY: false, columns: 80 });
  // Built rather than written as a literal: an escape character inside a regex
  // literal is what `no-control-regex` exists to catch, and disabling the rule
  // to write one is how the next one goes unnoticed.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

  const strip = (lines: readonly string[]): string[] =>
    lines.map((line) => line.replace(ansi, ""));

  it("stripping every escape leaves the plain rendering", () => {
    const { reading, tide } = readingOf(MIXED);
    expect(strip(renderCard(reading, tide, colored, meta()))).toEqual(
      renderCard(reading, tide, plain, meta()),
    );
  });

  it("holds on the cards whose columns are measured, then painted", () => {
    // The offboard row paints two score chips inside one padded row, the keeper
    // row paints a bar inside another, and the paydown card paints a chip pair
    // inside two different padded tables. All are exactly the shape where a
    // column moves the moment a terminal supports colour — an escape has bytes
    // and no width — so the piped output has to be the coloured output with the
    // escapes removed, byte for byte.
    for (const { fixture, person } of FIXTURES) {
      expect(strip(renderOffboard(offboardOf(fixture, person), colored, meta()))).toEqual(
        renderOffboard(offboardOf(fixture, person), plain, meta()),
      );
      expect(strip(renderPaydown(paydownOf(fixture, { maxBlind: 40 }), colored, meta()))).toEqual(
        renderPaydown(paydownOf(fixture, { maxBlind: 40 }), plain, meta()),
      );
      expect(strip(renderTeam(teamOf(fixture), colored, meta()))).toEqual(
        renderTeam(teamOf(fixture), plain, meta()),
      );
      // `explain` joined this list when its score line and factor table were
      // painted: the table pads four columns and then colours two of them, so
      // it is the same shape as the rows above and fails the same way — a
      // column that moves the moment a terminal supports colour.
      const { reading } = readingOf(fixture);
      const file = reading.files[0];
      if (file !== undefined) {
        expect(
          strip(renderExplain(reading, file, colored, meta())),
        ).toEqual(renderExplain(reading, file, plain, meta()));
      }
    }
  });
});
