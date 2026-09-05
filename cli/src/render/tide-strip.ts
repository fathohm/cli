import type { TidePoint, TideSeries } from "../reading/tide";
import type { Term } from "./term";
import { formatInterval } from "./interval";
import { depthColor } from "./ramp";
import { INDENT, isoDay, padEnd, padStart, paintWords, paragraph } from "./text";
import { sectionHead } from "./meta";

/**
 * TREND — three tenses, as rows.
 *
 * ── WHY THERE IS NO LONGER A SPARKLINE ──────────────────────────────────────
 *
 * The heading used to carry fifteen block cells: twelve months, a rule, today,
 * a rule, the forecast. Four problems, and a cold reader hit all of them at
 * once. It had no axis. The two `│` marks separating history from forecast were
 * never named, so a third of the picture was a prediction drawn like a
 * measurement. Every cell plotted the FLOOR while the rows underneath print the
 * INTERVAL, so on a repository whose floor had fallen the strip read "better"
 * beside a row ending `>99%`, with nothing on screen to reconcile them. And in
 * a scrollback buffer without colour it is a run of blocks.
 *
 * The rows carry every fact the strip carried and label themselves. Fifteen
 * characters were costing the card its credibility, so they are gone.
 *
 * A single number is a photograph, and comprehension debt is not a
 * photograph: it accrues while nothing happens. So the block says where the
 * repository has been, where it is, and — if nobody touches anything — where
 * it will be. That last tense is the one that changes behaviour, and it is the
 * one a reader will most suspect of being a sales projection, so the card says
 * out loud what it is: the same decay arithmetic, evaluated at a later clock.
 * Nothing here models a commit that has not happened.
 *
 * The section is called TREND rather than THE TIDE. The metaphor was ours and
 * the reader's four seconds are theirs: a cold user scanning a card needs a
 * section header that says what the block contains, and every noun this
 * product invents is a noun they have to decode first. The module keeps its
 * name — a file rename is not a copy change — and so does `fathohm fade`,
 * which is a command name and therefore an interface.
 *
 * The two honesty labels are not optional and both survived every rewrite:
 *
 *   - "today's files, re-scored as of each date" — historical points move only
 *     the clock, so the block is a story about comprehension rather than about
 *     repo growth. Rewinding the tree too is `--at`, a different command. It
 *     read "today's tree held constant" until a cold user reported that the line
 *     meant nothing to him: "tree" is git's word for the file list and "held
 *     constant" is the method rather than the fact.
 *   - "with no new commits" — the forecast's entire premise, and it stays
 *     INSIDE the line it qualifies. A premise in a following sentence is a
 *     premise that gets screenshotted off. Not "if nobody touches anything":
 *     "touches" has two readings (edits? opens?), and the model's actual input
 *     is commits.
 *
 * ── WHY THE STOPS ARE ROWS AND NOT AN ARROW CHAIN ───────────────────────────
 *
 * They were one line until 2026-08-14, on the theory that three tenses read as
 * a sequence and a sequence should look like one:
 *
 *     2025-08-14: 100% -> today: <1% -> 2026-11-12: 14% - >99% with no new commits
 *
 * Each stop is an INTERVAL, and an interval already contains a separator.
 * `interval.ts` spaces its en dash precisely so `67%->99%` cannot be misread as
 * an arrow — and then the chain put real arrows between the intervals, so the
 * line carries two separators that mean opposite things (one is "to", one is
 * "then") and look alike. Worse, `formatInterval` collapses a zero-width
 * interval to a single number, so a chain can mix bare values and pairs:
 * above, the first two stops are points and the third is a range, and nothing
 * on the screen says which is which. The founder could not read his own card.
 *
 * Rows fix it by construction. One stop per line, the label on the left and
 * the share in a right-aligned column, so the arrow is never needed and the
 * only dash on the line is the interval's own.
 *
 * THE LABELS ARE RELATIVE, and the dates they replaced are not missed: the
 * header two lines up stamps the instant the reading was taken, so "in 90
 * days" is resolvable and "2026-11-12" was a date the reader had to subtract
 * from to learn anything.
 *
 * A FLAT SERIES COLLAPSES TO ONE SENTENCE. Three identical rows are three
 * copies of one fact laid out to look like a change. When every stop reads the
 * same, the block says so in words.
 *
 * Every stop prints the INTERVAL, both ends. Drawing one end would mean
 * picking which end, and the end picked would become the number people quote.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stop-label column. Wide enough for "12 months ago" and "in 90 days". */
const LABEL_WIDTH = 14;

export function renderTideStrip(tide: TideSeries, term: Term): string[] {
  const width = term.width - INDENT.length;
  const lines: string[] = [
    ...sectionHead(
      term,
      "TREND",
      "today's files, re-scored as of each date",
      ` ${term.glyph("dash")} `,
    ),
  ];

  const stops = stopsOf(tide, term);
  const flat = stops.every((stop) => stop.share === stops[0].share);
  lines.push(...(flat ? unchanged(stops, width, term) : rows(stops, term)));
  lines.push(...shortRecord(tide, width));

  // "cross into debt", not "cross the line" and not "fade". `fathohm fade` is
  // a command name and therefore an interface, so it keeps its own; but the
  // card line has to state the EVENT, and it stated it in a noun the card never
  // defines. "The line" is the 0.30 threshold — a reader meets the phrase here,
  // in the block that has just glossed comprehension debt, and has no way to
  // learn that this file is about to cross INTO that and not into darkness.
  // They are different predicates: this is the next file whose score decays
  // under the threshold, which the dark share does not measure.
  if (tide.nextToFade !== null) {
    lines.push(
      ...paragraph(
        `next file to cross into debt: ${tide.nextToFade.path} (${tide.nextToFade.at})`,
        width,
      ),
    );
  }
  return lines;
}

/** One stop: what to call it, what it read, and whether it is the forecast. */
interface Stop {
  label: string;
  share: string;
  /** The two ends as numbers, so each can be painted by ITS OWN value. */
  ends: { ceiling: number; floor: number };
  /** The forecast stop carries the premise; the other two carry nothing. */
  premise: boolean;
}

/**
 * The three tenses, built as stops rather than as a template so a series with
 * no past and no forecast still renders one true row instead of a sentence
 * with holes.
 *
 * `today` is always present, which is what lets the caller index `stops[0]`
 * without a guard.
 */
function stopsOf(tide: TideSeries, term: Term): Stop[] {
  const stops: Stop[] = [];
  const oldest = tide.past[0];
  if (oldest !== undefined) {
    const months = tide.past.length;
    stops.push({
      label: `${months} ${months === 1 ? "month" : "months"} ago`,
      share: interval(oldest, term),
      ends: endsOf(oldest),
      premise: false,
    });
  }
  stops.push({
    label: "today",
    share: interval(tide.today, term),
    ends: endsOf(tide.today),
    premise: false,
  });

  const horizon = tide.forecast[tide.forecast.length - 1];
  if (horizon !== undefined) {
    stops.push({
      label: `in ${daysBetween(tide.today.at, horizon.at)} days`,
      share: interval(horizon, term),
      ends: endsOf(horizon),
      premise: true,
    });
  }
  return stops;
}

/**
 * The moving case: one row per stop, share in a right-aligned column.
 *
 * Right-aligned because the column is there to be compared down, and `<1%`
 * beside `100%` only reads as smaller when their last characters line up.
 */
function rows(stops: readonly Stop[], term: Term): string[] {
  const column = Math.max(...stops.map((stop) => stop.share.length));
  return stops.map(
    (stop) =>
      `${INDENT}  ${padEnd(stop.label, LABEL_WIDTH)}` +
      paintEnds(padStart(stop.share, column), stop.ends, term) +
      // No separator before the premise. Every punctuation mark available here
      // is already spoken for on this line — the en dash means "to" inside the
      // interval to its left — and a second mark would put the reader back in
      // the arrow chain this layout replaced.
      (stop.premise ? `   with no new commits` : ""),
  );
}

/**
 * The flat case: the number once, and what did not happen to it.
 *
 * The two clauses are built rather than templated, because "unchanged over the
 * 12 months read" is a claim this series can only make when it HAS a past —
 * and a repository younger than the window has none. The premise still travels
 * with the forecast clause it belongs to.
 */
function unchanged(stops: readonly Stop[], width: number, term: Term): string[] {
  const clauses: string[] = [];
  const oldest = stops[0];
  if (oldest.premise === false && oldest.label !== "today") {
    clauses.push(`unchanged over the ${oldest.label.replace(" ago", "")} read`);
  }
  const horizon = stops[stops.length - 1];
  if (horizon.premise) clauses.push(`unchanged ${horizon.label} with no new commits`);

  // One stop and nothing to compare it against — no past in the record, no
  // horizon asked for. "throughout" would be a span word over a single point.
  const sentence =
    clauses.length === 0
      ? `${stops[0].share} today.`
      : `${stops[0].share} throughout, ${clauses.join(", and ")}.`;
  // The flat case restates one reading, so it takes one colour — the floor,
  // the end the evidence proves, exactly as the big number does.
  return paintWords(
    paragraph(sentence, width, `${INDENT}  `, `${INDENT}  `),
    term,
    (index) => (index === 0 ? depthColor(1 - stops[0].ends.floor, term.ground) : null),
  );
}

/**
 * Why the strip is shorter than a year, when it is.
 *
 * Silence here was the defect this whole rewrite came out of: the strip drew a
 * full year on a ten-week-old repository, and the ten cells before its first
 * commit all read 100%. The trim happens in `cli/src/reading/tide.ts`; this is the
 * sentence that stops the shorter strip from looking like a shorter history.
 *
 * It says GIT'S RECORD rather than "this repository was created", because a
 * shallow clone and a `--since` window both land here and neither one knows
 * when the repository was made. The date is the earliest event this reading
 * could see, which is exactly what a reader can check with `git log`.
 */
function shortRecord(tide: TideSeries, width: number): string[] {
  if (tide.recordStartsAt === null) return [];
  if (tide.past.length >= tide.monthsRequested) return [];
  // At the card's own indent, not the stops' — a fourth line in the stop
  // column reads as a fourth stop, and this is a note about the column rather
  // than a row in it.
  return paragraph(
    `git's record here starts ${isoDay(tide.recordStartsAt)}, so there is no full year to draw.`,
    width,
  );
}

/** Whole days between two ISO instants, rounded — the forecast's own label. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** The interval at one point, low end first: the ceiling is the best the
 *  missing review record could be, the floor is what the evidence proves. */
function interval(point: TidePoint, term: Term): string {
  return formatInterval(point.ceilingShare, point.floorShare, term);
}

function endsOf(point: TidePoint): { ceiling: number; floor: number } {
  return { ceiling: point.ceilingShare, floor: point.floorShare };
}

/**
 * BOTH ENDS, EACH IN ITS OWN COLOUR — which is why this section can be painted
 * at all.
 *
 * The argument against colouring a trend row was that one row carries a whole
 * interval, so a single ink would mean picking the end that gets quoted — the
 * same reason this file has no sparkline. Painting each end from its own value
 * does not pick: `34% – 100%` comes out blue-to-red, and the WIDTH of the gap
 * git cannot close becomes the thing the row shows at a glance.
 *
 * Split on the en dash rather than searched for by substring: `1% – 11%` would
 * have the first token match inside the second, and a range whose two halves
 * are the same string (which `formatInterval` collapses to one number anyway)
 * has no second half to find.
 *
 * The text is PADDED before it arrives here — an escape has bytes and no width,
 * so a share coloured before `padStart` measures it moves the column.
 */
function paintEnds(padded: string, ends: Stop["ends"], term: Term): string {
  const sep = ` ${term.glyph("endash")} `;
  const at = padded.indexOf(sep);
  if (at === -1) return term.color(padded, depthColor(1 - ends.floor, term.ground));
  return (
    term.color(padded.slice(0, at), depthColor(1 - ends.ceiling, term.ground)) +
    sep +
    term.color(padded.slice(at + sep.length), depthColor(1 - ends.floor, term.ground))
  );
}
