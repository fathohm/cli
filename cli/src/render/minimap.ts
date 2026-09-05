import { formatBlindShare } from "../../../lib/blind-share-format";
import { isDark } from "../reading/dark";
import type { RepoReading, ScoredFile } from "../reading/scoring";
import type { Term } from "./term";
import { depthColor } from "./ramp";
import { INDENT, padEnd, padStart, truncate } from "./text";

/**
 * THE MINI-MAP — the treemap, at terminal resolution.
 *
 * The hosted Map is the growth loop, and its whole argument is made in one
 * glance: area is bytes, colour is depth, and the red regions are where the
 * comprehension went. A terminal has one dimension to spend, so the bar's
 * LENGTH is the directory's byte share and the SOLID RUN inside it is the part
 * of that directory which is dark — a stacked bar, which is the one chart form
 * nobody has to be taught. A wide bar mostly solid and red is a large part of
 * the repository with no human on its recent record, which is the same sentence
 * the treemap makes with a rectangle.
 *
 * Rows START at the top level and SPLIT where the top level answers nothing.
 * Not one row per file (a thousand rows is not a glance) and not the full tree
 * (a terminal has no zoom): the top level is where a reader's mental model of
 * their own repository lives — they know what `workers/` is for, and being told
 * it is the deep end is immediately actionable.
 *
 * But a repository that keeps everything under `src/` gets one row reading 78%,
 * which is the headline again with a bar drawn round it: nothing in it is a
 * place to go. So any group holding more than `DRILL_SHARE` of the scored bytes
 * is replaced by its own children — one level at a time, repeatedly, so a chain
 * of single-child directories walks down rather than stalling — until no group
 * dominates or the row budget is spent. Deeper rows then sort against top-level
 * ones by SIZE ALONE, with no indent and no tree-drawing: the column is a
 * ranking of where the bytes are, not a picture of the directory structure, and
 * the bars still add up to the whole reading either way.
 *
 * The quantity behind each row is BYTE-WEIGHTED, so a four-line config cannot
 * out-vote a four-thousand-line parser — the same weighting the headline above
 * it uses.
 *
 * WHAT THE BAR ENCODES, and the two revisions it took to get there. At 1.5.0
 * the whole bar was drawn with ONE glyph picked off `BLOCK_RAMP` by the row's
 * darkness — taller block, darker directory — under a headline that had just
 * become the dark share. That fixed a real problem (the ramp used to plot the
 * comprehension score under a number measuring something else, which was two
 * scales on one card) and introduced a worse one: the ramp's bottom rung is
 * `▁`, so a directory with NOTHING dark drew as a hairline. Every clean row
 * looked empty, and a repository with nothing dark anywhere printed a chart of
 * underscores in one flat colour. See `stackedBar` for what replaced it and why
 * the two encodings can no longer erase each other.
 */

/**
 * The row budget: seven directories plus a fold row.
 *
 * It was twelve, and twelve was chosen against the terminal's height rather
 * than against what the rows say. On a real repository the bottom five all read
 * `<1%` of the code and most of them `0% dark` — they were there to complete a
 * partition the fold row already completes, and they pushed the ledger (the
 * part with file names in it) below the fold. A map you have to scroll is not a
 * glance, and neither is one whose tail is five ways of saying "nothing here".
 */
export const MAX_ROWS = 8;

/** Files that live at the repository root, gathered under one label. */
const ROOT_LABEL = "./";

/** Files sitting DIRECTLY in a drilled directory: `src/*` is not `src/`. */
const DIRECT_LABEL = "*";

/**
 * The share above which a row stops being an answer and becomes the headline
 * again: two fifths, 40% of the scored bytes. Two rows can both be over it only
 * for an instant — the first split takes the larger one apart — so in practice
 * the map never leaves the reader with a single cell holding most of the
 * repository and nothing to open.
 *
 * Written as a fraction rather than as `0.4` on purpose. This is a LAYOUT
 * threshold and enters no score, but `0.40` is also the review factor's weight,
 * and cli/test/scoring-constants.test.ts forbids that literal anywhere in
 * `cli/src` so a scoring constant can never be quietly forked into the CLI.
 * Spelling the fraction keeps the guard whole instead of carving an exemption
 * into it that the next `0.4` would slip through.
 */
export const DRILL_SHARE = 2 / 5;

const NAME_WIDTH = 24;
const SHARE_WIDTH = 4;
const MAX_BAR_WIDTH = 35;
const MIN_BAR_WIDTH = 8;

/**
 * The widest the dark clause can render: ` · 100% dark`.
 *
 * Reserved rather than measured, because the bar width has to be the same on
 * every row or the column stops being a comparison — and a bar that got wider
 * whenever the widest clause happened to be short would make two readings of
 * the same repository draw different pictures.
 */
const DARK_CLAUSE_WIDTH = 12;

export interface MiniMapRow {
  /** A top-level directory (trailing slash), or the fold row's own label. */
  name: string;
  bytes: number;
  /** Share of the reading's scored bytes, 0..1. */
  share: number;
  /** How many directories this row stands for — 1, except on the fold row. */
  directoryCount: number;
  /**
   * The share of THIS ROW's own bytes that are dark, 0..1.
   *
   * A second denominator on purpose, and the only one on the card: the bar and
   * the percentage beside it are shares of the repository, and this is a share
   * of the directory. "How much of THIS is dark" is the question a reader
   * actually has about a folder they own, and it is the same predicate the
   * headline above and the section below both select on — so the row's block,
   * its clause, the big number and the ledger are four drawings of one fact.
   */
  darkShare: number;
}

/**
 * The rows, before any of them is drawn. Exported because ordering is a
 * behaviour worth testing on its own: bytes descending, name ascending on a
 * tie, and the tail folded rather than dropped.
 */
export function miniMapRows(reading: RepoReading, maxRows: number = MAX_ROWS): MiniMapRow[] {
  let groups = topLevelGroups(reading.files);

  // The drilldown. One split per pass, always the biggest dominant group, so a
  // repository whose whole weight is under `src/` walks down the chain instead
  // of printing one row that says what the headline already said.
  while (groups.length < maxRows) {
    const dominant = nextToSplit(groups, reading.scoredBytes);
    if (dominant === null) break;
    groups = groups.flatMap((group) => (group === dominant ? split(group) : [group]));
  }

  const all: MiniMapRow[] = groups
    .map((group) => {
      const bytes = totalBytes(group);
      const dark = group.files.reduce(
        (sum, file) => (isDark(file) ? sum + file.bytes : sum),
        0,
      );
      return {
        name: group.name,
        bytes,
        share: reading.scoredBytes > 0 ? bytes / reading.scoredBytes : 0,
        directoryCount: 1,
        darkShare: bytes > 0 ? dark / bytes : 0,
      };
    })
    .sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  if (all.length <= maxRows) return all;

  // The tail is folded, never dropped: the bars have to add up to the whole
  // repository or the mini-map is a picture of a different denominator than
  // the headline over it.
  const kept = all.slice(0, maxRows - 1);
  const rest = all.slice(maxRows - 1);
  const bytes = rest.reduce((sum, row) => sum + row.bytes, 0);
  const dark = rest.reduce((sum, row) => sum + row.darkShare * row.bytes, 0);
  kept.push({
    name: "",
    bytes,
    share: reading.scoredBytes > 0 ? bytes / reading.scoredBytes : 0,
    directoryCount: rest.length,
    darkShare: bytes > 0 ? dark / bytes : 0,
  });
  return kept;
}

/**
 * A candidate row, still holding its files because a row that might be split
 * has to be able to hand them to its children.
 */
interface Group {
  /** The label the row draws: `src/`, `src/app/`, `src/*`, or `./`. */
  readonly name: string;
  /** The path prefix its files share. Empty for the root group. */
  readonly prefix: string;
  /** False for `./` and for every `*` group — neither has a level below it. */
  readonly drillable: boolean;
  readonly files: readonly ScoredFile[];
}

function topLevelGroups(files: readonly ScoredFile[]): Group[] {
  const byName = new Map<string, ScoredFile[]>();
  for (const file of files) {
    const name = topLevel(file.path);
    const bucket = byName.get(name);
    if (bucket === undefined) byName.set(name, [file]);
    else bucket.push(file);
  }
  return [...byName.entries()].map(([name, group]) => ({
    name,
    prefix: name === ROOT_LABEL ? "" : name,
    // The repository root has no directory above these files to descend from,
    // so `./` is a leaf however heavy it gets.
    drillable: name !== ROOT_LABEL,
    files: group,
  }));
}

/**
 * The biggest group over the line, or null when none is left.
 *
 * STRICTLY greater: a group sitting on exactly the threshold is not dominant,
 * and a boundary that fires on equality would split a two-directory repository
 * forever at 50/50 minus rounding.
 *
 * Ties break on name ascending. Two directories of identical weight is not a
 * contrived case (a mirrored `src/`/`test/` tree makes one), and "whichever the
 * tree listed first" is exactly the kind of ordering luck the determinism
 * contract exists to forbid.
 */
function nextToSplit(groups: readonly Group[], scoredBytes: number): Group | null {
  if (scoredBytes <= 0) return null;
  let best: Group | null = null;
  for (const group of groups) {
    if (!isExpandable(group)) continue;
    const bytes = totalBytes(group);
    if (bytes / scoredBytes <= DRILL_SHARE) continue;
    if (best === null || bytes > totalBytes(best) || (bytes === totalBytes(best) && group.name < best.name)) {
      best = group;
    }
  }
  return best;
}

/**
 * A group is expandable only when something under it is STRICTLY deeper than
 * its own prefix. Without that test, a `src/` holding nothing but loose files
 * would split into a `src/*` of exactly the same weight, qualify again, and
 * split again forever.
 */
function isExpandable(group: Group): boolean {
  if (!group.drillable) return false;
  return group.files.some((file) => file.path.slice(group.prefix.length).includes("/"));
}

/**
 * One level down. Each file joins the group named by its next path segment, or
 * — if it sits directly at this level — the group named `prefix*`, which is a
 * real row rather than a remainder: "the files loose in `src/`" is a thing a
 * reader can go and look at.
 */
function split(group: Group): Group[] {
  const byName = new Map<string, ScoredFile[]>();
  for (const file of group.files) {
    const rest = file.path.slice(group.prefix.length);
    const cut = rest.indexOf("/");
    const name =
      cut === -1 ? `${group.prefix}${DIRECT_LABEL}` : `${group.prefix}${rest.slice(0, cut)}/`;
    const bucket = byName.get(name);
    if (bucket === undefined) byName.set(name, [file]);
    else bucket.push(file);
  }
  return [...byName.entries()].map(([name, files]) => ({
    name,
    prefix: name.endsWith(DIRECT_LABEL) ? group.prefix : name,
    drillable: !name.endsWith(DIRECT_LABEL),
    files,
  }));
}

function totalBytes(group: Group): number {
  return group.files.reduce((sum, file) => sum + file.bytes, 0);
}

function topLevel(path: string): string {
  const cut = path.indexOf("/");
  return cut === -1 ? ROOT_LABEL : `${path.slice(0, cut)}/`;
}

/**
 * The row budget when NOTHING in the reading is dark.
 *
 * With a dark share to compare, twelve rows are twelve different answers. With
 * none, every row's clause is the same `0% dark` and the column collapses into
 * a size chart — `zmem` printed twelve rows of it, the largest block on a card
 * whose whole finding was that there was nothing to find. Four rows and a fold
 * still say where the weight sits, which is all a size chart can say.
 */
export const QUIET_ROWS = 5;

/**
 * True when the per-row dark clause would say the same thing on every row.
 *
 * Nothing dark anywhere, or everything dark: either way the column is one fact
 * printed N times, which is repetition dressed as information — the same lie a
 * flat trend told when it printed one interval three times. The card's heading
 * states it once instead, and the space goes back to the bars.
 */
function uniformDarkness(reading: RepoReading): boolean {
  return reading.darkBytes === 0 || reading.darkBytes === reading.scoredBytes;
}

export function renderMiniMap(
  reading: RepoReading,
  term: Term,
  maxRows?: number,
): string[] {
  const showDark = !uniformDarkness(reading);
  const rows = maxRows ?? (reading.darkBytes === 0 ? QUIET_ROWS : MAX_ROWS);
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(
      MAX_BAR_WIDTH,
      term.width -
        INDENT.length -
        NAME_WIDTH -
        SHARE_WIDTH -
        2 -
        (showDark ? DARK_CLAUSE_WIDTH : 0),
    ),
  );
  return miniMapRows(reading, rows).map((row) => renderRow(row, term, barWidth, showDark));
}

function renderRow(
  row: MiniMapRow,
  term: Term,
  barWidth: number,
  showDark: boolean,
): string {
  // The fold row names what it stands for. With no dark clause on the line
  // there is nothing after it to say these directories are clean too, and
  // "… 9 more" trailing a column of zeros reads as a truncation hiding
  // something — which is the one thing a fold row must never do.
  const label =
    row.directoryCount === 1
      ? row.name
      : `${term.glyph("ellipsis")} ${row.directoryCount} more` +
        (showDark ? "" : `, none dark`);
  // Every row draws at least one cell. A directory too small to round up to a
  // cell is still a directory, and an empty row would read as "nothing here".
  const cells = Math.max(1, Math.round(row.share * barWidth));
  return (
    INDENT +
    padEnd(truncate(label, NAME_WIDTH, term.glyph("ellipsis")), NAME_WIDTH) +
    " " +
    stackedBar(row, cells, term) +
    " ".repeat(Math.max(0, barWidth - cells)) +
    " " +
    // Last on the row and unpadded: a trailing run of spaces is invisible in a
    // terminal and load-bearing in a golden file.
    padStart(formatBlindShare(row.share * 100), SHARE_WIDTH) +
    (showDark ? ` ${term.glyph("dot")} ${formatBlindShare(row.darkShare * 100)} dark` : "")
  );
}

/**
 * ONE BAR, TWO ENCODINGS THAT CANNOT ERASE EACH OTHER.
 *
 * The bar's LENGTH is the directory's share of the repository; the solid run
 * INSIDE it is the share of that directory which is dark. A stacked bar, which
 * is the one chart form a reader does not have to be taught.
 *
 * It replaced a ramp, and the ramp had a defect that only showed on the happy
 * repository: the whole bar was drawn with ONE glyph chosen from `BLOCK_RAMP`
 * by the row's darkness, so a directory with nothing dark drew as `▁▁▁▁` — a
 * hairline on the baseline. On a repository with nothing dark anywhere, every
 * row of the chart was a row of underscores in one flat colour, and the
 * founder's verdict on it was "I don't understand a single thing from this
 * chart. It is not self-explanatory. Have no colors." He was right: the
 * encoding that was supposed to carry the alarm was erasing the encoding that
 * carried the size.
 *
 * Two rules keep the stack honest at the ends, where rounding would otherwise
 * lie in the direction that flatters:
 *
 *   - a directory with ANY dark bytes draws at least one solid cell, so a
 *     rounding-down cannot report a clean directory;
 *   - a directory that is not WHOLLY dark keeps at least one light cell, so a
 *     rounding-up cannot report a lost one.
 *
 * Both encodings survive `--no-color` and `--ascii`, which the ramp's height
 * did too — the point of keeping a glyph difference rather than moving the
 * darkness into colour alone.
 */
function stackedBar(row: MiniMapRow, cells: number, term: Term): string {
  const dark = darkCells(row.darkShare, cells);
  const solid = term.color(term.glyph("block8").repeat(dark), depthColor(0, term.ground));
  const light = term.color(term.glyph("shade").repeat(cells - dark), depthColor(1, term.ground));
  return solid + light;
}

function darkCells(darkShare: number, cells: number): number {
  if (darkShare <= 0) return 0;
  // A one-cell bar cannot hold a proportion, so the two rules collide and the
  // first one wins: a directory with dark code in it must not draw clean. The
  // exact share is on the row's own clause either way, and the direction this
  // errs in is the one that costs a reader nothing.
  if (darkShare >= 1 || cells === 1) return cells;
  return Math.min(cells - 1, Math.max(1, Math.round(darkShare * cells)));
}
