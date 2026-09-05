import { describe, expect, it } from "vitest";

import { HANDOVER, readingOf } from "../../test-helpers/reading-fixtures";
import { evaluateCheck } from "../reading/check";
import { createTerm } from "./term";
import { SCORER_VERSION } from "../version";
import type { RenderMeta } from "./meta";
import { renderCheck } from "./check";

/**
 * The FAIL pointer — the goldens pin the plain and pessimistic forms; this
 * holds the two properties no golden exercises: the pointed-at command
 * reproduces a `--without` baseline, and a PASS points at nothing.
 */

function meta(): RenderMeta {
  return {
    target: "acme-api",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
  };
}

function flat(lines: readonly string[]): string {
  return lines.join(" ").replace(/\s+/g, " ");
}

describe("the FAIL pointer reproduces the reader's exact gate", () => {
  it("carries the baseline into the paydown command", () => {
    const { reading } = readingOf(HANDOVER, { without: ["sam"] });
    const verdict = evaluateCheck(reading, { maxBlind: 5, pessimistic: true });
    expect(verdict.passed).toBe(false);
    const text = flat(
      renderCheck(
        reading,
        verdict,
        createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 }),
        meta(),
      ),
    );
    expect(text).toContain(
      "the ladder back under this limit: fathohm paydown --max-blind 5 --pessimistic --without sam",
    );
  });

  it("prints no pointer on a PASS — a gate that held needs no next step", () => {
    const { reading } = readingOf(HANDOVER);
    const verdict = evaluateCheck(reading, { maxBlind: 99, pessimistic: false });
    expect(verdict.passed).toBe(true);
    const text = flat(
      renderCheck(
        reading,
        verdict,
        createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 }),
        meta(),
      ),
    );
    expect(text).not.toContain("fathohm paydown");
  });
});
