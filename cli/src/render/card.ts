import {
  formatBlindShare,
  exactBlindShare,
} from "../../../lib/blind-share-format";
import { DEBT_GLOSS, LINE_GLOSS } from "../../../lib/reading-explained";
import { DARK_WINDOW_DAYS, darkLedgerLine, isDark } from "../reading/dark";
import { isDegenerate, type RepoReading } from "../reading/scoring";
import type { ColorCode, Ground, Term } from "./term";
import type { TideSeries } from "../reading/tide";
import { rowsOf, whyDark } from "./below";
import { renderBigNumber } from "./bignum";
import { HOSTED_URL } from "./hosted";
import { formatInterval } from "./interval";
import { ledgerOf, type Ledger } from "./ledger";
import { renderHeader, runnable, scopeNote, sectionHead, type RenderMeta } from "./meta";
import { renderMiniMap } from "./minimap";
import { renderProvenance } from "./provenance";
import { depthColor, structureInk } from "./ramp";
import { renderTideStrip } from "./tide-strip";
import {
  INDENT,
  formatBytes,
  isoSeconds,
  padEnd,
  padStart,
  paintWords,
  paragraph,
  prose,
  truncatePath,
  wordCount,
} from "./text";

/**
 * THE READING CARD — the screenshot that is the distribution.
 *
 * Everything above this file computes; this file is the only place the product
 * speaks. Which makes its ordering an argument rather than a layout, and the
 * argument is aimed at a reader who has never heard of comprehension debt and
 * is four seconds from scrolling past:
 *
 *   1. the header, with the clock the reading was taken by;
 *   2. THE NUMBER, at the size of the claim it makes;
 *   3. one plain sentence: what the number means, in words git can back;
 *   4. one file, named, before any of it is abstract again;
 *   5. how much of it rests on one person;
 *   6. WHERE the dark code is;
 *   7. GONE DARK — the ledger: why it went dark, and which files;
 *   8. the provenance — what could not be seen;
 *   9. COMPREHENSION DEBT — the number git cannot measure, its TREND, and who
 *      can measure it;
 *  10. the fact that nothing left the machine.
 *
 * A reader who stops after the digits has the number. A reader who stops after
 * the sentence knows exactly what it counts. A reader who stops after the hero
 * line has a file to open, and one who reaches the ledger knows why it went
 * dark. Nothing below the fold is load-bearing for honesty, which is the test
 * the order was written against.
 *
 * ── WHY THE HEADLINE IS NOT A COMPREHENSION-DEBT SHARE ──────────────────────
 *
 * It was until 1.5.0, and it was the wrong number for this surface. Git records
 * no reviews, `human_review_depth` carries 0.40 of the score, so the reading
 * was an INTERVAL — and the interval was supposed to bracket the hosted number.
 * Measured, it does not: hono squash-merges 99% of its pull requests, which
 * leaves nothing in the commit graph for the ceiling to credit, so the CLI's
 * best case lands BELOW the hosted number rather than above it. Two numbers for
 * one repository, in the same units, with the same word beside them, and no
 * rule a reader could apply to reconcile them.
 *
 * So the card headlines the question git can actually close — see
 * `cli/src/reading/dark.ts` — and the comprehension-debt interval is demoted to the
 * closing block, where it is named as what it is: TWO LABELLED READINGS of the
 * same repository, with nothing in git to say which is right. Never "the truth
 * sits between", which sounds like humility and is a claim about a distribution
 * nobody here has measured.
 *
 * WHY THERE IS NO LONGER A "WHY" SECTION. There used to be two sections about
 * the same files: WHY gave the byte share of each kind of missing engagement,
 * and BELOW THE LINE named five paths. Nothing on the screen said the paths
 * came out of those percentages, and a reader had to join them by hand. So they
 * are one section now — each bucket is a GROUP heading with its own files under
 * it, and the shares add up down the column to the headline. The decomposition
 * did not get smaller; it got attached to the evidence.
 *
 * TWO RULES THE COPY KEEPS, both from a cold-user test.
 *
 * **Never assert a review that git cannot see.** A `.git` directory has no
 * review record in it, so "never reviewed" is a claim about evidence this tool
 * does not have. "no review on git's record" is the same fact attributed to
 * what carries it, and it is the only form allowed here.
 *
 * **Never print an internal.** Weights, engagement units and raw factor values
 * are decomposable and true and belong on `fathohm explain`. The card says what
 * MOVES the number.
 *
 * Every number here comes out of a computed value. There is no literal
 * percentage anywhere in `cli/src/render` — a grep test says so — because a
 * hand-written number on a trust product's headline surface is not a typo
 * risk, it is a category error.
 */

/** The rule above the closing block. Shorter than the card, on purpose. */
export const RULE_WIDTH = 40;

export function renderCard(
  reading: RepoReading,
  tide: TideSeries | null,
  term: Term,
  meta: RenderMeta,
): string[] {
  const width = term.width - INDENT.length;
  const lines = renderHeader(
    term,
    [
      // "code files", not "files": the count is the reading's denominator — the
      // tree after the isCodeFile filter — and a bare "files" invites a reader to
      // compare it against `git ls-files` and conclude the tool lost some.
      `git-only reading of ${subject(reading, meta)} (${reading.files.length} code files)`,
      isoSeconds(reading.now),
      `scorer ${meta.scorerVersion}`,
    ],
    "repository",
    // THE FIRST LINE CARRIES THE ANSWER. `explain`'s header wears its file's
    // score; this wears the whole repository's, which is the same number the
    // big face four lines down is about to draw at five rows tall. A reader who
    // gets no further than line one has still been told which way this went.
    //
    // Degenerate readings are excluded: `scoredBytes === 0` makes the share
    // meaningless, and a colour computed from nothing is a colour that lies
    // about an empty repository.
    isDegenerate(reading) ? undefined : depthColor(1 - darkShareOf(reading), term.ground),
  );
  lines.push(...scopeNote(reading, term));

  if (isDegenerate(reading)) {
    lines.push("", `${INDENT}nothing to fathom here yet`);
    lines.push(...paragraph(emptyReason(reading, term), width));
    pushSection(lines, renderProvenance(reading, term));
    return lines;
  }

  // `--quiet` is a machine's view, or a second run in a terminal that already
  // saw the first: one line with both ends of the interval on it, and the
  // provenance that keeps it a bound. Five rows of block cells in a CI log is
  // the opposite of quiet.
  if (meta.quiet) {
    pushSection(lines, quietHeadline(reading, term));
    pushSection(lines, renderProvenance(reading, term));
    return lines;
  }

  // One ledger, computed once and handed to both the hero line and the section:
  // the file named at the top of the card must be the file at the top of the
  // section, and two derivations of "row one" is exactly how that stops being
  // true.
  const ledger = ledgerOf(reading);

  pushSection(lines, bigNumber(reading, term));
  pushSection(lines, caption(reading, term, width));
  pushSection(lines, hero(ledger, reading, term, width));
  pushSection(lines, soleKeeperLine(reading, term, width));
  pushSection(lines, where(reading, term));
  pushSection(lines, goneDark(ledger, reading, term, width));
  if (meta.full) pushSection(lines, darkPaths(reading, term));
  pushSection(lines, renderProvenance(reading, term));
  pushSection(lines, closing(reading, tide, term, width));
  pushSection(lines, offlineCloser(term, width));
  return lines;
}

function pushSection(lines: string[], section: readonly string[]): void {
  if (section.length === 0) return;
  lines.push("", ...section);
}

/**
 * WHAT THE CARD IS A READING OF — and it is not always this repository.
 *
 * `fathohm read --without ada` scores the history with one person's engagement
 * removed. The number that comes out is a SIMULATION, and until 2026-08-11
 * nothing on the card said so: the header named the directory, the headline
 * said "93% of this code has gone dark: no human has written or prompted any of
 * it in the last 180 days", and a reader could run `git log` and watch it
 * contradict the tool. The provenance block only spoke up when a `--without`
 * matched NOBODY — the failure case — and stayed silent on the one that
 * actually changed the answer.
 *
 * 1.5.0 makes the silence worse rather than better, which is why it is fixed
 * here. The old headline was hedged as an interval; the new one closes with
 * "git records every commit's author and date", which is an explicit invitation
 * to check. An invitation to check a sentence that is false about the checked
 * thing is the worst copy this product could ship.
 *
 * So the subject carries the condition, in the same form `offboard`'s card has
 * always used — its header reads `…of acme-api without priya (simulated)` —
 * because two commands that simulate the same removal must not describe it two
 * ways.
 *
 * ONLY MATCHED REMOVALS. A `--without` that named nobody removed nothing, so
 * the reading is not a simulation and the header must not say it is; that case
 * already has its own provenance warning, which is where it belongs.
 */
function subject(reading: RepoReading, meta: RenderMeta): string {
  const removed = reading.withoutMatches.filter((match) => match.matched);
  if (removed.length === 0) return meta.target;
  return `${meta.target} without ${removed.map((match) => match.query).join(", ")} (simulated)`;
}

/**
 * Why there is nothing to read. Exported because the HTML map has the same
 * three states and must say the same three things about them — a written file
 * that invented its own explanation would be a second product's voice on the
 * one surface people keep.
 *
 * IT NO LONGER NAMES THE CATEGORY. The middle branch used to read "comprehension
 * debt is a property of code", and on a card with nothing else on it that was
 * the term's FIRST and ONLY appearance — introduced to a reader who had run one
 * command, and then never defined, because a degenerate card prints no ledger
 * and no closing block to define it in. The copy rule wants the gloss at the
 * first prominent use per surface; the honest reading of a surface that cannot
 * afford the gloss is that it should not spend the term. The claim survives in
 * plain English, which is what the rule asks for first anyway.
 */
export function emptyReason(reading: RepoReading, term: Term): string {
  if (reading.provenance.emptyRepo) {
    return "This repository has no commits, so there is no history to read.";
  }
  if (reading.files.length === 0) {
    return (
      `Nothing in this tree is code ${term.glyph("dash")} this reading only measures code, ` +
      "and the files here are assets, lockfiles or media. Commit something to read."
    );
  }
  return "Every code file in this tree is empty, so there are no bytes to weigh.";
}

/**
 * THE CANONICAL GLOSS, wrapped for a terminal — one renderer, every card.
 *
 * CLAUDE.md's copy rule is per SURFACE, and a surface is a thing somebody can
 * see on its own: `fathohm offboard`, `fathohm paydown` and the note `fathohm
 * map` prints are each met by readers who never ran `read`, so each owes the
 * definition at its own first prominent use of the term. That is four places,
 * and four hand-written copies of one sentence would eventually be four
 * definitions of the category this product is trying to be the instrument for.
 * So the sentence is `DEBT_GLOSS`, imported, and this is the only place it is
 * laid out for a terminal.
 *
 * Undimmed, because on this card it follows a section heading rather than a
 * number. The cards that print it directly under a number they have just drawn
 * dim it themselves, the way they dim their other definitional asides.
 */
export function debtGloss(term: Term, width: number): string[] {
  return paragraph(prose(term, DEBT_GLOSS), width);
}

/**
 * WHAT THE LINE MEANS, on its own line — the same rule, for the other kept
 * piece of jargon.
 *
 * A card's opening sentence is already carrying a conditional (whose share,
 * against which baseline, moved or unmoved), and threading the definition
 * through it produced a sentence that had to be read twice. So the definition
 * gets its own line, directly under the number it defines — always visible,
 * never a tooltip. Shared for the same reason the gloss above is: `offboard`
 * and `paydown` both speak in lines, and two wordings of one definition is two
 * lines as far as a reader is concerned.
 *
 * Folded like the gloss above even though `LINE_GLOSS` is ascii today: it is
 * shared copy written for a browser, and `--ascii` is a promise about the byte
 * set rather than about the characters that happen to be in it this week.
 */
export function lineGloss(term: Term, width: number): string[] {
  return paragraph(
    prose(term, `the comprehension line: below it, ${LINE_GLOSS}`),
    width,
  );
}

/** The dark share, 0..1 — the headline's own quantity. */
function darkShareOf(reading: RepoReading): number {
  return reading.darkBytes / reading.scoredBytes;
}

/** The floor share, 0..1 — the end of the debt interval the evidence proves. */
function floorShareOf(reading: RepoReading): number {
  return reading.floorBlindBytes / reading.scoredBytes;
}

/** The ceiling share, 0..1 — the other end, if every PR review were credited. */
function ceilingShareOf(reading: RepoReading): number {
  return reading.ceilingBlindBytes / reading.scoredBytes;
}

/** True when no file below the line was ever PR-mediated: the debt is exact. */
function isExact(reading: RepoReading): boolean {
  return reading.ceilingBlindBytes === reading.floorBlindBytes;
}

/**
 * THE NUMBER.
 *
 * One number, and no end of an interval to choose between. That is the whole
 * reason it is this number: the comprehension-debt reading has two ends because
 * git cannot see reviews, and whichever end were drawn at this size would be
 * the one people quote — against a hosted number that neither end reliably
 * brackets. The dark share has no missing factor in it, so there is nothing to
 * pick and nothing to defend.
 */
function bigNumber(reading: RepoReading, term: Term): string[] {
  // ── WHY A ZERO DOES NOT GET THE BIG FACE ──────────────────────────────────
  //
  // Five rows of block cells are the loudest thing this product prints, and
  // they are spent on the claim the card is making. At zero there is no claim:
  // the face draws a giant `0%` next to the words GONE DARK, and a reader has
  // to know that dark is bad AND that zero of it is good before the biggest
  // object on the screen means anything at all. Cover the label — the test
  // CLAUDE.md sets — and `0%` could be either direction.
  //
  // It is worse than merely uninformative on the repository this branch exists
  // for. PROMPTED_ONLY is 0% dark and 100% comprehension debt: every file
  // agent-written this month, nothing ever reviewed. The old card met that
  // repository with a five-row zero and put the hundred twenty lines down,
  // which is this product's headline flattering the exact codebase it exists
  // to warn about.
  //
  // ── AND WHY IT DOES NOT GET A BANNER EITHER ───────────────────────────────
  //
  // The first fix here replaced the face with `NOTHING HAS GONE DARK` in caps,
  // and the founder's verdict was that it did not make sense. He was right,
  // and CLAUDE.md's copy rule says why: "gone dark" is this product's own
  // metaphor, and a metaphor word may appear only NEXT TO an always-visible
  // plain-English sentence, plain sentence first. A caps banner is the
  // metaphor standing alone at the top of the card with its gloss on the next
  // line down, which is the arrangement the rule forbids.
  //
  // So the zero card opens on the caption, whose own first clause carries the
  // plain sentence and the term together in that order. Nothing is drawn at
  // headline size, because at zero there is nothing to say at headline size.
  if (reading.darkBytes === 0) return [];
  const dark = darkShareOf(reading);
  return renderBigNumber(
    formatBlindShare(exactBlindShare(reading.darkBytes, reading.scoredBytes)),
    "GONE DARK",
    depthColor(1 - dark, term.ground),
    term,
  );
}

/**
 * THE SENTENCE.
 *
 * One, where there used to be two, because there is one number now.
 *
 * WHAT IT MAY CLAIM. Not "no human understands 41% of this code". That is a
 * claim about the contents of people's heads and no experiment could falsify
 * it, which makes it the one kind of sentence a tool whose only asset is
 * checkability cannot afford however well it reads. What the reading actually
 * establishes is that on 41% of the scored bytes, no commit authored or
 * prompted by a human lands inside the window. That is reproducible from the
 * same clone and the same clock with `git log`, so that is what it says.
 *
 * "WROTE OR PROMPTED", and both words are load-bearing. A mixed commit — a
 * human formed the intent, an agent produced the diff — counts, at the scorer's
 * own quarter weight, which is enough to keep a file lit. So "no human has
 * written any of it" would be false about a file somebody prompted last week,
 * and the sentence would be wrong in exactly the direction that flatters the
 * headline. Naming both is what makes the claim survive a reader who checks.
 *
 * THE SECOND CLAUSE IS THE POSITIONING, in five words. The card's closing block
 * carries a range; this one does not, and saying so here is what stops a reader
 * from reading the two as competing estimates of one quantity.
 *
 * ── THE ZERO CASE IS ITS OWN SENTENCE, AND IT HAS TO BE ─────────────────────
 *
 * "0% of this code has gone dark: no human has written or prompted any of it in
 * the last 180 days" is what the general form renders at zero, and it is a
 * self-contradiction — the clause after the colon defines the empty set and
 * reads as a claim about the whole repository. It shipped exactly once, into a
 * golden file, before anybody read it out loud.
 *
 * Worse than the grammar is what a zero MEANS here. `PROMPTED_ONLY` is the
 * case: every file agent-written this month, nothing hand-authored ever. It is
 * 0% dark and 100% comprehension debt, and both numbers are correct. A card
 * that led such a repository with a reassuring zero and left the reader to
 * find the hundred twenty lines down would be this product's own headline
 * flattering the exact codebase it exists to warn about. So the zero form says
 * the good news, names its scope, and hands the reader to the block that
 * carries the other question. It is the same duty `isDegenerate` discharges for
 * an empty repository, at a different kind of zero.
 *
 * A DISPLAY FLOOR CANNOT REACH THIS BRANCH: `formatBlindShare` renders any
 * nonzero share under one percent as `<1%`, so a printed `0%` means literally
 * no dark bytes — which is why the test is on the bytes and not on the string.
 */
function caption(reading: RepoReading, term: Term, width: number): string[] {
  const dash = term.glyph("dash");
  // A `--without` reading is a SIMULATION, and this sentence is the one that
  // promises checkability out loud ("git records every commit's author and
  // date"). Left unconditional it invites a reader to run `git log` against a
  // claim the simulation has already made false. The header carries the
  // condition too; this carries it because a screenshot of the number and its
  // sentence is the unit people actually share.
  const removed = reading.withoutMatches.filter((match) => match.matched);
  const without =
    removed.length === 0
      ? null
      : removed.map((match) => match.query).join(", ");

  // ZERO BYTES IS NOT THE SAME FACT AS ZERO FILES, and conflating them put a
  // flat lie on a card. The headline is byte-weighted; the dark SET is a
  // predicate on the factor. An empty code file — `__init__.py`, `py.typed`, a
  // placeholder `index.ts` — is in the tree, is typically years old, and is
  // therefore dark while weighing nothing. Branching the sentence on
  // `darkBytes === 0` made the card say "Nothing here has gone dark" while
  // `--full` listed the file, `explain 1` resolved it and `--json` carried it.
  const darkCount = reading.files.filter(isDark).length;
  if (darkCount === 0) {
    // The good news mirrors the general form above it — metaphor, colon, plain
    // gloss — so the two ledes are one sentence shape at two values, and the
    // file count gives a card that opens on an absence something to check.
    const good =
      without === null
        ? `None of this code has gone dark: a human wrote or prompted every one of these ` +
          `${reading.files.length} files within the last ${DARK_WINDOW_DAYS} days.`
        : `None of this code would have gone dark without ${without}: somebody else wrote or ` +
          `prompted every one of these ${reading.files.length} files within the last ` +
          `${DARK_WINDOW_DAYS} days.`;
    return [
      ...paragraph(good, width),
      "",
      ...widerReading(reading, term, width),
    ];
  }

  if (reading.darkBytes === 0) {
    const files = `${darkCount} ${darkCount === 1 ? "file" : "files"}`;
    const good =
      `The ${files} that ${darkCount === 1 ? "has" : "have"} gone dark here ` +
      `${darkCount === 1 ? "is" : "are"} empty, so ${darkCount === 1 ? "it weighs" : "they weigh"} ` +
      `nothing: every file with code in it was written or prompted in the last ` +
      // The ledger pointer stays. These files ARE named below, and dropping it
      // would leave `--full`, `explain 1` and `--json` all carrying a file the
      // lede implied away.
      `${DARK_WINDOW_DAYS} days. The ledger below names ${darkCount === 1 ? "it" : "them"}.`;
    return [
      ...paragraph(good, width),
      "",
      ...widerReading(reading, term, width),
    ];
  }

  const dark = formatBlindShare(
    exactBlindShare(reading.darkBytes, reading.scoredBytes),
  );
  // THE HEADLINE, SAID TWICE, PAINTED ONCE — until now. The big face draws this
  // exact share from the ramp four lines up, and then the sentence that
  // explains it restated the same number in plain white. Two renderings of one
  // fact, and the one a reader's eye lands on second was the one carrying no
  // signal. It is the first number on the card that means anything; it gets the
  // colour the number above it already has.
  return paintWords(
    paragraph(
      // The sentence carries no full stop of its own: `basis` owns the
      // punctuation, because the bracketed form has to close INSIDE the sentence
      // it qualifies and the bounded form is a sentence after it.
      (without === null
        ? `${dark} of this code has gone dark: no human has written or prompted any of it in ` +
          `the last ${DARK_WINDOW_DAYS} days`
        : `${dark} of this code would have gone dark without ${without}: nobody else has ` +
          `written or prompted any of it in the last ${DARK_WINDOW_DAYS} days`) +
        basis(reading, term),
      width,
    ),
    term,
    (index) => (index === 0 ? depthColor(1 - darkShareOf(reading), term.ground) : null),
  );
}

/**
 * THE SECOND SENTENCE OF A ZERO CARD — and the reason a zero card needs one.
 *
 * Nothing dark is good news about ONE question, and on its own it is the most
 * misleading true sentence this product can print. `PROMPTED_ONLY` is the
 * proof: 0% gone dark, 100% comprehension debt, every file agent-written this
 * month and none of it ever reviewed. A card that said "nothing has gone dark"
 * and left the hundred a screen further down was reassuring exactly the
 * codebase it exists to warn about, and the old closing clause — "comprehension
 * debt is below, and it is a different one" — pointed at the block without
 * printing its number, which is the half of the job that does not survive a
 * reader who stops after two sentences.
 *
 * So the number travels with the pointer. On `zmem` this sentence ends "<1%"
 * and the reader is done; on `PROMPTED_ONLY` it ends "100%" and the reader has
 * met the bad news inside the first four lines.
 *
 * IT SPENDS THE PLAIN DESCRIPTION, NOT THE TERM. Naming "comprehension debt"
 * here would make this the first prominent use on the surface, and CLAUDE.md's
 * copy rule would then owe the canonical gloss in the lede — a second copy of
 * a sentence the closing block already carries, twelve lines apart. The plain
 * description IS the gloss's substance, so the lede says it in full and the
 * block below keeps the term and the definition together where they belong.
 *
 * The interval is rendered rather than either end: this is the quantity git
 * cannot close, and a single number here would be the 1.5.0 confusion coming
 * back through the door the fix was meant to shut.
 */
function widerReading(
  reading: RepoReading,
  term: Term,
  width: number,
): string[] {
  const dash = term.glyph("dash");
  const debt = formatInterval(
    reading.ceilingBlindBytes / reading.scoredBytes,
    floorShareOf(reading),
    term,
  );
  return paragraph(
    `${debt} of it is code no human has recently written, reviewed, or explained ${dash} the ` +
      `question git cannot close alone. The block below decomposes it.`,
    width,
  );
}

/**
 * WHY THE NUMBER IS EXACT — and the one case where the reason is smaller than
 * it sounds.
 *
 * "git records every commit's author and date" is the sentence that makes the
 * headline checkable, and it is an explicit invitation to go and check. On a
 * BOUNDED reading it is an invitation to check a claim this reading was never
 * in a position to make: a `--since` window, a shallow clone or a grafted
 * history means the commits that would have kept a file lit may simply not be
 * here. The dark share is still exact over what was read — that part does not
 * weaken — but the reason it is exact is a smaller reason, so the card says the
 * smaller one and points at the note that quantifies it.
 *
 * `--at <ref>` is deliberately NOT a bound. It moves the tree and the clock
 * together, so it is a complete reading of the repository as it stood, not a
 * partial reading of the repository as it stands.
 */
function basis(reading: RepoReading, term: Term): string {
  const bounded =
    reading.provenance.shallow ||
    reading.provenance.grafted ||
    reading.provenance.sinceBound !== null;
  // A PARENTHETICAL, NOT A SECOND SENTENCE. This clause led as "One number, not
  // a range — …", and a cold reader met the denial before any range existed on
  // the card: a refusal of something they had not been offered, in the one
  // sentence that has to land. Bracketed, it is what it always was — a note
  // saying the number is checkable, read by whoever wants it and stepped over
  // by whoever does not.
  //
  // The BOUNDED form stays a sentence. It already ends in a parenthetical of
  // its own ("see the note below"), and nesting brackets is how a caveat stops
  // being read at all.
  return bounded
    ? `. Exact over the commits this reading saw, which are not all of them ` +
        `${term.glyph("dash")} see the note below.`
    : ` (exact ${term.glyph("dash")} git records every commit's author and date).`;
}

/**
 * HOW MUCH OF IT RESTS ON ONE PERSON — the line that routes to `offboard`.
 *
 * The headline answers "who has left the building?" in the past tense. This is
 * the same question asked forward: code with exactly one human anywhere in its
 * history goes dark the day that person stops opening it, and unlike the review
 * record this is something git knows completely.
 *
 * A SECOND DENOMINATOR, DECLARED. The share is of the whole repository, not of
 * the dark bytes, because the risk is not confined to what is already dark —
 * that is the point of printing it. It is stated as "of all the code" for
 * exactly that reason: the mini-map's row clause is the only other second
 * denominator on this card and it is labelled too.
 *
 * IT ROUTES TO `team`, NOT `offboard`, and that is a deliberate departure from
 * the design note. `offboard` requires a name; a command a reader has to repair
 * before it runs is worse than no command, which is the same rule that keeps
 * the `explain` nudge's path untruncated. `team` is what turns this percentage
 * into people, and its own card ends by pointing at `offboard`.
 *
 * Suppressed at zero. "0% of this code has one human in its history" is a true
 * sentence about a repository where the line has nothing to say.
 */
function soleKeeperLine(
  reading: RepoReading,
  term: Term,
  width: number,
): string[] {
  let bytes = 0;
  let files = 0;
  for (const file of reading.files) {
    const { full, prompted } = file.factors.engagement.contributors;
    if (full + prompted === 1) {
      bytes += file.bytes;
      files += 1;
    }
  }
  if (files === 0) return [];

  const share = formatBlindShare(exactBlindShare(bytes, reading.scoredBytes));
  const dash = term.glyph("dash");
  // THE ROUTE CARRIES THE SIMULATION. Under `--without` these counts are
  // post-removal, and a bare `fathohm team` would send the reader to a card
  // printing the UNSIMULATED share of the same repository — two numbers, one
  // sentence pointing at the other, and no rule to reconcile them. The header
  // and the caption were conditioned on the simulation and this line was not.
  const removed = reading.withoutMatches.filter((match) => match.matched);
  const without =
    removed.length === 0
      ? null
      : removed.map((match) => match.query).join(" --without ");
  // THE COUNT LEADS, and that is what declares the second denominator. Written
  // share-first it read `70% of the code …` — the same six words the ledger's
  // group headings use, from a different cut of the same repository, on a card
  // where 45% and 55% just added to 100. A reader has every reason to try to
  // add the third number in, and nothing on screen said not to. "9 of 12 files"
  // cannot be added to a byte share, which is the point.
  //
  // THE VERB IS CONDITIONAL, not future. "it goes dark 180 days after they
  // stop" is a deadline, and for the single-keeper files that are ALREADY dark
  // the deadline has passed — the sentence promised a future that is somebody's
  // past. The conditional is true on both sides of that line.
  const route =
    without === null ? "fathohm team" : `fathohm team --without ${without}`;
  // THE VERB IS LOAD-BEARING. This card's pointers all share one shape —
  // "factor by factor: fathohm explain <path>", "the ladder back under this
  // limit: fathohm paydown --max-blind 40" — where the left side is a noun
  // phrase naming what you GET and the right side is the command. That shape
  // holds because every other right side carries a path or a flag, so it reads
  // as a command on sight.
  //
  // `fathohm team` is two bare words, and this left side is the only one that
  // is a QUESTION ABOUT PEOPLE. "Who they are: fathohm team" therefore parses
  // as its own answer — as though we had labelled a stranger's contributors
  // "fathohm team". Run on somebody else's repository it reads as absurd, and
  // it is the card `npx fathohm` prints, which is the artifact that travels.
  //
  // "run" cannot be part of a team's name, so it types the rest of the line as
  // a command with one word and no styling — which matters because this line
  // has no colour in any terminal, verified against the colour golden.
  // THE COMMAND GETS ITS OWN LINE, AND THE CARD'S OWN SHAPE.
  //
  // Every other pointer here reads `<what you get>: <command>` — "66 more gone
  // dark: fathohm read --full", "factor by factor: fathohm explain <path>".
  // This one was the exception and got reworded twice for it. "Who they are:
  // fathohm team" parsed as its own ANSWER, as though a stranger's
  // contributors had been labelled "fathohm team", so #121 added an imperative:
  // "Who they are: run fathohm team". Moving the colon after "run" fixed how
  // the command scanned and left the left side a bare noun clause spliced to an
  // imperative.
  //
  // A PURPOSE PHRASE closes both holes at once. "to see who they are" cannot be
  // read as an answer — what follows a purpose is the means of achieving it —
  // so the imperative is no longer load-bearing and the line is the same
  // grammar as its two neighbours. Three pointers, one shape, nothing to parse
  // twice.
  // EVERY FILE IS NOT A RATIO. On a solo repository the general form renders
  // "850 of 850 files — 100% of the code — have exactly one human in their
  // history", which is arithmetic restating its own denominator twice and reads
  // as manufactured alarm. The fact is the same and worth saying; the two
  // numbers are not. (It does not claim ONE human for the repository — each
  // file has one, and git's record here cannot say they are the same person.)
  const everyFile = files === reading.files.length;
  const finding = everyFile
    ? `Every one of these ${reading.files.length} files has exactly one human in its history: ` +
      `when that person stops committing, nothing keeps the file lit.`
    : `${files} of ${reading.files.length} files ${dash} ${share} of the code ${dash} have ` +
      `exactly one human in their history: when that person stops committing, nothing keeps ` +
      `the file lit.`;
  return [
    // THE NUMBERS TAKE WEIGHT, NOT THE SCALE. A single-keeper share is not a
    // comprehension value — `bus_factor` is one factor at weight 0.25 — so
    // painting it from the ramp would claim "94% with one human" is as bad as
    // "94% gone dark", which the scorer does not say. Bold makes it findable
    // without borrowing a meaning it has not earned.
    ...paintWords(paragraph(finding, width), term, (_index, word) =>
      DIGIT.test(word) ? "bold" : null,
    ),
    "",
    ...runnable(term, paragraph(`to see who they are: ${route}`, width), route),
  ];
}

/** `--quiet`: the headline and the debt interval, on one line. */
function quietHeadline(reading: RepoReading, term: Term): string[] {
  const dark = darkShareOf(reading);
  const share = formatBlindShare(
    exactBlindShare(reading.darkBytes, reading.scoredBytes),
  );
  const debt = formatInterval(
    reading.ceilingBlindBytes / reading.scoredBytes,
    floorShareOf(reading),
    term,
  );
  return [
    `${INDENT}${term.color(share, depthColor(1 - dark, term.ground))} gone dark ` +
      `${term.glyph("dot")} comprehension debt ${debt}`,
  ];
}

/**
 * WHERE — the mini-map, with the one line that says what its two encodings are.
 *
 * The rows themselves are unchanged and deliberately so: a bar whose LENGTH is
 * the byte share and whose BLOCK is the depth is the treemap's own argument at
 * terminal resolution. What was missing was that nobody told the reader. Two
 * orthogonal encodings sharing one run of cells is legible the instant it is
 * named and a puzzle until it is.
 *
 * The legend states the DIRECTION of the second encoding, because a block ramp
 * has no inherent one. "how deep" required the reader to already know that deep
 * meant bad and that a fuller block meant deeper — two decodes, neither of them
 * on the screen. "fuller block = more of it dark" is one decode and it is
 * checkable against the clause at the end of each row.
 */
/**
 * WHAT THE BARS ARE A SHARE OF — and under `--scope` it is not the repository.
 *
 * The mini-map's heading is the one line on this card that names the
 * denominator out loud, which makes it the one line that would be false on a
 * subtree reading: `lib/ ████ 100%` under "share of this repository" is a
 * sentence about a codebase nobody measured. The rows are correct either way;
 * the label is what has to move.
 *
 * Two spellings because the heading has two widths — the all-dark variant
 * carries a second clause on the same line — and neither of them is allowed to
 * be the wrong noun.
 */
function wholeOf(reading: RepoReading): string {
  return reading.scope === null ? "this repository" : "this reading";
}

function shortWholeOf(reading: RepoReading): string {
  return reading.scope === null ? "the repo" : "the reading";
}

function where(reading: RepoReading, term: Term): string[] {
  const dot = term.glyph("dot");
  // A legend must describe the drawing in front of it. With nothing dark the
  // rows carry one encoding, not two — no dark clause, no ramp to read — and
  // "fuller block = more of it dark" would be a decoding key for a second
  // encoding the reader cannot find on any row.
  //
  // The heading names the block instead of gesturing at it. "WHERE" is a
  // question word with no object — where WHAT — and on a repository with
  // nothing dark the honest answer is that this is a size chart, so it says
  // so rather than promising a map of something that is not there.
  if (reading.darkBytes === 0) {
    return [
      ...sectionHead(
        term,
        "WHERE THE CODE IS",
        `bar length = share of ${wholeOf(reading)}`,
      ),
      ...renderMiniMap(reading, term),
    ];
  }
  // A KEY MAY ONLY NAME CELLS THAT ARE ON THE SCREEN. On a wholly dark
  // repository no light cell is drawn anywhere, so a key explaining one sent
  // the reader hunting for a glyph that does not exist — the same defect the
  // zero branch above fixes in the other direction. Both uniform cases put the
  // one fact in the heading and let the rows carry share alone.
  if (reading.darkBytes === reading.scoredBytes) {
    return [
      ...sectionHead(
        term,
        "WHERE THE DARK CODE IS",
        `all of it dark  ${dot}  bar = share of ${shortWholeOf(reading)}`,
      ),
      ...renderMiniMap(reading, term),
    ];
  }
  return [
    ...sectionHead(
      term,
      "WHERE THE DARK CODE IS",
      `bar length = share of ${wholeOf(reading)}`,
    ),
    // No dot separator between the two keys. Under `--ascii` the shade folds
    // to `.` and so does the dot glyph, so `# = gone dark . . = …` puts the
    // separator and one of the things it separates in the same character.
    // A KEY'S SWATCH IS THE THING IT LABELS. These two glyphs are the exact
    // cells the chart below draws, and they were printed in plain white while
    // their counterparts three lines down were painted — so the legend for a
    // coloured chart was itself uncoloured, which is the one thing a legend
    // cannot be. Same call as the bars: `depthColor(0, term.ground)` and `depthColor(1, term.ground)`.
    `${INDENT}${term.color(term.glyph("block8"), depthColor(0, term.ground))} = gone dark     ` +
      `${term.color(term.glyph("shade"), depthColor(1, term.ground))} = a human wrote or prompted it recently`,
    ...renderMiniMap(reading, term),
  ];
}

/**
 * THE HERO LINE — one file, named before the card abstracts again.
 *
 * The captions above are two sentences about a percentage, and the mini-map
 * under them is a shape. Between them the reader has still not been shown a
 * single thing they can open, and the section that names files is another
 * fifteen lines down. So one row is lifted to the top: the path, its score, and
 * the same two clauses the section will print beside it.
 *
 * WHY AN IMPERATIVE, AND NOT A SUPERLATIVE. "the largest blind spot" was the
 * obvious label and it is a claim the ordering cannot back: row one is the
 * biggest APPLICATION file of the biggest GROUP, and a bigger file below the
 * line can easily sit in a smaller group or a lower tier. A false superlative
 * in the card's best slot is exactly the kind of sentence this product cannot
 * afford.
 *
 * "start here" is a RECOMMENDATION rather than a measurement, and a
 * recommendation cannot be false — there is no experiment that refutes advice.
 * What makes it a good one rather than an empty one is that its whole basis is
 * printed beside it and underneath it: the last human contact, how many humans
 * are in the file's history, and — four lines down — the ordering rule the
 * section states out loud. A reader who disagrees with the advice can see
 * precisely what produced it and pick a different row.
 *
 * The alternative considered and rejected was self-reference: "first dark row"
 * is exactly true and describes the CARD rather than the repository, which is a
 * waste of the one line most likely to be read.
 *
 * It is row one of the ledger, which means it is also the path the `explain`
 * nudge prints and the file `fathohm explain 1` resolves — one file, named in
 * three places, or the card is pointing somewhere it did not print.
 *
 * IT IS SET AS THE ROW IT IS. The clause goes dim, exactly as it does fifteen
 * lines down in the section — the hero is the section's first row lifted, and a
 * lifted row that read differently from the one it duplicates would be two
 * renderings of one file. The path stays plain here for the same reason it does
 * there: a filename is data.
 */
function hero(
  ledger: Ledger,
  reading: RepoReading,
  term: Term,
  width: number,
): string[] {
  const first = ledger.rows[0];
  if (first === undefined) return [];
  const dot = term.glyph("dot");
  const head = `start here: ${first.path} ${dot}`;
  // Word positions, counted off the text rather than written as constants: the
  // path is one word to `wrap` however many slashes it has, and a hard-coded
  // index would silently paint the wrong token the day the sentence changes.
  const clauseFrom = wordCount(head);
  // A hanging indent, because this line wraps on almost every real path and a
  // continuation starting flush at the margin reads as a second statement —
  // worse, one starting with a separator glyph reads as a bullet.
  return paintWords(
    paragraph(
      `${head} ${whyDark(first, reading.now, term)}`,
      width,
      INDENT,
      `${INDENT}${INDENT}`,
    ),
    term,
    // THE LABEL IS THE INSTRUCTION, AND ONLY THE LABEL. `start here:` is the
    // card telling you what to do, which is the same category as a section
    // heading, so it takes the structure ink. The PATH stays plain — not an
    // oversight, and specifically not a candidate for the ramp: the GONE DARK
    // row this line is lifted FROM prints its path plain too, and a lifted row
    // that read differently from the one it duplicates would be two renderings
    // of one file. (`goneDark` records why the section colours headings and not
    // rows: a per-row palette spends the card's only hue on a distinction the
    // headings already spell out in full.)
    (index) => {
      if (index < LABEL_WORDS) return LABEL_INK[term.ground];
      return index >= clauseFrom ? "dim" : null;
    },
  );
}

/**
 * One shared array PER GROUND, so `paintWords` merges the label's words into
 * ONE run rather than emitting a fresh escape pair per word.
 *
 * The sharing is load-bearing rather than tidy: `paintWords` decides whether two
 * adjacent words belong to the same run with `===`, which on an array is
 * identity. Building the pair inside the callback would compile, render the same
 * words, and quietly emit one escape pair per word — a difference `discipline`
 * cannot see, because stripping escapes gives back the same plain text either
 * way. Resolved once for each ground instead.
 */
const LABEL_INK: Record<Ground, readonly ColorCode[]> = {
  dark: [structureInk("dark"), "bold"],
  light: [structureInk("light"), "bold"],
};

/** A word carrying a digit: the counts and shares inside a sentence. */
const DIGIT = /[0-9]/;

/** `start here:` — two words, counted rather than assumed. */
const LABEL_WORDS = "start here:".split(" ").length;

/**
 * GONE DARK — the ledger: one group per reason a file went dark, the files
 * under the group that describes them, and a column that adds up.
 *
 * The section the card was missing, and then the section the card had twice.
 * Everything above it is shares and shapes, and a share is not something a
 * reader can act on: they can open a file. But five paths under one banner
 * answered "which files" while a separate WHY section answered "what kind of
 * debt", and nothing on the screen connected them — so the paths now sit under
 * the heading that explains them, and the headings carry the percentages the
 * WHY section used to carry alone.
 *
 * WHAT THE HEADINGS ARE. Each is a group from `cli/src/reading/dark.ts`, in that
 * module's own vocabulary through `darkLedgerLine` — which in turn borrows
 * every clause from `lib/reading-explained`'s briefs rather than coining a
 * third phrasing for one idea. The groups are a total, disjoint partition of
 * exactly the file set the headline is computed from, which is what makes the
 * ledger's arithmetic a property rather than a promise: every group plus the
 * coda IS the repository.
 *
 * HOW THE ROWS ARE SHARED OUT. Five rows total, allocated across the groups by
 * largest remainder on group bytes, capped by what each group holds. A group
 * that ends with no rows still prints its heading: the heading is the finding
 * and the rows are only evidence for it, so a small bucket disappearing from
 * the ledger would be the decomposition quietly losing a term.
 *
 * WHAT SORTS TO THE BACK, WITHIN A GROUP. Three tiers, from `./kind`:
 * application code, then the scaffolding (config, sql, scripts, build output),
 * then tests and styles. "Nobody understands this test" is a different sentence
 * from "nobody understands this API route", and the section has four seconds to
 * hand over the second kind. Demotion, never exclusion — the score, the counts,
 * the denominator and the fold line are the ones they always were.
 *
 * The "why" beside each path is two clauses and never a sentence: the file's
 * newest human CONTACT (hand-written, prompted, or none), and how many humans
 * are anywhere in its history. Both are read off the same engagement record the
 * heading above the row was built from, so a row can never describe a different
 * contact than the group it sits under.
 *
 * WHAT LEFT THIS SECTION AT 1.5.0, besides the score column (see `./below`):
 * THE LEVERAGE LINE. It used to close the section with "a recorded, commented
 * review of the 5 files above re-scores this repo 72% → 7%", recomputed through
 * the real scorer and true as arithmetic. It is now a defect, and a bad one: a
 * review does not make a file lit. Recency is a fact about who AUTHORED the
 * file, and no amount of reading it moves the number this card prints. A card
 * that closed a list of dark files by recommending an action that provably
 * cannot move its own headline would be the most expensive kind of wrong — the
 * kind a reader only discovers after doing the work. The counterfactual it was
 * built from still exists, in `fathohm paydown`, where the number being moved
 * is the one it actually moves.
 *
 * The section closes on the coda that finishes the sum and the two directions
 * out: `--full` is MORE of the same list, `explain` is the same list one level
 * DOWN. The `explain` nudge carries row one's FULL path — a command a reader
 * has to repair before it runs is worse than no command, so the path is never
 * truncated and the line wraps instead.
 *
 * ── COLOUR IS THE HEADLINE'S OWN QUANTITY, HERE TOO ─────────────────────────
 *
 * The card has exactly one colour rule and the ledger takes it rather than
 * inventing a second: every hue on this screen comes out of `depthColor` fed
 * the LIT fraction, so the big number, the mini-map's bars and this section's
 * headings are three drawings of one scale.
 *
 * Which means every dark heading renders at the same pole and the coda renders
 * at the other, and that is the intended reading rather than an encoding that
 * failed. The words already say WHY each group is dark; what the colour adds is
 * the one thing the words cannot show at a glance — where the column stops
 * being about dark code. A per-group palette was the obvious alternative and it
 * is worse: it would spend the card's only hue on a distinction the headings
 * spell out in full.
 *
 * None of it is load-bearing. `--no-color`, `NO_COLOR` and a piped stdout all
 * return `term.color` to the identity, and the section is then byte-for-byte
 * the section it has always been — which is what the golden files pin.
 */
function goneDark(
  ledger: Ledger,
  reading: RepoReading,
  term: Term,
  width: number,
): string[] {
  if (ledger.rows.length === 0) return [];

  const dot = term.glyph("dot");
  // The rows come from `./below`, which is what the ordinal and the picker read
  // too. The card interleaves headings between them; it never lays one out.
  const bodies = new Map(
    rowsOf(ledger, reading, term).map((row) => [row.file.path, row.body]),
  );

  // TWO LINES OF HEAD, because three clauses do not fit in eighty columns and a
  // wrapped section head is a ruined screenshot. The first names the section and
  // the predicate it selects on — set tight, and still the constant rather than
  // a retyped number. The second is the row rule, dim: it is the answer to "why
  // is that test under that route", and a reader who never asks should not have
  // to read it twice.
  const lines = [
    ...sectionHead(
      term,
      `GONE DARK (nobody wrote or prompted it in ${DARK_WINDOW_DAYS}d)`,
    ),
    term.color(
      `${INDENT}application code first ${dot} config, sql, scripts ${dot} then tests & styles`,
      "dim",
    ),
  ];

  for (const group of ledger.groups) {
    lines.push("");
    // UPPERCASE IS A PROMISE OF ROWS. The five-row budget is shared out by
    // largest remainder, so a real group can be too small to win one — and a
    // heading in caps with nothing under it reads as a truncated screen, not as
    // a small group. Stated in lower case it reads as what it is: a complete
    // sentence about a share, which is exactly how the coda below already
    // renders the one group that never lists rows. The group itself is never
    // dropped — these are a partition, and a partition with a member missing
    // does not add up.
    const head = darkLedgerLine(group.group, group.printed);
    lines.push(
      ...paragraph(
        prose(term, group.rowCount > 0 ? head.toUpperCase() : head),
        width,
      ).map((line) => term.color(line, depthColor(group.score, term.ground))),
    );
    for (const file of group.files.slice(0, group.rowCount)) {
      lines.push(INDENT + (bodies.get(file.path) as string));
    }
  }

  // THE CODA closes the arithmetic. Everything above it is dark; this is what
  // is left, and the two add to the whole repository because the groups are a
  // partition rather than a selection. It takes the same colour rule every
  // other heading takes, and because it is the one group with a human hand in
  // it, it always renders at the other pole — the ledger's argument made
  // without a word.
  const lit = ledger.lit;
  if (lit !== null) {
    lines.push("");
    lines.push(
      ...paragraph(
        prose(term, darkLedgerLine(lit.group, lit.printed)),
        width,
      ).map((line) => term.color(line, depthColor(lit.score, term.ground))),
    );
  }

  lines.push("");
  const rest = ledger.order.length - ledger.rows.length;
  if (rest > 0) {
    lines.push(
      ...paintWords(
        runnable(
          term,
          [`${INDENT}${rest} more gone dark: fathohm read --full`],
          "fathohm read --full",
        ),
        term,
        (index) => (index === 0 ? "bold" : null),
      ),
    );
  }
  lines.push(
    ...runnable(
      term,
      paragraph(
        `factor by factor: fathohm explain ${ledger.rows[0].path}`,
        width,
        INDENT,
      ),
      "fathohm explain",
    ),
  );
  return lines;
}

/**
 * `--full`: every dark path, largest first.
 *
 * Not on the default card, which names five and defers. The card's job is the
 * shape of the problem, and a hundred-line file list buries the sections that
 * carry the argument — but a reader who has decided to act needs the paths.
 *
 * LARGEST FIRST, and not by score. Bytes are the headline's own weighting, so
 * the top of this list is the top of the number; ordering by score would rank
 * the list on a quantity the section it extends does not select on.
 *
 * THE SCORE IS STILL A COLUMN, and this is the one place on the card where it
 * is. It left the default rows because a comprehension-debt score beside a file
 * selected for going dark reads as the reason it is listed — but a reader who
 * asked for the long form is past that risk and the number is genuinely useful
 * to them. Which is also what keeps "the score is off the row, not out of the
 * tool" a true sentence rather than a consolation.
 */
function darkPaths(reading: RepoReading, term: Term): string[] {
  const dark = reading.files
    .filter(isDark)
    .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  if (dark.length === 0) return [];

  const scoreWidth = 5;
  const sizeWidth = 6;
  // The path is LAST and unpadded: a trailing run of spaces is invisible in a
  // terminal and load-bearing in a golden file, and every column before it is
  // fixed-width anyway.
  const pathWidth = Math.max(
    20,
    term.width - INDENT.length - scoreWidth - sizeWidth - 2,
  );
  // TWO LINES, AND THE SECOND ONE NAMES THE COLUMNS. The first draft of this
  // heading read `(N files, comprehension debt at the floor)` over a column of
  // `0.083`, `0.167` — which inverts the reading twice over. `file.floor` is a
  // SCORE: 0–1, higher is better. Labelled "comprehension debt", 0.083 reads as
  // less debt than 0.167, exactly backwards. And it is the wrong unit: every
  // other comprehension-debt figure on this card is a percentage share, and
  // `./json` states the invariant out loud — a score and a share never meet in
  // one object. They met in that parenthetical.
  //
  // Naming the columns costs one line and cannot be misread. "higher is better"
  // is there because a 0–1 scale has no inherent direction either.
  const lines = [
    `${INDENT}gone dark, largest first (${dark.length} ${dark.length === 1 ? "file" : "files"})`,
    term.color(
      `${INDENT}comprehension score at the floor (0${term.glyph("dash")}1, higher is better) ` +
        `${term.glyph("dot")} size ${term.glyph("dot")} path`,
      "dim",
    ),
  ];
  for (const file of dark) {
    lines.push(
      INDENT +
        padEnd(file.floor.toFixed(3), scoreWidth) +
        " " +
        padStart(formatBytes(file.bytes), sizeWidth) +
        " " +
        truncatePath(file.path, pathWidth, term.glyph("ellipsis")),
    );
  }
  return lines;
}

/**
 * COMPREHENSION DEBT — the number this card does not print, and who can.
 *
 * THIS IS THE DEMOTION, and it is the point of the whole 1.5.0 change. Until
 * now the debt interval WAS the card: a floor at headline size with the ceiling
 * in the caption under it. It is the same two numbers, computed identically,
 * moved to the one place on the card where a range does not have to compete
 * with a repository's own name for the reader's first four seconds.
 *
 * TWO LABELLED READINGS, and never "the truth sits between". The tempting
 * phrasing sounds like humility and is a claim about a distribution nobody here
 * has measured — worse, it is testably wrong in one direction: a squash-merged
 * pull request leaves nothing in the commit graph, so the ceiling cannot credit
 * a review that happened, and the hosted number for a repository like hono
 * lands OUTSIDE the interval rather than inside it. What is honestly sayable is
 * that each end is one reading of the same record, git says nothing about which
 * is right, and the App is what settles it. So that is what it says.
 *
 * THE CANONICAL GLOSS, because CLAUDE.md's copy rule requires it at the first
 * prominent use of the term on any surface, and after the demotion this block
 * IS the first use on this one. Through `debtGloss` rather than typed: this is
 * one of four surfaces that name the term, and four copies of one sentence
 * would be four definitions of it.
 *
 * The bullets name the mechanism rather than a capability. "git cannot see the
 * PR review record" invites the reply that git is not supposed to, and "the
 * hosted reading can" is a claim about a product a reader has not used. "git
 * does not record PR reviews. The GitHub App reads them" is two facts, and the
 * second one is checkable by installing the thing.
 *
 * No adjectives. A trust product that reaches for "powerful" on the one screen
 * where it has just finished being careful has spent the care.
 */
function closing(
  reading: RepoReading,
  tide: TideSeries | null,
  term: Term,
  width: number,
): string[] {
  const dash = term.glyph("dash");

  return [
    INDENT + term.glyph("rule").repeat(RULE_WIDTH),
    ...sectionHead(
      term,
      "COMPREHENSION DEBT",
      "git alone cannot measure it",
      ` ${dash} `,
    ),
    ...debtGloss(term, width),
    ...readings(reading, term, width),
    // THE TREND STRIP MOVED HERE AT 1.5.0, and the move is the fix rather than
    // a tidy-up. It plots the comprehension-debt INTERVAL over time, and it
    // used to sit above this block — so a reader met "today: 24% - 72%" a
    // dozen lines after a headline of 45%, with nothing on the screen to say
    // they were different quantities. Two unexplained numbers in one card is
    // the exact confusion this release exists to remove. Under the heading
    // that names the quantity, the same strip is a trend OF something.
    ...(tide === null ? [] : ["", ...renderTideStrip(tide, term)]),
    "",
    // TWO LINES, AND NO TICKED FEATURE LIST. The first sentence is
    // load-bearing: this block has just refused to say which reading is right,
    // and this names the thing that settles it. The three ✓ bullets under it
    // were a landing page's grammar in a terminal — "weekly digest",
    // "per-member view" are features for somebody already sold, and read as an
    // advertisement closing a reading that had spent forty lines earning
    // trust.
    ...runnable(
      term,
      paragraph(
        `git does not record PR reviews. The GitHub App reads them and settles which reading ` +
          `is right ${dash} ${HOSTED_URL}`,
        width,
      ),
      HOSTED_URL,
    ),
  ];
}

/**
 * THE TWO READINGS, each with its own label and its own share.
 *
 * The share leads each line and the label follows, so the pair is scanned down
 * a column of numbers rather than read as two sentences — a reader who takes
 * nothing else from this block should take away that there are two of them.
 *
 * THE ZERO-WIDTH CASE IS STATED, not silently rendered as a point. No spread
 * means no file below the line ever went through a pull request — full review
 * credit is worth more than the line, so any PR-mediated file below the floor
 * would have lifted the ceiling — and that is a fact about this history worth
 * one sentence rather than a second copy of the first number.
 */
function readings(reading: RepoReading, term: Term, width: number): string[] {
  const dash = term.glyph("dash");
  const floor = formatBlindShare(
    exactBlindShare(reading.floorBlindBytes, reading.scoredBytes),
  );
  const ceiling = formatBlindShare(
    exactBlindShare(reading.ceilingBlindBytes, reading.scoredBytes),
  );

  if (isExact(reading)) {
    return paragraph(
      `${floor} here, and it is exact: nothing counted as debt ever went through a pull ` +
        `request, so no review credit could lower it.`,
      width,
      `${INDENT}  `,
      `${INDENT}  `,
    );
  }

  // The widest share sets the column, measured rather than reserved: `<1%` and
  // `100%` differ by two cells and a hard-coded gutter would misalign one of
  // them on every repository that prints it.
  const column = Math.max(floor.length, ceiling.length);
  const lead = (share: string): string =>
    `${INDENT}  ${" ".repeat(column - share.length)}${share}  `;

  /**
   * THE TWO ENDS ARE PAINTED, AFTER THE WRAP HAS MEASURED THEM.
   *
   * Painting is the section's argument rather than decoration: the block exists
   * to say git cannot choose between these two numbers, and a red end above a
   * blue end shows the size of that gap before the sentences beside them are
   * read. Each row carries one share, so each can honestly take its own colour
   * — which is why the TREND rows stay unpainted, where one row carries a whole
   * interval and colouring it would mean picking the end that gets quoted.
   *
   * The share is coloured in the OUTPUT, not in the lead handed to `paragraph`.
   * An escape has bytes and no width, so a lead coloured before wrapping makes
   * the wrapper think the line is eight characters longer than it is and breaks
   * the sentence early — which `discipline.test.ts` caught on the first run.
   *
   * `blind` is 0..1, NOT the 0..100 the printed string is formatted from:
   * `exactBlindShare` returns a percentage and `depthColor` takes a fraction,
   * and passing one for the other is silently swallowed by the ramp's own
   * clamp — 1-34 and 1-100 both clamp to zero and paint the two ends the
   * identical red. Hence `floorShareOf`/`ceilingShareOf`, the same 0..1 family
   * the big number already draws from.
   */
  const paint = (lines: string[], share: string, blind: number): string[] => {
    const first = lines[0];
    if (first === undefined) return lines;
    const at = first.indexOf(share);
    if (at === -1) return lines;
    return [
      first.slice(0, at) +
        term.color(share, depthColor(1 - blind, term.ground)) +
        first.slice(at + share.length),
      ...lines.slice(1),
    ];
  };
  const hang = " ".repeat(INDENT.length + 2 + column + 2);

  return [
    // EACH END AS A CONDITION, not as a description of a method. "reading git's
    // record as it stands" made the reader reconstruct what that record's
    // silence implies before either number meant anything; "if no pull request
    // was ever reviewed in depth" is the same assumption, stated as the thing
    // it assumes. Two `if` clauses in the same grammar are also comparable down
    // the column, which is what the aligned shares are for.
    ...paint(
      paragraph(
        `if no pull request here was ever reviewed in depth ${dash} git records no reviews, ` +
          `so this is the record as it stands`,
        width,
        lead(floor),
        hang,
      ),
      floor,
      floorShareOf(reading),
    ),
    ...paint(
      paragraph(
        `if every pull request was reviewed in depth`,
        width,
        lead(ceiling),
        hang,
      ),
      ceiling,
      ceilingShareOf(reading),
    ),
    ...paragraph(
      `git cannot say which. That is the gap, not a margin of error.`,
      width,
    ),
  ];
}

/**
 * The last line: the single most load-bearing sentence for whether a stranger
 * runs this on a private repository.
 *
 * It survives pedantry by inviting it. "zero network calls (there is a test
 * that proves it)" lost that argument twice over — a test demonstrates, it
 * does not prove, and the `npx` that launched this very reading fetched a
 * package over the network first. So the line states two properties of the
 * tool ("no telemetry, no network"), one fact about this reading's inputs, and
 * one experiment anybody can run. Nothing in it can be half-true.
 *
 * Dim, and wrapped before it is coloured: a colour run measured in bytes rather
 * than columns wraps in the wrong place.
 *
 * Exported, and every card ends on exactly this: `offboard` runs the same
 * scorer over the same clone and makes the same promise, and a second wording
 * of the one sentence that decides whether a stranger runs this on a private
 * repository would be two products making two promises.
 */
export function offlineCloser(term: Term, width: number): string[] {
  return paragraph(
    `no telemetry, no network: this reading used only your local git history. Verify by ` +
      `running it offline.`,
    width,
  ).map((line) => term.color(line, "dim"));
}
