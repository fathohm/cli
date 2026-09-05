import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import { holdsAtCeiling } from "../reading/fade";
import type { RepoReading, ScoredFile } from "../reading/scoring";
import type { Term } from "./term";
import { renderHeader, scopeNote, type RenderMeta } from "./meta";
import {
  INDENT,
  formatBytes,
  isoSeconds,
  padEnd,
  padStart,
  paragraph,
  truncatePath,
} from "./text";

/**
 * `fathohm fade` — the files that cross the line next.
 *
 * The one surface in the product that is about the future, and the reason it
 * is allowed to be: nothing here is predicted. Every factor in a comprehension
 * score is static except recency, recency moves on the scorer's own published
 * curve, and so "this file goes under on the 14th of August" is the same
 * arithmetic the dashboard will run that morning, run today. `fade.ts` finds
 * the day by bisection; this file only prints it.
 *
 * Soonest first, then heaviest — a date question first, because the point of
 * the table is to act before the date, and bytes only break ties. Files
 * already below the line are absent: they have faded, and a list that keeps
 * pointing at them never points at the one still worth saving.
 */

const DATE_WIDTH = 10;
const SCORE_WIDTH = 5;
const SIZE_WIDTH = 6;
const MARK_WIDTH = 2;

/**
 * How many crossings the table prints before it stops and says so.
 *
 * A terminal table is a thing you ACT on, and twenty rows is already more than
 * one working week's worth of "go and read this file". Printing four hundred
 * would not be more honest, it would be less useful: the soonest crossing —
 * the row the whole table exists for — would scroll off the top of the
 * terminal, and the reader would be left with the least urgent one on screen.
 * The full set is not withheld: `--json` carries every crossing, and the
 * footer says so on the same screen as the cut.
 */
export const MAX_ROWS = 20;

/**
 * Every file that crosses the line inside the horizon, soonest first then
 * heaviest — the FULL set, in the one order the product has for it.
 *
 * Exported because `--json` carries every crossing while the table prints
 * twenty: two orderings of the same question would be two answers, and the
 * footer that points at `--json` would be pointing at a different list.
 */
export function crossingFiles(reading: RepoReading): ScoredFile[] {
  return reading.files
    .filter((file) => file.fadesAt !== null)
    .sort(bySoonestThenHeaviest);
}

export function renderFade(reading: RepoReading, term: Term, meta: RenderMeta): string[] {
  const lines = renderHeader(term, [
    `${meta.target} ${term.glyph("dot")} crossings within ${meta.horizonDays} days`,
    isoSeconds(reading.now),
    `scorer ${meta.scorerVersion}`,
  ]);
  lines.push(...scopeNote(reading, term));
  const width = term.width - INDENT.length;

  const crossing = crossingFiles(reading);

  if (crossing.length === 0) {
    lines.push("", ...paragraph(nothingCrosses(reading, meta, term), width));
    return lines;
  }

  const mark = term.glyph("ok");
  // The mark sits in a LEFT gutter and the path runs last, unpadded. A mark in
  // the final column would have to be reached across a field of spaces the eye
  // cannot follow, and every row would end in trailing whitespace that is
  // invisible on a terminal and load-bearing in a golden file.
  const gutter = MARK_WIDTH + 1;
  const pathWidth = Math.max(
    16,
    term.width - INDENT.length - gutter - DATE_WIDTH - SCORE_WIDTH - SIZE_WIDTH - 3,
  );

  lines.push(
    "",
    INDENT +
      " ".repeat(gutter) +
      padEnd("fades on", DATE_WIDTH) +
      " " +
      padStart("score", SCORE_WIDTH) +
      " " +
      padStart("size", SIZE_WIDTH) +
      " " +
      "path",
  );

  let anyHolds = false;
  for (const file of crossing.slice(0, MAX_ROWS)) {
    const holds = holdsAtCeiling(file);
    anyHolds = anyHolds || holds;
    lines.push(
      INDENT +
        padEnd(holds ? mark : "", gutter) +
        padEnd(file.fadesAt ?? "", DATE_WIDTH) +
        " " +
        padStart(file.floor.toFixed(3), SCORE_WIDTH) +
        " " +
        padStart(formatBytes(file.bytes), SIZE_WIDTH) +
        " " +
        truncatePath(file.path, pathWidth, term.glyph("ellipsis")),
    );
  }

  const hidden = crossing.length - Math.min(crossing.length, MAX_ROWS);
  if (hidden > 0) {
    lines.push(
      `${INDENT}${term.glyph("ellipsis")} and ${hidden} more ` +
        `${hidden === 1 ? "crossing" : "crossings"} ${term.glyph("dash")} --json has the full set`,
    );
  }

  if (anyHolds) {
    lines.push(
      "",
      ...paragraph(
        `${mark} holds if reviews credited ${term.glyph("dash")} the file was pull-request ` +
          `mediated, so a review record would keep it above the line whatever the clock does.`,
        width,
      ),
    );
  }
  return lines;
}

/**
 * Two different silences, said differently.
 *
 * "Nothing crosses in the next ninety days" is good news. "Everything is
 * already under" is the opposite, and a table that printed the same sentence
 * for both would be the product's worst reading looking like its best.
 */
function nothingCrosses(reading: RepoReading, meta: RenderMeta, term: Term): string {
  const dash = term.glyph("dash");
  if (reading.files.length === 0) {
    return `Nothing to fathom here yet ${dash} this tree holds no code.`;
  }
  const above = reading.files.filter((file) => file.floor >= BLIND_SPOT_THRESHOLD).length;
  return above === 0
    ? `Every scored file is already below the line ${dash} there is nothing left to fade.`
    : `No file crosses the line within ${meta.horizonDays} days. ` +
        `${above} of ${reading.files.length} files are holding above it.`;
}

/** ISO dates compare lexicographically exactly as they compare chronologically. */
function bySoonestThenHeaviest(a: ScoredFile, b: ScoredFile): number {
  const left = a.fadesAt ?? "";
  const right = b.fadesAt ?? "";
  if (left !== right) return left < right ? -1 : 1;
  if (a.bytes !== b.bytes) return b.bytes - a.bytes;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
