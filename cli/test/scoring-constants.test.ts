import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BLIND_SPOT_THRESHOLD, WEIGHTS } from "../../lib/demo-data";
import { SCORER_VERSION } from "../src/version";

/**
 * THE SCORING CONSTANTS LIVE IN ONE PLACE, AND THE CLI IS NOT IT.
 *
 * The whole claim of `npx fathohm` is that it runs the same scorer the hosted
 * product runs — which is what makes its floor a genuine lower bound on the
 * hosted reading rather than a second opinion that happens to be in the same
 * neighbourhood. A constant copied into `cli/` would not break a test the day
 * it was copied. It would break the day somebody moved the line in
 * `lib/demo-data.ts` and every hosted surface followed except this one, and by
 * then the two numbers disagreeing would look like a bug in the reading.
 *
 * So: no literal of the line, the weights, or the decay window anywhere in
 * `cli/src`, and the shared modules are the only source they come from. This is
 * the grep the plan's self-review note asks for, made executable.
 *
 * **What is deliberately NOT on the list**, because it is shape rather than
 * scoring: `DAY_MS` (24 × 60 × 60 × 1000), `TIDE_MONTHS` (12 monthly points),
 * `FORECAST_STEP_DAYS` (30 days between forecast points), `DEFAULT_HORIZON_DAYS`
 * (90, `fade`'s default window and a flag the user overrides), and the terminal
 * widths. None of them enters a score; all of them describe a strip or a
 * command's default reach. The point of this file is the LINE and the WEIGHTS.
 */

const SRC_DIR = path.join(process.cwd(), "cli", "src");

/**
 * The literals a score is made of.
 *
 * `0.30` is the line. `0.40 / 0.25 / 0.25 / 0.10` are the factor weights.
 * `180` is the recency window in days, and `15552000000` is the same number
 * after somebody has "optimised" it into milliseconds.
 */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /\b0\.(?:30?|40?|25|10?)\b/g, what: "the line, or a factor weight" },
  { pattern: /\b180\b/g, what: "the recency window, in days" },
  { pattern: /\b15552000000\b/g, what: "the recency window, in milliseconds" },
  { pattern: /\b180\s*\*\s*24\b/g, what: "the recency window, spelled out" },
];

/** Where each shared name must come from — never from a local definition. */
const IMPORTED_FROM: ReadonlyArray<{ name: string; module: RegExp }> = [
  { name: "BLIND_SPOT_THRESHOLD", module: /lib\/demo-data/ },
  { name: "WEIGHTS", module: /lib\/demo-data/ },
  { name: "scoreFromFactors", module: /lib\/demo-data/ },
  { name: "deriveFactors", module: /workers\/src\/scorer/ },
  { name: "decay", module: /workers\/src\/scorer/ },
  { name: "engagementWeight", module: /workers\/src\/scorer/ },
];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found.sort();
}

/** Comment lines, stripped by their leading marker. The prose is allowed to
 *  SAY "the line is 0.30" — explaining a constant is not redefining it. */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

function sources(): Array<{ name: string; text: string }> {
  return walk(SRC_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({
      name: path.relative(process.cwd(), file),
      text: code(readFileSync(file, "utf8")),
    }));
}

describe("no scoring constant is restated in cli/src", () => {
  for (const { pattern, what } of FORBIDDEN) {
    it(`contains no literal for ${what}`, () => {
      for (const { name, text } of sources()) {
        const hits = [...text.matchAll(new RegExp(pattern.source, "g"))].map((match) =>
          text.slice(Math.max(0, match.index - 60), match.index + 30).trim(),
        );
        expect(hits, `${name} restates ${what}`).toEqual([]);
      }
    });
  }

  it("re-exports none of them either", () => {
    // A re-export is a second name for the same value today and a fork of it
    // the first time somebody edits the wrong file.
    for (const { name, text } of sources()) {
      for (const shared of ["BLIND_SPOT_THRESHOLD", "WEIGHTS"]) {
        expect(text, `${name} re-exports ${shared}`).not.toMatch(
          new RegExp(`export\\s+(const|let|var)\\s+${shared}\\b`),
        );
      }
    }
  });
});

describe("every shared name arrives by import", () => {
  for (const { name: shared, module } of IMPORTED_FROM) {
    it(`${shared} is imported wherever it is used`, () => {
      for (const { name, text } of sources()) {
        if (!new RegExp(`\\b${shared}\\b`).test(text)) continue;
        const imports = [...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)];
        const source = imports.find(
          (match) =>
            new RegExp(`\\b${shared}\\b`).test(match[1]) && module.test(match[2]),
        );
        expect(source, `${name} uses ${shared} without importing it from ${module.source}`)
          .toBeDefined();
      }
    });
  }
});

describe("the CLI reads the same numbers the dashboard does", () => {
  it("uses one line and four weights that sum to one", () => {
    // A property, not a value: this passes whatever the line becomes, and
    // fails the moment `cli/` starts reading a different set from the one
    // `lib/demo-data.ts` publishes.
    expect(BLIND_SPOT_THRESHOLD).toBeGreaterThan(0);
    expect(BLIND_SPOT_THRESHOLD).toBeLessThan(1);
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("states which scorer it ran", () => {
    // Imported from `workers/src/scorer` via `version.ts` — the card prints it,
    // `--version` prints it, and a scorer bump therefore reaches the CLI's own
    // output without anybody editing a string here.
    expect(SCORER_VERSION).toMatch(/^v\d+$/);
  });
});
