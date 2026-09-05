import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MIXED, readingOf } from "../../test-helpers/reading-fixtures";
import { evaluateCheck } from "../reading/check";
import { renderCard } from "./card";
import { renderCheckMarkdown } from "./check";
import { renderExplain, selectFile } from "./explain";
import type { RenderMeta } from "./meta";
import { createTerm } from "./term";
import { SCORER_VERSION } from "../version";

/**
 * THE README PRINTS REAL OUTPUT, OR IT PRINTS A LIE.
 *
 * `cli/README.md` is shipped inside the npm tarball — it is the page a stranger
 * reads on the package listing before deciding to run anything — and its
 * `explain` sample is the one place the "no black boxes" claim is actually
 * demonstrated rather than asserted.
 *
 * It had drifted. The sample still showed a header from before the `ONE FILE`
 * scope tag and the `in <repo>` line, both of which shipped in 1.5.6, and it
 * predated the sentence disclosing that no file can score above 0.900. A reader
 * comparing the page against their own terminal would have found three
 * differences and no way to know which of the two was current.
 *
 * So the block is asserted against a live render rather than maintained by
 * hand. Docs going stale is not a discipline problem to solve with more care;
 * it is a test that was missing.
 */

const README = path.join(__dirname, "..", "..", "README.md");

const META: RenderMeta = {
  target: "acme-api",
  quiet: false,
  full: false,
  horizonDays: 90,
  scorerVersion: SCORER_VERSION,
};

/** The card exactly as a reader's terminal draws it: unicode, no colour, 80. */
function sample(): string {
  const { reading } = readingOf(MIXED);
  const file = selectFile(reading, "workers/src/scorer.ts");
  const term = createTerm({ noColor: true, ascii: false, env: {}, isTTY: false, columns: 80 });
  return renderExplain(reading, file, term, META).join("\n");
}

/** The fenced block whose first line is `opening`, from `nth` occurrence. */
function fenced(text: string, opening: string, nth = 0): string {
  let at = -1;
  for (let i = 0; i <= nth; i += 1) {
    // Located by opening LINE rather than by a counted fence: the file carries
    // dozens of code blocks and a positional index would silently move.
    at = text.indexOf(`\`\`\`\n${opening}`, at + 1);
    expect(at, `sample ${nth} opening ${opening} not found`).toBeGreaterThan(-1);
  }
  const from = at + 4;
  const end = text.indexOf("\n\`\`\`", from);
  expect(end).toBeGreaterThan(from);
  return text.slice(from, end);
}

/** The `read` card as a reader's terminal draws it. */
function card(quiet: boolean): string {
  const { reading, tide } = readingOf(MIXED);
  const term = createTerm({ noColor: true, ascii: false, env: {}, isTTY: false, columns: 80 });
  return renderCard(reading, tide, term, { ...META, quiet }).join("\n");
}

describe("the README ships what the CLI prints", () => {
  const text = readFileSync(README, "utf8");
  const OPENING = "FATHOHM — git-only reading of acme-api (12 code files)";

  it("the explain sample", () => {
    // The one place the "no black boxes" claim is demonstrated rather than
    // asserted. This is the block that had drifted.
    expect(fenced(text, "FATHOHM ONE FILE")).toBe(sample());
  });

  it("the card sample", () => {
    expect(fenced(text, OPENING, 0)).toBe(card(false));
  });

  it("the --quiet sample", () => {
    expect(fenced(text, OPENING, 1)).toBe(card(true));
  });

  /**
   * The pasteable verdict, from the renderer rather than from a draft.
   *
   * This block is the one on the npm page a reader is most likely to copy the
   * SHAPE of into an expectation — it is what they will paste into a pull
   * request — and it is prose-heavy, unwrapped, and therefore the easiest
   * block in this file to edit by hand and quietly get wrong.
   */
  it("the check --format markdown sample", () => {
    const { reading } = readingOf(MIXED);
    const verdict = evaluateCheck(reading, { maxBlind: 10, pessimistic: false });
    expect(fenced(text, "## fathohm check")).toBe(
      renderCheckMarkdown(reading, verdict, META).join("\n"),
    );
  });

  /**
   * The scoped header, including the sentence that names the denominator.
   *
   * Three lines, and they are the three the whole `--scope` design rests on:
   * the subject naming the subtree, the clock, and the sentence that says the
   * repository's own number is a different number. A README that showed a
   * scoped card WITHOUT that sentence would be documenting the failure the
   * feature exists to prevent.
   */
  it("the --scope header sample", () => {
    const { reading, tide } = readingOf(MIXED, { scope: "lib" });
    const term = createTerm({ noColor: true, ascii: false, env: {}, isTTY: false, columns: 80 });
    const head = renderCard(reading, tide, term, { ...META, target: "acme-api/lib" }).slice(0, 3);
    expect(fenced(text, "FATHOHM — git-only reading of acme-api/lib")).toBe(head.join("\n"));
  });
});
