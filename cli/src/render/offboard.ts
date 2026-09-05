import { formatBlindShare } from "../../../lib/blind-share-format";
import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import { ceilingShare, floorShare, type OffboardReading } from "../reading/offboard";
import { isDegenerate } from "../reading/scoring";
import type { Term } from "./term";
import { bigNumberRows, renderBigNumber } from "./bignum";
import {
  RULE_WIDTH,
  debtGloss,
  emptyReason,
  lineGloss,
  offlineCloser,
} from "./card";
import { HOSTED_URL } from "./hosted";
import { TOP_PATHS } from "./ledger";
import { renderHeader, runnable, scopeNote, sectionHead, type RenderMeta } from "./meta";
import { renderProvenance } from "./provenance";
import { depthColor } from "./ramp";
import {
  INDENT,
  formatBytes,
  isoSeconds,
  padEnd,
  paragraph,
  quoteArg,
  truncatePath,
} from "./text";

/**
 * THE OFFBOARD CARD — the reading the day somebody leaves.
 *
 * The `read` card answers "how much of this does nobody understand". This one
 * answers the question a team actually asks out loud, usually two weeks before
 * it matters: *what happens when Priya goes?* Everything on it is the same
 * scorer run twice, and the card's whole job is to make that visible rather
 * than to be persuasive about it.
 *
 * ── WHAT THE COPY MAY CLAIM ─────────────────────────────────────────────────
 *
 * **The conditional is the honest tense.** "87% would score below the line the
 * day Priya leaves" is checkable: clone the repo, run the scorer without her
 * events, get 87%. "Priya is a critical dependency" is not — there is no
 * experiment that refutes it, and it is a sentence about a person rather than
 * about a repository. Nothing here says "critical", "risk", or "never
 * reviewed", and nothing here claims to know what anybody understands.
 *
 * **Both ends move, and both are recomputed.** The headline is the floor of the
 * AFTER reading, because that is the end the evidence proves; the caption
 * carries the ceiling the same way the reading card does. Neither is
 * interpolated between the two runs — they are the two runs.
 *
 * **The monotonicity line is printed because it is provable.** Removing events
 * can only lower a factor's maximum, so no file's score can rise. That is a
 * theorem about the scorer, `offboard.test.ts` holds it over generated
 * readings, and it is the sentence that stops a reader wondering whether the
 * simulation is doing something clever behind their back.
 *
 * ── COLOUR IS DEPTH, AND THE TRANSITION IS THE CARD ─────────────────────────
 *
 * The signature moment is the pair of chips on each HANDOVER row: the score
 * today, and the score without them, each drawn at its OWN depth through the
 * same `depthColor` the big number and the mini-map use. A row that starts
 * warm and lands red is the whole argument made without a word — and with
 * `--no-color`, a pipe, or `NO_COLOR`, the arrow between two numbers says
 * exactly the same thing in bytes that are identical to the plain rendering.
 *
 * The path stays plain, as everywhere: a filename is data. The clause is dim,
 * because it is evidence for the move rather than a second number.
 */

/** A path column narrower than this stops naming a file. */
const MIN_PATH_WIDTH = 16;

export function renderOffboard(
  off: OffboardReading,
  term: Term,
  meta: RenderMeta,
): string[] {
  const width = term.width - INDENT.length;
  // A pre-existing `--without` baseline is NAMED in the header, the same rule
  // `explain`'s simulated() line follows: the queries as typed, every time. A
  // card reading "85% without priya" over a reading that had already removed
  // sam would otherwise be a claim about a repository that does not exist.
  const baseline = off.before.withoutMatches.map((match) => match.query);
  const lines = renderHeader(term, [
    `git-only reading of ${meta.target} without ${off.name} (simulated)`,
    ...(baseline.length > 0 ? [`baseline: without ${baseline.join(", ")}`] : []),
    isoSeconds(off.before.now),
    `scorer ${meta.scorerVersion}`,
  ]);
  lines.push(...scopeNote(off.before, term), ...simulationNote(term));

  if (isDegenerate(off.before)) {
    lines.push("", `${INDENT}nothing to fathom here yet`);
    lines.push(...paragraph(emptyReason(off.before, term), term.width - INDENT.length));
    // The AFTER reading, so the provenance block can report the one thing this
    // card still owes on an empty repository: that the name matched nobody.
    pushSection(lines, renderProvenance(off.after, term));
    return lines;
  }

  if (meta.quiet) {
    pushSection(lines, quietHeadline(off, term));
    pushSection(lines, renderProvenance(off.after, term));
    return lines;
  }

  pushSection(lines, bigNumber(off, term));
  pushSection(lines, transition(off, term, width));
  // The number this card draws at forty characters wide is a comprehension-debt
  // share, and its label says so — which makes this the first prominent use of
  // the term on a surface a reader can meet without ever running `read`. The
  // copy rule is per surface, so the definition is here rather than borrowed
  // from a card they may not have seen.
  //
  // AFTER THE TRANSITION, NOT BEFORE IT. Placed directly under the number, the
  // definition separated the number from the sentence that reads it — the one
  // pairing the copy rule exists to protect. A definition of the LABEL can wait
  // one paragraph; the reading of the NUMBER cannot.
  pushSection(lines, dim(term, debtGloss(term, width)));
  pushSection(lines, soleKeeper(off, term, width));
  pushSection(lines, handover(off, term, width, meta.full));
  pushSection(lines, renderProvenance(off.after, term));
  pushSection(lines, closing(off, term, width));
  pushSection(lines, offlineCloser(term, width));
  return lines;
}

function pushSection(lines: string[], section: readonly string[]): void {
  if (section.length === 0) return;
  lines.push("", ...section);
}

/**
 * This card's voice for a definition: dim, on its own line, always visible.
 *
 * Wrapped before it is coloured, as everywhere here — a colour run measured in
 * bytes rather than columns wraps in the wrong place.
 */
function dim(term: Term, lines: readonly string[]): string[] {
  return lines.map((line) => term.color(line, "dim"));
}

/**
 * WHAT IS AND IS NOT BEING SIMULATED, on the second line of the card.
 *
 * A reader who sees "without priya" at the top of a tool that reads their git
 * history has one question before any of the numbers, and it is whether
 * something has been done to the repository. So the answer is above the fold,
 * flush with the header rather than indented into the body: their commits stay
 * exactly where they are, and what the second reading drops is the credit the
 * scorer gives them.
 */
function simulationNote(term: Term): string[] {
  return paragraph(
    `their commits stay in git's record ${term.glyph("dash")} the simulation removes ` +
      `their engagement from every factor`,
    term.width,
    "",
    "",
  ).map((line) => term.color(line, "dim"));
}

/**
 * `--quiet`: both ends of the move on one line, and the provenance under it.
 *
 * ONE line even when the query is longer than the terminal — deliberately.
 * Quiet output exists to be captured (`$(fathohm offboard x --quiet)`), a
 * wrapped continuation would break every consumer of it, and the query is one
 * token `wrap` would refuse to split anyway. The same trade `meta.ts` makes
 * for an unbreakable path: a copyable name beats the column.
 */
function quietHeadline(off: OffboardReading, term: Term): string[] {
  const after = floorShare(off.after);
  return [
    `${INDENT}${formatBlindShare(floorShare(off.before))} ${term.glyph("arrow")} ` +
      `${term.color(formatBlindShare(after), depthColor(1 - after / WHOLE, term.ground))} comprehension debt ` +
      `without ${off.name}`,
  ];
}

/** Shares arrive as percents; the depth ramp wants 0–1. */
const WHOLE = 100;

/**
 * THE NUMBER: the floor of the AFTER reading.
 *
 * The same choice the reading card makes, for the same reason — an interval
 * cannot be drawn at this size without picking an end, and the end that gets
 * quoted must be the one the evidence proves rather than the one that flatters.
 * The label names the condition, because a percentage this large with no
 * condition on it is a claim about today.
 */
function bigNumber(off: OffboardReading, term: Term): string[] {
  const after = floorShare(off.after);
  return renderBigNumber(
    formatBlindShare(after),
    label(off, term),
    depthColor(1 - after / WHOLE, term.ground),
    term,
  );
}

/**
 * The label, shortened rather than wrapped: the block is five rows tall and a
 * label that fell onto a sixth would break the face.
 *
 * The face is MEASURED, not estimated — `bigNumberRows` is the same function
 * that draws it, so the fit is exact on the day somebody redraws a digit, and
 * a very long name loses its own spelling rather than the card losing its
 * headline.
 */
function label(off: OffboardReading, term: Term): string {
  const full = `comprehension debt without ${off.name}`;
  const face = bigNumberRows(formatBlindShare(floorShare(off.after)), term)[0].length;
  return INDENT.length + face + 2 + full.length <= term.width
    ? full
    : "comprehension debt without them";
}

/**
 * THE TWO SENTENCES, and the suppression rule that keeps them honest.
 *
 * Each end of the interval carries its own before-and-after, because they can
 * move independently: a person can be the last human on files that were already
 * below the ceiling's line and move the floor a long way without touching it.
 *
 * WHEN NOTHING MOVES, IT SAYS SO — AND ONLY WHEN NOTHING MOVES. "Moves nothing
 * the card prints" is a claim about the whole card, so it requires BOTH ends
 * unchanged: a floor that held still while the ceiling moved gets the plain
 * "the same share" and lets the next sentence print the move. A card that
 * denied a delta two words before showing one would refute itself. The
 * suppression exists for the same reason the reading card's leverage line has
 * one: a delta manufactured out of a rounding boundary is not a finding.
 *
 * "TODAY" IS ONLY TODAY. Under a `--without` baseline the before-reading is
 * not today's repository, so the comparison names the baseline instead
 * ("up from 60% without sam") — the same as-typed rule the header follows.
 */
function transition(off: OffboardReading, term: Term, width: number): string[] {
  const dash = term.glyph("dash");
  const floorBefore = formatBlindShare(floorShare(off.before));
  const floorAfter = formatBlindShare(floorShare(off.after));
  const ceilingBefore = formatBlindShare(ceilingShare(off.before));
  const ceilingAfter = formatBlindShare(ceilingShare(off.after));

  if (!off.matched) {
    return [
      ...paragraph(
        `${floorAfter} of this code sits below the comprehension line on git evidence ` +
          `alone (worst case) ${dash} nobody in this history is named ${off.name}, so ` +
          `nothing was removed`,
        width,
      ),
      ...paragraph(
        `best case ${ceilingAfter}: the same evidence with full review credit for every ` +
          `file that went through a PR ${dash} git does not record reviews`,
        width,
      ),
      ...dim(term, lineGloss(term, width)),
    ];
  }

  const baseline = off.before.withoutMatches.map((match) => match.query);
  const beforeLabel = baseline.length === 0 ? "today" : `without ${baseline.join(", ")}`;
  const floorSame = floorBefore === floorAfter;
  const ceilingSame = ceilingBefore === ceilingAfter;

  return [
    ...paragraph(
      `${floorAfter} of this code would sit below the comprehension line the day ` +
        `${off.name} leaves ${dash} ` +
        (floorSame
          ? ceilingSame
            ? `the same share as ${beforeLabel}: removing them moves nothing the card ` +
              `prints (worst case, git evidence alone)`
            : `the same share as ${beforeLabel} (worst case, git evidence alone)`
          : `up from ${floorBefore} ${beforeLabel} (worst case, git evidence alone)`),
      width,
    ),
    ...paragraph(
      `best case ${ceilingAfter}, ` +
        (ceilingSame ? "unchanged" : `up from ${ceilingBefore}`) +
        `: full review credit for every file that went through a PR ${dash} both ` +
        `recomputed through the same scorer, not estimated`,
      width,
    ),
    ...dim(term, lineGloss(term, width)),
  ];
}

/**
 * THE SOLE-KEEPER SENTENCE — the bytes with one name on them.
 *
 * A count of FILES and a share of the denominator, never a judgement. The
 * degenerate case is stated rather than rendered as a very large percentage: on
 * a repository one person wrote alone, "100% of the scored code has priya as
 * the only human" is arithmetically true and reads as an accusation, when what
 * it actually describes is a solo project.
 */
function soleKeeper(off: OffboardReading, term: Term, width: number): string[] {
  if (!off.matched) return [];
  const dash = term.glyph("dash");

  if (off.onlyHuman) {
    return paragraph(
      `${off.name} is the only human in this history. Without them, no scored file has ` +
        `a human on git's record.`,
      width,
    );
  }

  if (off.soleKeeper.files === 0) {
    // "Every SCORED path": sole-keeping is a claim about code that exists, so
    // a path they touched that was since deleted (or is not code) is outside
    // it — and outside this sentence. "Another human's name" rather than
    // "another name", because two addresses of their own do not count.
    return paragraph(
      `no file in this reading has ${off.name} as the only human in its history ${dash} ` +
        `every scored path they touched carries another human's name.`,
      width,
    );
  }

  const count = off.soleKeeper.files;
  return paragraph(
    `${count} ${count === 1 ? "file" : "files"} ${dash} ${formatBytes(off.soleKeeper.bytes)}, ` +
      `${formatBlindShare(off.soleKeeper.share)} of the scored code ${dash} have ${off.name} ` +
      `as the only human in ${count === 1 ? "its" : "their"} history`,
    width,
  );
}

/**
 * HANDOVER — the files that are above the line today and below it without them.
 *
 * The order is `byDisplayOrder`, computed in `../offboard`: application code
 * ahead of scaffolding, tests and styles last, bytes descending inside a tier.
 * That is the ledger's order and the ordinal argument's order, so a reader
 * moving between `read`, `explain` and this card is always looking at one
 * ranking of one repository.
 *
 * The cut is stated, never silent. Five rows and a line that says how many more
 * there are and exactly which command prints them — a truncation a reader has
 * to guess at is a number they cannot check.
 */
function handover(
  off: OffboardReading,
  term: Term,
  width: number,
  full: boolean,
): string[] {
  const dash = term.glyph("dash");

  if (!off.matched) {
    // "Engagement", not "commit": the header note has just said commits are
    // never removed even on a match, and a causal clause naming a mechanism
    // the card disclaimed two sections up would contradict it.
    return paragraph(
      `the reading is unchanged ${dash} nothing crossed the line, because nobody's ` +
        `engagement was removed.`,
      width,
    );
  }

  if (off.crossings.length === 0) {
    return paragraph(
      `no file crosses the line without ${off.name} ${dash} everything that would lose ` +
        `them was already below it.`,
      width,
    );
  }

  const shown = full ? off.crossings : off.crossings.slice(0, TOP_PATHS);
  // "Application code first", because that is the order the rows are actually
  // in (`byDisplayOrder`: kind tier, then bytes) — a heading that said
  // "largest first" would be refuted two rows down by any schema dump or test
  // file, and the team card's genuinely bytes-sorted table already owns that
  // phrase. One phrase, one ordering.
  const lines = [
    ...sectionHead(
      term,
      "HANDOVER",
      `crosses the line without ${off.name}, application code first`,
    ),
    ...rows(off, shown, term),
    "",
  ];

  // Every printed command reproduces THIS card's reading, so a `--without`
  // baseline travels with it: `fathohm explain <path> --without priya` on a
  // card computed with sam also removed would hand the reader different
  // numbers than the rows they just read.
  const baselineFlags = off.before.withoutMatches
    .map((match) => ` --without ${quoteArg(match.query)}`)
    .join("");

  const deeper =
    `fathohm explain ${shown[0].path}${baselineFlags} --without ${quoteArg(off.name)}`;
  const rest = off.crossings.length - shown.length;
  if (rest > 0) {
    const more = `fathohm offboard ${quoteArg(off.name)}${baselineFlags} --full`;
    lines.push(
      ...runnable(term, paragraph(`${rest} more cross with them gone: ${more}`, width), more),
    );
  }
  lines.push(
    ...paragraph(
      `removing a person never raises a file's score ${dash} everything below the line ` +
        `today stays below`,
      width,
    ),
    "",
    ...runnable(term, paragraph(`factor by factor, after they leave: ${deeper}`, width), deeper),
  );
  return lines;
}

/**
 * The rows: two score chips, a path, a clause.
 *
 * EVERY COLUMN IS MEASURED BEFORE IT IS PAINTED, exactly as in `./below`. An
 * escape sequence has bytes and no width, so a padded coloured cell is a column
 * that moves the moment a terminal supports colour: the padding comes off the
 * plain text and the escape goes strictly around the visible characters.
 */
function rows(
  off: OffboardReading,
  shown: OffboardReading["crossings"],
  term: Term,
): string[] {
  const arrow = ` ${term.glyph("arrow")} `;
  const scoreWidth = BLIND_SPOT_THRESHOLD.toFixed(2).length;
  // No separator glyph in front of the clause, exactly as in `./below`: the
  // gutter does the separating, and the two columns those two characters buy
  // back are the difference between a path that names a file and one that has
  // been cut in the middle.
  const clauses = shown.map((crossing) => crossing.clause);
  const widest = Math.max(...clauses.map((clause) => clause.length));
  const lead = INDENT.length + scoreWidth * 2 + arrow.length + 2;
  const pathWidth = Math.min(
    Math.max(...shown.map((crossing) => crossing.path.length)),
    Math.max(MIN_PATH_WIDTH, term.width - lead - 2 - widest),
  );

  return shown.map((crossing, index) => {
    const before = crossing.before.toFixed(2);
    const after = crossing.after.toFixed(2);
    return (
      INDENT +
      " ".repeat(Math.max(0, scoreWidth - before.length)) +
      term.color(before, depthColor(crossing.before, term.ground)) +
      arrow +
      " ".repeat(Math.max(0, scoreWidth - after.length)) +
      term.color(after, depthColor(crossing.after, term.ground)) +
      "  " +
      padEnd(truncatePath(crossing.path, pathWidth, term.glyph("ellipsis")), pathWidth) +
      "  " +
      term.color(clauses[index], "dim")
    );
  });
}

/**
 * WHAT THE HOSTED READING ADDS — the version of it this card can defend.
 *
 * Not the reading card's three ticks. The thing the App knows that this
 * simulation structurally cannot is WHO REVIEWED THEIR FILES: a departing
 * engineer whose every change was read line by line by two colleagues leaves a
 * very different repository behind than one whose changes nobody opened, and
 * git carries no trace of the difference. That is one specific, checkable gap,
 * which is worth more here than a list of features.
 */
function closing(off: OffboardReading, term: Term, width: number): string[] {
  const dash = term.glyph("dash");
  return [
    INDENT + term.glyph("rule").repeat(RULE_WIDTH),
    ...paragraph(
      `git does not record PR reviews. The GitHub App reads them ${dash} who reviewed ` +
        `${off.name}'s files is evidence this simulation cannot see.`,
      width,
    ),
    ...runnable(
      term,
      paragraph(`install the GitHub App ${term.glyph("arrow")} ${HOSTED_URL}`, width),
      HOSTED_URL,
    ),
  ];
}
