import type { Engagement } from "../../../lib/demo-data";
import { newestContact } from "../reading/dark";
import type { RepoReading, ScoredFile } from "../reading/scoring";
import type { Term } from "./term";
import { ledgerOf, type Ledger } from "./ledger";
import { daysBetween } from "../reading/days";
import { INDENT, padEnd, truncatePath } from "./text";

/**
 * GONE DARK — the print order, and the rows the card prints from it.
 *
 * This was inside `card.ts` until three surfaces needed the same list and the
 * same numbering. It is a shared CONTRACT now, not a layout helper:
 *
 *   - the card's GONE DARK section prints these rows under their headings;
 *   - `fathohm explain 3` resolves the third file of the FULL ordering;
 *   - the interactive selector lists the same rows the card just printed.
 *
 * THE ORDER IS THE LEDGER'S, and that is the whole of it. `./ledger` groups the
 * dark files by reason, orders the groups the way the card prints them, and
 * orders the files inside each group by tier, then bytes, then path. Reading it
 * top to bottom IS the card's numbering, so `explain 1` names the row the card
 * put first and cannot mean anything else. A second sort here — "by bytes,
 * obviously" — would number rows the reader is not looking at, which is the
 * failure mode an ordinal argument has to be incapable of.
 *
 * GROUP HEADINGS ARE NOT ROWS. They belong to the card, and the picker never
 * lists one: a cursor that could land on "NO HUMAN WROTE OR PROMPTED IT IN
 * GIT'S RECORD" and be asked to explain it would be offering a file that does
 * not exist. What flows through here is files.
 *
 * ── WHAT LEFT THESE ROWS AT 1.5.0, AND WHY ──────────────────────────────────
 *
 * The score, and every clause about the review record.
 *
 * A row used to open with `0.08` and close with "no PR record" or "review
 * unrecorded". Both were true and both belonged to a headline the card no
 * longer prints: the section is now cut on whether a HUMAN HAS TOUCHED the file
 * inside the window, and a review record is neither the predicate nor anything
 * that could change it. Leaving them would have put a comprehension-debt score
 * beside a file selected for a different reason, in a column a reader would
 * reasonably read as the reason it is listed.
 *
 * The score has not gone anywhere a reader cannot reach it: `fathohm explain
 * <path>` decomposes it factor by factor, `--full` prints it against every dark
 * path, and the card's closing block names the whole interval. It is off the
 * ROW, which is four seconds of somebody's attention, not out of the tool.
 */

export type { Ledger } from "./ledger";
export { TOP_PATHS } from "./ledger";

/**
 * Every dark file, in the order the card prints them — group by group, tier by
 * tier. One definition, because a second one would eventually disagree with the
 * numbers printed beside it.
 */
export function darkFiles(reading: RepoReading): ScoredFile[] {
  return ledgerOf(reading).order;
}

export interface BelowRow {
  readonly file: ScoredFile;
  /**
   * The row as the card prints it, WITHOUT its leading indent. The indent is
   * the caller's: the card hangs it off {@link INDENT}, and the selector puts
   * a cursor cell of exactly that width there instead.
   */
  readonly body: string;
}

/** A path column narrower than this stops naming a file. */
const MIN_PATH_WIDTH = 16;

/**
 * The card's rows: the path, and the two clauses that say why the file is here.
 * Laid out once so the selector lists what the card printed rather than a
 * second rendering of the same files that could drift a column.
 */
export function darkRows(reading: RepoReading, term: Term): BelowRow[] {
  return rowsOf(ledgerOf(reading), reading, term);
}

/**
 * The same rows, from a ledger the caller already has.
 *
 * The card computes one ledger for its hero line, its headings and its coda;
 * handing that one back rather than recomputing is not an optimisation, it is
 * the guarantee that the rows under the headings are the rows the ordinal
 * numbers.
 *
 * THE COLUMN IS SHARED ACROSS GROUPS. Every printed row is measured together,
 * so the score, path and reason columns line up down the whole section rather
 * than restarting under each heading — a ledger whose columns stepped sideways
 * at every group would read as several different tables.
 *
 * TWO COLUMNS, TWO ROLES, AND NEITHER OF THEM IS COLOUR.
 *
 *   - the PATH is DATA and stays plain. It was plain when there was a score
 *     beside it too: colouring a filename would be the one place on the card
 *     where a hue means something other than the headline's own quantity;
 *   - the CLAUSE is dim, because it is the evidence for the listing rather
 *     than a claim of its own — the same weight the row rule under the section
 *     head takes.
 *
 * Colour left these rows with the score column. Every dark row is dark to
 * exactly the same degree — that is what the predicate means — so a per-row hue
 * would have been a scale with one value on it, which is decoration. The card's
 * colour now lives where it still varies: the big number, the mini-map's bars,
 * and the group headings against the lit coda.
 *
 * EVERY COLUMN IS MEASURED BEFORE IT IS PAINTED. An escape sequence has bytes
 * and no width, so a padded coloured cell is a column that moves the moment a
 * terminal supports colour. The padding is computed from the plain text and the
 * escape goes strictly around the visible characters.
 */
export function rowsOf(ledger: Ledger, reading: RepoReading, term: Term): BelowRow[] {
  const top = ledger.rows;
  if (top.length === 0) return [];

  const reasons = top.map((file) => whyDark(file, reading.now, term));
  const widestReason = Math.max(...reasons.map((reason) => reason.length));
  // The path column is the slack: it takes what the reason leaves, but never
  // more than the longest path actually needs — a column padded past its
  // content is a gutter, and a gutter looks like a missing value.
  const pathWidth = Math.min(
    Math.max(...top.map((file) => file.path.length)),
    Math.max(MIN_PATH_WIDTH, term.width - INDENT.length - 2 - widestReason),
  );

  return top.map((file, index) => ({
    file,
    body:
      padEnd(truncatePath(file.path, pathWidth, term.glyph("ellipsis")), pathWidth) +
      "  " +
      term.color(reasons[index], "dim"),
  }));
}

/** The two clauses, joined. Both are read off the file's own engagement record. */
export function whyDark(file: ScoredFile, now: Date, term: Term): string {
  const engagement = file.factors.engagement;
  const keepers = keeperClause(engagement);
  const contact = contactClause(engagement, now);
  return keepers === null ? contact : `${contact} ${term.glyph("dot")} ${keepers}`;
}

/**
 * When a human last touched it, and by which hand — the NEWEST of the two
 * contacts, which is the one `darkReasonOf` classified the file on. Reading a
 * different contact here than the heading above the row read would put a file
 * described as "hand-written 900+ days ago" under a heading about prompting.
 */
function contactClause(engagement: Engagement, now: Date): string {
  const newest = newestContact(engagement);
  if (newest === null) return "no human commits";
  const age = `${daysBetween(new Date(newest), now)}d ago`;
  return newest === engagement.last_hand_authored
    ? `hand-written ${age}`
    : `prompted ${age}`;
}

/**
 * How many humans are in the file's history at all, or null when the contact
 * clause has already said there are none.
 *
 * "N HUMANS IN ITS HISTORY", NOT "BUS FACTOR N". They are the same count and
 * they are not the same sentence. "Bus factor" is a claim about an
 * ORGANISATION — how many people it can lose before the work stops — and this
 * reading has no view of who still works here, who else has read the file, or
 * who could pick it up tomorrow. What git actually carries is how many humans
 * appear in this file's commit history, which is checkable against the same
 * clone the card was printed from. The FACTOR keeps its name inside `fathohm
 * explain`, where it is a decomposed scorer input beside its weight and its
 * contribution rather than a phrase in a headline section.
 *
 * WHAT USED TO BE HERE was "no PR record" / "review unrecorded" — true clauses
 * about the review record, on rows that are no longer selected by anything to
 * do with reviews. See this module's header.
 */
function keeperClause(engagement: Engagement): string | null {
  const { full, prompted } = engagement.contributors;
  const humans = full + prompted;
  if (humans === 0) return null;
  return `${humans} ${humans === 1 ? "human" : "humans"} in its history`;
}
