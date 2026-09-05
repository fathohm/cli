import { blindShareValue, exactBlindShare, formatBlindShare } from "../../../lib/blind-share-format";
import { allocateUnits, pinnedUnits } from "../reading/allocate";
import { darkBytesOf, darkGroups, type DarkGroupSummary } from "../reading/dark";
import type { RepoReading, ScoredFile } from "../reading/scoring";
import { byDisplayOrder } from "../reading/kind";

/**
 * THE LEDGER — GONE DARK as a set of books that add up.
 *
 * The card used to print two sections about the same files: WHY, which said
 * what KIND of engagement was missing in percentages, and BELOW THE LINE, which
 * named five paths. A reader had to join them by hand, and nothing on the screen
 * said the five paths were even drawn from the percentages above. So they became
 * one thing: each group carries a heading, its own files listed under it, and a
 * share that adds up down the column to the headline.
 *
 * WHAT IT IS CUT ON CHANGED AT 1.5.0, and the ledger did not. It used to
 * partition the files BELOW THE LINE by which kind of engagement was missing —
 * `lib/reading-explained`'s buckets, which is the hosted reading's own
 * decomposition. But the CLI stopped headlining a comprehension-debt share it
 * cannot measure (see `cli/src/reading/dark.ts`), and a ledger that decomposes a number
 * the card no longer prints is a column that does not add up to anything on the
 * screen. So the partition is now `darkGroups`, cut on the same predicate the
 * headline is: no human wrote or prompted it inside the recency window.
 *
 * THE LOAD-BEARING FACT survives the change verbatim. `darkReasonOf` is a TOTAL
 * function on a scored file with no null case, so "the groups plus the coda are
 * the whole repository" is a property of the partition rather than a claim this
 * file makes. Every group here is one of its members, unchanged; nothing is
 * re-derived.
 *
 * ── THE PRINTED-SUM RULE ────────────────────────────────────────────────────
 *
 * A ledger that does not add up in a screenshot refutes the product. Rounding
 * each share on its own does not add up: three buckets of 33.3 print 33+33+33
 * and a reader counts 99 against a headline of 100.
 *
 * So the shares are ALLOCATED, not rounded, and the arithmetic runs in one
 * direction:
 *
 *   1. THE HEADLINE IS THE AUTHORITY. Its printed value is computed exactly as
 *      it always was, by `formatBlindShare` over the blind bytes. The ledger
 *      never moves it — it is the number people quote.
 *   2. The dark groups share out exactly that many units by LARGEST REMAINDER:
 *      floor every exact percentage, then hand the leftover units to the
 *      largest fractions first.
 *   3. The coda takes what is left of a hundred. It is the lit group, and it is
 *      printed as the remainder rather than rounded independently, because two
 *      independent roundings of complementary shares can both be right and
 *      still print 101.
 *
 * DISPLAY FLOORS SURVIVE THIS, AND THEY ARE THE ONE EXCEPTION. The units always
 * sum to a hundred. The printed TEXT sums to a hundred too, except on a row
 * inside a display floor — `<1%` and `>99%` are deliberately not integer claims,
 * and a repository that is 99.9% dark must print `>99%` beside `<1%` rather
 * than `100%` beside `0%`, which would claim a codebase with no human hand
 * anywhere in it. So a floored group is PINNED to the units its floor can
 * defend and never receives a remainder unit it could not show. The exception
 * is exactly the set of rows whose exact share is inside a floor, which is a
 * property the guardrail test asserts rather than a caveat in prose.
 */

/** How many file rows the card prints across all groups before it defers to `--full`. */
export const TOP_PATHS = 5;

export interface LedgerGroup {
  readonly group: DarkGroupSummary;
  /** The share as PRINTED — allocated under the headline, floors respected. */
  readonly printed: string;
  /** The integer units this group was allocated. `<1%` groups carry zero. */
  readonly units: number;
  /** Every file in the group, in display order. */
  readonly files: ScoredFile[];
  /** How many of them the card prints. A nonzero group still prints its heading. */
  readonly rowCount: number;
  /**
   * THE GROUP'S PLACE ON THE CARD'S ONE COLOUR SCALE: the byte-weighted share
   * of the group that is NOT dark, 0..1 — the same quantity the mini-map's
   * bars carry, so a heading and a bar of the same colour say the same thing.
   *
   * On a ledger group this is 0 by construction and on the coda it is 1, which
   * is the point: the colour says "these are the dark ones, that one is not",
   * which is the ledger's entire argument made without a word. It is COMPUTED
   * rather than written as the two constants it currently evaluates to, so a
   * future group that is only partly dark colours itself correctly instead of
   * inheriting a literal that stopped being true.
   */
  readonly score: number;
}

export interface Ledger {
  /** The dark groups, byte-share descending — `darkGroups`' own order. */
  readonly groups: LedgerGroup[];
  /** The lit coda and its printed remainder, or null when nothing is lit. */
  readonly lit: {
    readonly group: DarkGroupSummary;
    readonly printed: string;
    readonly units: number;
    /** The coda's own place on the scale, as {@link LedgerGroup.score}. */
    readonly score: number;
  } | null;
  /** Every dark file, in PRINT order: group by group, display order within. */
  readonly order: ScoredFile[];
  /** The rows the card actually prints, in print order. */
  readonly rows: ScoredFile[];
}

/**
 * The whole ledger for one reading. Pure: no terminal, no clock of its own.
 *
 * The groups are every member of the partition that is not `lit` — not a list
 * of the three dark ids. That is what makes the sum total BY CONSTRUCTION:
 * whatever the partition contains, this prints all of it, so groups + coda is
 * the repository however the reasons are extended later. A hand-written list of
 * ids would silently drop a future reason, and a dropped group is how a
 * denominator starts lying.
 */
export function ledgerOf(reading: RepoReading): Ledger {
  const partition = darkGroups(reading.files, reading.scoredBytes, reading.now);
  const litGroup = partition.find((group) => group.id === "lit") ?? null;
  const darkOnly = partition.filter((group) => group.id !== "lit");

  const budget = headlineUnits(reading);
  const units = allocateUnits(
    darkOnly.map((group) => group.share * 100),
    budget,
  );

  const files = darkOnly.map((group) => [...group.files].sort(byDisplayOrder));
  const rowCounts = allocateRows(
    darkOnly.map((group, index) => ({
      bytes: group.bytes,
      fileCount: files[index].length,
    })),
    TOP_PATHS,
  );

  const groups = darkOnly.map((group, index) => ({
    group,
    printed: printedShare(units[index], group.share * 100),
    units: units[index],
    files: files[index],
    rowCount: rowCounts[index],
    score: litFraction(group.files),
  }));

  return {
    groups,
    lit:
      litGroup === null
        ? null
        : {
            group: litGroup,
            printed: codaShare(budget, litGroup.share * 100),
            units: 100 - budget,
            score: litFraction(litGroup.files),
          },
    order: groups.flatMap((group) => group.files),
    rows: groups.flatMap((group) => group.files.slice(0, group.rowCount)),
  };
}

/**
 * A set of files as one point on the card's colour scale: the byte-weighted
 * share of them that is NOT dark.
 *
 * The same arithmetic `miniMapRows` runs over a directory, so the ledger's
 * headings and the map's bars are the same encoding of the same fact rather
 * than two scales that happen to share a ramp. Empty reads as zero: a group
 * with no bytes in it has nothing to colour, and the card never prints one.
 */
function litFraction(files: readonly ScoredFile[]): number {
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (bytes <= 0) return 0;
  return 1 - darkBytesOf(files) / bytes;
}

/**
 * The headline's own printed value, as units of a hundred.
 *
 * `blindShareValue` rather than `formatBlindShare` because the percent sign is
 * forbidden in this directory — every share reaches the terminal through
 * `lib/blind-share-format`, and a renderer that types the sign has bypassed the
 * floors. The two display floors map to the units they claim: `<1` is under one
 * whole unit, and `>99` is ninety-nine plus a fraction.
 */
function headlineUnits(reading: RepoReading): number {
  const value = blindShareValue(exactBlindShare(reading.darkBytes, reading.scoredBytes));
  if (value === UNDER_ONE) return 0;
  if (value === OVER_NINETY_NINE) return 99;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The two display floors, by the value `blindShareValue` returns for them. */
const UNDER_ONE = "<1";
const OVER_NINETY_NINE = ">99";

/** An allocated share as text, with the floors applied to the EXACT value. */
export function printedShare(units: number, percent: number): string {
  const pinned = pinnedUnits(percent);
  return pinned === null ? formatBlindShare(units) : formatBlindShare(percent);
}

/**
 * The coda's share: whatever is left of a hundred.
 *
 * Not `formatBlindShare` of the lit group. Two complementary shares rounded
 * independently can both be correct and still print 101 — 74.5 and 25.5 round
 * to 75 and 26 — and the one thing this line exists to do is close the sum. The
 * floors still apply to the exact value, because a repository with four lit
 * files out of nine hundred must not read `0%`.
 */
function codaShare(budget: number, percent: number): string {
  const pinned = pinnedUnits(percent);
  return pinned === null ? formatBlindShare(100 - budget) : formatBlindShare(percent);
}

/**
 * The row budget, shared out by group weight.
 *
 * Largest remainder again, clamped to what each group actually holds: a group
 * of one file cannot print two rows, and the unit it cannot use goes to the
 * next-biggest group rather than being lost. A group that ends with zero rows
 * still prints its heading — the heading is the finding, and the rows are
 * evidence for it.
 */
export function allocateRows(
  groups: ReadonlyArray<{ readonly bytes: number; readonly fileCount: number }>,
  total: number,
): number[] {
  if (groups.length === 0) return [];

  const totalBytes = groups.reduce((sum, group) => sum + group.bytes, 0);
  // WEIGHT BY FILES WHEN THERE ARE NO BYTES TO WEIGH BY. Returning zero rows
  // here made the whole GONE DARK section vanish from a card whose dark files
  // were all EMPTY — `__init__.py`, `py.typed`, a placeholder `index.ts` — while
  // `--full` still listed them, `explain 1` still resolved one, and `--json`
  // still carried the group. The section is the release's decomposition; it
  // does not get to disappear because its subject weighs nothing.
  //
  // Byte weighting stays the rule everywhere it CAN apply: this branch is
  // reached only when the entire dark set is zero bytes, where any byte-based
  // allocation is a division by zero rather than a judgement.
  const weights =
    totalBytes > 0
      ? groups.map((group) => group.bytes)
      : groups.map((group) => group.fileCount);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return groups.map(() => 0);

  const exact = groups.map((_group, index) => (total * weights[index]) / totalWeight);
  const allocation = groups.map((group, index) =>
    Math.min(Math.floor(exact[index]), group.fileCount),
  );

  let remaining = total - allocation.reduce((sum, rows) => sum + rows, 0);
  while (remaining > 0) {
    let best = -1;
    for (let index = 0; index < groups.length; index += 1) {
      if (allocation[index] >= groups[index].fileCount) continue;
      if (best === -1) {
        best = index;
        continue;
      }
      const mine = exact[index] - allocation[index];
      const theirs = exact[best] - allocation[best];
      if (mine > theirs || (mine === theirs && groups[index].bytes > groups[best].bytes)) {
        best = index;
      }
    }
    if (best === -1) break;
    allocation[best] += 1;
    remaining -= 1;
  }

  return allocation;
}
