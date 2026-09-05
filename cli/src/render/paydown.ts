import { formatBlindShare } from "../../../lib/blind-share-format";
import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import type { CheckBound } from "../reading/check";
import { REVIEW_CLEARS_THE_LINE, type PaydownReading } from "../reading/paydown";
import { isDegenerate } from "../reading/scoring";
import type { Term } from "./term";
import { renderBigNumber } from "./bignum";
import {
  RULE_WIDTH,
  debtGloss,
  emptyReason,
  lineGloss,
  offlineCloser,
} from "./card";
import { HOSTED_URL } from "./hosted";
import { reviewedScore } from "../reading/counterfactual";
import { TOP_PATHS } from "./ledger";
import { renderHeader, runnable, scopeNote, sectionHead, type RenderMeta } from "./meta";
import { renderProvenance } from "./provenance";
import { depthColor } from "./ramp";
import {
  INDENT,
  formatBytes,
  isoSeconds,
  padEnd,
  padStart,
  paragraph,
  quoteArg,
  truncatePath,
} from "./text";

/**
 * THE PAYDOWN CARD — what a recorded review would return, one rung at a time.
 *
 * The `read` card answers "how much of this does nobody currently understand",
 * and it closes on one sentence about what a review of its five rows would do.
 * This card is that sentence given a whole screen: the same mechanic, run four
 * times at four depths, with the files it is made of printed underneath it.
 *
 * ── WHAT THE COPY MAY CLAIM ─────────────────────────────────────────────────
 *
 * **The conditional is the only honest tense.** Git records no reviews, so
 * nothing on this card has happened. Every rung is "a recorded, commented
 * review of these files" and every verb is what the scorer WOULD return —
 * because the experiment that checks it is "record those reviews, run it
 * again", and a card written in the indicative would be describing a
 * repository that does not exist yet.
 *
 * **It is never called the cheapest or the shortest path.** The ladder is
 * ordered the way every other surface orders files — application code ahead of
 * scaffolding, bytes descending inside a tier — and a byte-greedy set would
 * reach any given share in fewer files. "Cheapest" would therefore be a
 * superlative refutable from the same clone, which is exactly the failure the
 * hero line's `start here:` exists to avoid one command over.
 *
 * **No effort, no cost, no time.** Not "two hours", not "a quick win", not
 * "easy". Git carries no evidence for any of it. What the card knows is how
 * many files, how many bytes, and what the scorer returns — and that is the
 * whole of what it says.
 *
 * **When a rung moves nothing the card prints, there is no ladder.** Four rows
 * reading the same number are a leverage claim refuting itself in place, so the
 * ladder is suppressed and the fact is stated once. The whole-card version of
 * the claim needs BOTH ends AND the gate line to be still — a card that denied
 * a move two lines above one would refute itself.
 *
 * ── COLOUR IS DEPTH, AND THE TRANSITION IS THE CARD ─────────────────────────
 *
 * The signature is the pair of chips on each rung: the share today, and the
 * share with that many files reviewed, each drawn at its OWN depth through the
 * same `depthColor` the big number and the mini-map use. A column that starts
 * red and walks up the ramp is the argument made without a word — and with
 * `--no-color`, a pipe or `NO_COLOR`, the arrow between two numbers says the
 * same thing in bytes identical to the plain rendering.
 *
 * Every column is measured before it is painted, as in `./below` and
 * `./offboard`: an escape sequence has bytes and no width, so the padding comes
 * off the plain text and the escape goes strictly around what is visible.
 */

/** A path column narrower than this stops naming a file. */
const MIN_PATH_WIDTH = 16;

/** Shares arrive as percents; the depth ramp wants 0–1. */
const WHOLE = 100;

export function renderPaydown(
  paydown: PaydownReading,
  term: Term,
  meta: RenderMeta,
): string[] {
  const reading = paydown.reading;
  const width = term.width - INDENT.length;
  // A pre-existing `--without` baseline is NAMED, the same rule `explain` and
  // `offboard` follow: the queries as typed, every time. A ladder computed on a
  // reading that had already removed somebody is a ladder for a repository the
  // reader has to be told about.
  const baseline = baselineQueries(paydown);
  const lines = renderHeader(term, [
    `git-only reading of ${meta.target} ${term.glyph("dot")} the paydown ladder`,
    ...(baseline.length > 0 ? [`baseline: without ${baseline.join(", ")}`] : []),
    isoSeconds(reading.now),
    `scorer ${meta.scorerVersion}`,
  ]);
  lines.push(...scopeNote(reading, term), ...conditionalNote(term));

  if (isDegenerate(reading)) {
    lines.push("", `${INDENT}nothing to fathom here yet`);
    lines.push(...paragraph(emptyReason(reading, term), width));
    pushSection(lines, renderProvenance(reading, term));
    return lines;
  }

  if (meta.quiet) {
    pushSection(lines, quietHeadline(paydown, term));
    pushSection(lines, renderProvenance(reading, term));
    return lines;
  }

  pushSection(lines, bigNumber(paydown, term));
  pushSection(lines, captions(paydown, term, width));
  // The big number's label is the term itself, and a reader can arrive at this
  // card straight from `--help` without ever having run `read`. The copy rule
  // is per surface, so the definition is printed here rather than assumed from
  // a card they may never have seen.
  //
  // AFTER THE CAPTIONS, NOT BEFORE THEM. Placed directly under the number, the
  // definition separated the number from the sentence that reads it — which is
  // the one pairing the copy rule protects, since a stranger who covers the
  // label must still be able to tell good news from bad. A definition of the
  // LABEL can wait one paragraph; the reading of the NUMBER cannot.
  pushSection(lines, dim(term, debtGloss(term, width)));
  pushSection(lines, scope(paydown, term, width));
  pushSection(lines, ladder(paydown, term, width));
  pushSection(lines, files(paydown, term, width, meta.full));
  pushSection(lines, remainder(paydown, term, width));
  pushSection(lines, gate(paydown, term, width));
  pushSection(lines, renderProvenance(reading, term));
  pushSection(lines, closing(term, width));
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

/** The `--without` queries this reading already carried, exactly as typed. */
function baselineQueries(paydown: PaydownReading): string[] {
  return paydown.reading.withoutMatches.map((match) => match.query);
}

/**
 * Every `fathohm paydown …` this card prints reproduces THIS card.
 *
 * A baseline travels, because a ladder computed with sam removed is a different
 * ladder; the gate flags travel, because without them the same command prints
 * no gate line at all and the card a reader gets back is not the one they were
 * pointed at. The limit is spelled out even when it came from `.fathohm.toml` —
 * a flag beats the file with the same value, so the command is both faithful
 * and self-contained.
 */
function cardFlags(paydown: PaydownReading): string {
  const parts = [baselineFlags(paydown)];
  if (paydown.gate !== null) {
    parts.push(` --max-blind ${paydown.gate.threshold}`);
    if (paydown.gate.bound === "floor") parts.push(" --pessimistic");
  }
  return parts.join("");
}

/**
 * The baseline alone — for the commands that take `--without` and nothing else
 * this card was drawn with. `fathohm explain <path>` on a ladder computed with
 * sam removed would otherwise hand the reader different factors than the row
 * they just read.
 */
function baselineFlags(paydown: PaydownReading): string {
  return baselineQueries(paydown)
    .map((query) => ` --without ${quoteArg(query)}`)
    .join("");
}

/** The same, for the `check` invocation the gate line names. */
function checkFlags(
  paydown: PaydownReading,
  threshold: number,
  bound: CheckBound,
): string {
  return (
    `${baselineFlags(paydown)} --max-blind ${threshold}` +
    (bound === "floor" ? " --pessimistic" : "")
  );
}

/**
 * NOTHING HERE HAS HAPPENED — on the second line, flush with the header.
 *
 * A reader meeting a card of falling percentages has one question before any of
 * them, and it is whether this is a measurement or a proposal. So the answer is
 * above the fold: git holds no review record, and every number below is the
 * scorer run again as if it did.
 */
function conditionalNote(term: Term): string[] {
  return paragraph(
    `git records no reviews ${term.glyph("dash")} every rung below is this reading ` +
      `re-scored as if one existed`,
    term.width,
    "",
    "",
  ).map((line) => term.color(line, "dim"));
}

/**
 * `--quiet`: the ladder on one line, in the form a `$(…)` can capture.
 *
 * The rungs compress to their counts in parentheses, which is the whole ladder
 * in the width of a log line — and, like every other quiet form, it stays ONE
 * line even when it is long, because a wrapped continuation breaks every
 * consumer of it.
 */
function quietHeadline(paydown: PaydownReading, term: Term): string[] {
  const dash = term.glyph("dash");
  const floor = paydown.before.floor;
  const head = `${INDENT}${term.color(formatBlindShare(floor), depthColor(1 - floor / WHOLE, term.ground))} comprehension debt`;

  if (belowCount(paydown) === 0) {
    return [`${head} ${dash} nothing scores below the line`];
  }
  if (paydown.rungs.length === 0) {
    return [`${head} ${dash} no file below the line crosses it on a review alone`];
  }

  const arrow = ` ${term.glyph("arrow")} `;
  const rungs = paydown.rungs.map((rung, index) => {
    const share = term.color(
      formatBlindShare(rung.floor),
      depthColor(1 - rung.floor / WHOLE, term.ground),
    );
    return index === 0
      ? `${share} (${rung.files} review${rung.files === 1 ? "" : "s"})`
      : `${share} (${rung.files})`;
  });
  return [head + arrow + rungs.join(arrow)];
}

/** How many files sit below the line at all — the ladder plus what it cannot lift. */
function belowCount(paydown: PaydownReading): number {
  return paydown.liftable.files + paydown.unliftable.files;
}

/**
 * THE NUMBER: the floor as it stands, before any rung.
 *
 * The same end the reading card leads with, for the same reason — an interval
 * cannot be drawn at this size without choosing which end goes first, and the
 * quoted end must be the one the evidence proves. It carries no condition
 * because it is the one figure on this card that is not conditional: it is the
 * repository today, and everything under it is what would move it.
 */
function bigNumber(paydown: PaydownReading, term: Term): string[] {
  const floor = paydown.before.floor;
  return renderBigNumber(
    formatBlindShare(floor),
    "comprehension debt",
    depthColor(1 - floor / WHOLE, term.ground),
    term,
  );
}

/**
 * THE TWO SENTENCES, and the one this card owes on top of them.
 *
 * A reader arriving from `fathohm read` meets the same two facts in the same
 * words: one card restating the other's headline in a second voice is two
 * products describing one repository.
 *
 * BUT THE INTERVAL AND THE LADDER ARE TWO DIFFERENT QUESTIONS, and on this card
 * they sit four lines apart, so the difference is stated rather than left to be
 * inferred. The CEILING is what a review that ALREADY HAPPENED and left no
 * trace could be worth — which is why it credits only files that went through a
 * pull request, since a file that never did cannot be hiding a PR review. The
 * LADDER is a review that has NOT happened yet, on any file at all. Without
 * that line a card can print "no review record could lift it" above "a review
 * lifts every one of them" and read as though it were refuting itself, which is
 * exactly what the first draft of this card did.
 *
 * The exact-case sentence is scoped for the same reason: "no review record
 * could lift it" is true of the record and false of a review somebody has yet
 * to do, and this is the one card where both readings are live.
 */
function captions(paydown: PaydownReading, term: Term, width: number): string[] {
  const dash = term.glyph("dash");
  const floor = formatBlindShare(paydown.before.floor);
  const ceiling = formatBlindShare(paydown.before.ceiling);
  const exact = paydown.reading.ceilingBlindBytes === paydown.reading.floorBlindBytes;

  return [
    ...paragraph(
      `${floor} of this code scores below the comprehension line on git evidence alone ` +
        `(worst case)`,
      width,
    ),
    ...paragraph(
      exact
        ? `this number is exact: nothing below the line ever went through a pull request, so no ` +
            `review already on the record could have lifted it.`
        : `best case ${ceiling}: the same evidence with full review credit for every file that ` +
            `went through a PR ${dash} git does not record reviews`,
      width,
    ),
    // The other kept piece of jargon, defined on the surface that uses it. Both
    // sentences above turn on the line, and this card is reachable without the
    // reading card — the same per-surface rule the gloss under the number
    // follows.
    ...dim(term, lineGloss(term, width)),
    ...(paydown.rungs.length === 0
      ? []
      : paragraph(
          `the ladder is the other question ${dash} not a review that already happened and ` +
            `went unrecorded, but one that has not happened yet`,
          width,
        )),
  ];
}

/**
 * WHAT THE LADDER IS DRAWN FROM — the count and the weight, before the rungs.
 *
 * The bytes are named against the denominator rather than as a share, because
 * the share of the code below the line IS the big number four lines up: a card
 * that printed its own headline twice under two different labels would be
 * asking the reader to check whether they are the same number.
 *
 * WHEN THE LADDER COVERS EVERYTHING, THE REASON IS ATTACHED. "A review lifts
 * every one of them" invites exactly one question, and the answer is arithmetic
 * rather than good fortune: review credit weighs more than the line, so the
 * record clears it on its own. That clause is `REVIEW_CLEARS_THE_LINE`,
 * computed from the two constants in `lib/demo-data` — move the line above the
 * weight and it stops being printed, because it stops being true.
 */
function scope(paydown: PaydownReading, term: Term, width: number): string[] {
  const dash = term.glyph("dash");
  const below = belowCount(paydown);
  if (below === 0) {
    return paragraph(
      `nothing in this reading scores below the line ${dash} there is nothing to pay down.`,
      width,
    );
  }

  const reading = paydown.reading;
  const weight =
    `${formatBytes(reading.floorBlindBytes)} of the ` +
    `${formatBytes(reading.scoredBytes)} read`;
  const lifts =
    paydown.liftable.files === below
      ? `A recorded, commented review lifts every one of them over it` +
        (REVIEW_CLEARS_THE_LINE ? `: the record weighs more than the line itself.` : `.`)
      : `A recorded, commented review lifts ${paydown.liftable.files} of them over it.`;

  return paragraph(
    `${below} ${below === 1 ? "file sits" : "files sit"} below the line ${dash} ${weight}. ` +
      lifts,
    width,
  );
}

/**
 * THE LADDER — the same computation at four depths.
 *
 * SUPPRESSED WHEN THE PRINTED FLOOR NEVER MOVES. Four rows carrying one number
 * are not a ladder, and on a large repository ten files can be a rounding
 * error. What replaces them is a sentence — and WHICH sentence depends on
 * whether anything else on the card moved, because "moves nothing the card
 * prints" is a claim about the whole card. The ceiling and the gate line are
 * both ends this card prints, so a floor that held still while either of them
 * moved gets the narrower statement and lets the next section print the move.
 */
function ladder(paydown: PaydownReading, term: Term, width: number): string[] {
  const rungs = paydown.rungs;
  if (rungs.length === 0) return [];

  const dash = term.glyph("dash");
  const floorText = formatBlindShare(paydown.before.floor);
  const ceilingText = formatBlindShare(paydown.before.ceiling);
  const floorMoves = rungs.some((rung) => formatBlindShare(rung.floor) !== floorText);
  const ceilingMoves = rungs.some((rung) => formatBlindShare(rung.ceiling) !== ceilingText);
  const gateMoves =
    paydown.gate !== null && !paydown.gate.passesToday && paydown.gate.passesAt !== null;

  if (!floorMoves) {
    const deepest = rungs[rungs.length - 1].files;
    const files = `${deepest} ${deepest === 1 ? "file" : "files"}`;
    return paragraph(
      !ceilingMoves && !gateMoves
        ? `a recorded, commented review of ${files} moves nothing this card prints ${dash} ` +
            `the share holds at both ends.`
        : `a recorded, commented review of ${files} holds the printed worst case exactly ` +
            `where it is.`,
      width,
    );
  }

  return [
    ...sectionHead(
      term,
      "THE LADDER",
      "what a recorded, commented review would return, cumulative",
    ),
    ...rungRows(paydown, term),
  ];
}

/**
 * The rungs: a count, and two chips.
 *
 * The left chip is the same number on every row on purpose — it is the reading
 * they all start from, and a column that repeats it is what makes each row a
 * standalone true sentence in a screenshot of one line.
 */
function rungRows(paydown: PaydownReading, term: Term): string[] {
  const arrow = ` ${term.glyph("arrow")} `;
  const before = formatBlindShare(paydown.before.floor);
  const beforeCode = depthColor(1 - paydown.before.floor / WHOLE, term.ground);
  const afters = paydown.rungs.map((rung) => formatBlindShare(rung.floor));

  const countWidth = Math.max(
    ...paydown.rungs.map((rung) => String(rung.files).length),
  );
  const labels = paydown.rungs.map(
    (rung) => `${padStart(String(rung.files), countWidth)} ${rung.files === 1 ? "file" : "files"}`,
  );
  const labelWidth = Math.max(...labels.map((label) => label.length));
  const shareWidth = Math.max(before.length, ...afters.map((after) => after.length));

  return paydown.rungs.map((rung, index) => {
    const after = afters[index];
    return (
      INDENT +
      padEnd(labels[index], labelWidth) +
      "  " +
      " ".repeat(Math.max(0, shareWidth - before.length)) +
      term.color(before, beforeCode) +
      arrow +
      " ".repeat(Math.max(0, shareWidth - after.length)) +
      term.color(after, depthColor(1 - rung.floor / WHOLE, term.ground))
    );
  });
}

/**
 * THE FILES — the ladder itself, in the order the rungs are built from.
 *
 * `byDisplayOrder`, computed in `../paydown`: application code ahead of
 * scaffolding, tests and styles last, bytes descending inside a tier. That is
 * the ledger's order and the ordinal argument's order, so a reader moving
 * between `read`, `explain` and this card is looking at one ranking of one
 * repository.
 *
 * The cut is stated, never silent — five rows and a line naming exactly the
 * command that prints the rest, carrying every flag this card was drawn with.
 */
function files(
  paydown: PaydownReading,
  term: Term,
  width: number,
  full: boolean,
): string[] {
  if (paydown.ladder.length === 0) return [];

  const shown = full ? paydown.ladder : paydown.ladder.slice(0, TOP_PATHS);
  const flags = cardFlags(paydown);
  const more = `fathohm paydown${flags} --full`;
  const lines = [
    ...sectionHead(term, "THE FILES", "the ladder, in order: application code first"),
    ...fileRows(paydown, shown, term),
    "",
  ];

  const rest = paydown.ladder.length - shown.length;
  if (rest > 0) {
    lines.push(
      ...runnable(term, paragraph(`${rest} more on this ladder: ${more}`, width), more),
    );
  }
  const deeper = `fathohm explain ${shown[0].path}${baselineFlags(paydown)}`;
  lines.push(...runnable(term, paragraph(`factor by factor: ${deeper}`, width), deeper));
  return lines;
}

/**
 * A row: the score today, the score with a review on it, the path, the weight.
 *
 * The right chip is `reviewedScore` — the same function the rungs are computed
 * from — so a reader can see that every file on this ladder does clear the line
 * on its own, which is the property that makes it a ladder rather than a list.
 */
function fileRows(
  paydown: PaydownReading,
  shown: PaydownReading["ladder"],
  term: Term,
): string[] {
  const arrow = ` ${term.glyph("arrow")} `;
  const scoreWidth = BLIND_SPOT_THRESHOLD.toFixed(2).length;
  const sizes = shown.map((file) => formatBytes(file.bytes));
  const sizeWidth = Math.max(...sizes.map((size) => size.length));
  const lead = INDENT.length + scoreWidth * 2 + arrow.length + 2;
  const pathWidth = Math.min(
    Math.max(...shown.map((file) => file.path.length)),
    Math.max(MIN_PATH_WIDTH, term.width - lead - 2 - sizeWidth),
  );

  return shown.map((file, index) => {
    const before = file.floor.toFixed(2);
    const after = reviewedScore(file).toFixed(2);
    return (
      INDENT +
      " ".repeat(Math.max(0, scoreWidth - before.length)) +
      term.color(before, depthColor(file.floor, term.ground)) +
      arrow +
      " ".repeat(Math.max(0, scoreWidth - after.length)) +
      term.color(after, depthColor(reviewedScore(file), term.ground)) +
      "  " +
      padEnd(truncatePath(file.path, pathWidth, term.glyph("ellipsis")), pathWidth) +
      "  " +
      padStart(sizes[index], sizeWidth)
    );
  });
}

/**
 * WHAT A REVIEW CANNOT MOVE — the honest half of a ladder.
 *
 * A command that only showed the files it could move would be lying by
 * omission about the ones it could not, so what is left over is counted,
 * weighed and named. What it is NOT is a task list with an effort attached:
 * the sentence says what the scorer returns with full review credit applied,
 * and then names the only kind of thing left that moves those factors.
 *
 * Empty on every repository this version can read, because review credit
 * outweighs the line — which is said once, up in `scope`, rather than as a
 * second sentence here about the same fact.
 */
function remainder(paydown: PaydownReading, term: Term, width: number): string[] {
  const left = paydown.unliftable;
  if (left.files === 0) return [];

  const dash = term.glyph("dash");
  const one = left.files === 1;
  return paragraph(
    `a review is not enough for ${left.files} ${one ? "file" : "files"} ${dash} ` +
      `${formatBytes(left.bytes)}, ${formatBlindShare(left.share)} of the scored code: ` +
      `with full review credit ${one ? "it scores" : "they score"} below the line anyway, ` +
      `and what moves ${one ? "it" : "them"} is a human hand in the file.`,
    width,
  );
}

/**
 * THE READER'S OWN GATE, and where on this ladder it starts passing.
 *
 * Printed only when something said what the limit is — a flag, or
 * `.fathohm.toml`. fathohm has no default limit and will not invent one to have
 * something to say here.
 *
 * WHICH END IT WAS ANSWERED AT IS NAMED, because `check` gates the CEILING by
 * default and the rungs above print the FLOOR. Without that clause a card can
 * say "the 3-file rung: 48%" and "a limit of 40 passes at 3 files" on the same
 * screen and read as arithmetic that does not add up — when in fact the two
 * sentences are about the two ends of one interval. The command carries
 * `--pessimistic` when the floor is the end being gated, so the line is also
 * the exact invocation that reproduces it.
 *
 * Nothing is claimed about a rung that was not computed: a ladder that stops at
 * ten and has not got there says so, rather than implying it cannot be got to.
 */
function gate(paydown: PaydownReading, term: Term, width: number): string[] {
  const gateState = paydown.gate;
  if (gateState === null) return [];
  const dash = term.glyph("dash");
  const command = `fathohm check${checkFlags(paydown, gateState.threshold, gateState.bound)}`;
  const ends =
    gateState.bound === "floor"
      ? `${dash} the gate and the ladder read the same end, the worst case`
      : `${dash} the gate reads the best case, the ladder the worst`;

  if (gateState.passesToday) {
    return paragraph(`${command} passes on this reading as it stands ${ends}`, width);
  }
  if (gateState.passesAt === null) {
    return paragraph(
      `no rung on this ladder brings ${command} inside its limit ${ends}`,
      width,
    );
  }
  const files = `${gateState.passesAt} ${gateState.passesAt === 1 ? "file" : "files"}`;
  return paragraph(
    `with a recorded, commented review of ${files}: ${command} passes ${ends}`,
    width,
  );
}

/**
 * WHAT THE HOSTED READING ADDS — the version of it this card can defend.
 *
 * Not the reading card's three ticks. The thing the App knows that this ladder
 * structurally cannot is whether any of it HAPPENED: every rung here is
 * conditional because git holds no review record, and the App holds exactly
 * that record. One specific, checkable gap, and the digest is the surface it
 * arrives on.
 */
function closing(term: Term, width: number): string[] {
  const dash = term.glyph("dash");
  return [
    INDENT + term.glyph("rule").repeat(RULE_WIDTH),
    ...paragraph(
      `git does not record PR reviews. The GitHub App reads them ${dash} a review that ` +
        `actually happened moves this number, and the weekly digest carries the move.`,
      width,
    ),
    ...runnable(
      term,
      paragraph(`install the GitHub App ${term.glyph("arrow")} ${HOSTED_URL}`, width),
      HOSTED_URL,
    ),
  ];
}
