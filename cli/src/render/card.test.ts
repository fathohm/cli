import { describe, expect, it } from "vitest";

import { exactBlindShare, formatBlindShare } from "../../../lib/blind-share-format";
import { DIVERGING, scoreColor } from "../../../lib/palette";
import { DEBT_GLOSS } from "../../../lib/reading-explained";
import { DARK_WINDOW_DAYS, darkLedgerLine, isDark } from "../reading/dark";
import { ADA, GRACE } from "../../test-helpers/fixture-repo";
import {
  ALL_SET_ASIDE,
  EMPTY,
  HANDOVER,
  KINDS_BELOW,
  LONG_NAMES,
  MIXED,
  NON_CODE,
  PROMPTED_DOMINANT,
  PROMPTED_ONLY,
  SHALLOW,
  SQUASH_ONLY,
  readingOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import { darkRows } from "./below";
import { bigNumberRows } from "./bignum";
import { renderCard } from "./card";
import { formatInterval } from "./interval";
import { kindRank } from "../reading/kind";
import { isDegenerate } from "../reading/scoring";
import { ledgerOf, type Ledger } from "./ledger";
import type { RenderMeta } from "./meta";
import { miniMapRows } from "./minimap";
import { depthColor } from "./ramp";
import { INDENT, asciiFold } from "./text";

/**
 * THE READING CARD, at 1.5.0 — the headline is the DARK SHARE.
 *
 * What this file used to defend was a comprehension-debt floor drawn at
 * headline size with a ceiling in the caption under it. The CLI cannot measure
 * that number: `human_review_depth` carries 0.40 of the score and git records
 * no reviews, so the reading was an INTERVAL that was supposed to bracket the
 * hosted number and — measured against a squash-merging repository — does not.
 * The card now headlines the question a `.git` directory can actually close
 * (`cli/src/reading/dark.ts`), and the debt interval is demoted to the closing block as
 * TWO LABELLED READINGS.
 *
 * So the assertions moved with it. Everything below is asserted against a value
 * the reading itself carries — `reading.darkBytes`, a ledger group's own
 * `printed` share, `DARK_WINDOW_DAYS` — and never against a percentage typed
 * here. The golden files are where bytes are pinned; this file is where the
 * card's promises are.
 */

function term(overrides: Parameters<typeof createTerm>[0] = {}): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80, ...overrides });
}

function meta(overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target: "fixture",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

function card(fixture = MIXED, overrides: Partial<RenderMeta> = {}, shared: Term = term()): string {
  const { reading, tide } = readingOf(fixture);
  return renderCard(reading, overrides.quiet === true ? null : tide, shared, meta(overrides)).join(
    "\n",
  );
}

/** Where a marker first appears, or -1. Ordering is asserted on positions
 *  rather than on a line list, so inserting a sentence cannot break it. */
function at(text: string, needle: string): number {
  return text.indexOf(needle);
}

/**
 * The card with every run of whitespace collapsed.
 *
 * For asserting on SENTENCES. The card wraps at the terminal width, so a
 * sentence a reader sees as one phrase is two lines and an indent to
 * `String.prototype.includes` — and a test that pins where a wrap happens is
 * pinning the column, not the copy. The golden files are where bytes are
 * asserted; here the subject is what the card says.
 */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** THE HEADLINE, as the reading computes it — the number the big digits draw. */
function darkText(fixture: ExtractFixture): string {
  const { reading } = readingOf(fixture);
  return formatBlindShare(exactBlindShare(reading.darkBytes, reading.scoredBytes));
}

/** The debt floor, which is now a LABELLED READING in the closing block. */
function floorText(fixture: ExtractFixture): string {
  const { reading } = readingOf(fixture);
  return formatBlindShare(exactBlindShare(reading.floorBlindBytes, reading.scoredBytes));
}

/** The debt ceiling — the other labelled reading, never the headline. */
function ceilingText(fixture: ExtractFixture): string {
  const { reading } = readingOf(fixture);
  return formatBlindShare(exactBlindShare(reading.ceilingBlindBytes, reading.scoredBytes));
}

/** The ledger as the card computes it — one derivation, shared with the renderer. */
function ledger(fixture: ExtractFixture): Ledger {
  return ledgerOf(readingOf(fixture).reading);
}

/** Every dark file of a fixture, by the predicate the headline is defined by. */
function darkOf(fixture: ExtractFixture) {
  return readingOf(fixture).reading.files.filter(isDark);
}

/**
 * The ledger's section head, built from the constant rather than retyped: the
 * window is `workers/src/scorer.ts`'s `RECENCY_WINDOW_DAYS`, and a `180` typed
 * here would keep passing on the day the scorer's window moved.
 */
const LEDGER_HEAD = `GONE DARK (nobody wrote or prompted it in ${DARK_WINDOW_DAYS}d)`;

/** The GONE DARK section only, as text. Empty when the card printed none. */
function section(text: string): string {
  const start = at(text, LEDGER_HEAD);
  return start === -1 ? "" : text.slice(start);
}

/** A group heading exactly as the card sets it: shared vocabulary, folded, capitals. */
function heading(group: Ledger["groups"][number]): string {
  const line = asciiFold(darkLedgerLine(group.group, group.printed));
  // Upper case is the card's promise that rows follow. A group too small to win
  // one under the five-row budget is stated in lower case instead, beside the
  // coda, which is the other group that never lists rows.
  return group.rowCount > 0 ? line.toUpperCase() : line;
}

/** The coda, as the card sets it: the lit group, always in lower case. */
function coda(structure: Ledger): string {
  const lit = structure.lit as NonNullable<Ledger["lit"]>;
  return asciiFold(darkLedgerLine(lit.group, lit.printed));
}

/**
 * The file rows the section printed, in order.
 *
 * Matched against the bodies `./below` laid out rather than against a column
 * shape. The rows lost their score at 1.5.0, so `/^ {2}0\.\d\d {2}/` no longer
 * finds one — and a looser "any indented line" pattern would count headings and
 * codas as rows, which is exactly the arithmetic several tests here turn on.
 */
function printedRows(text: string, fixture: ExtractFixture, shared: Term = term()): string[] {
  const bodies = new Set(darkRows(readingOf(fixture).reading, shared).map((row) => row.body));
  return section(text)
    .split("\n")
    .filter((line) => line.startsWith(INDENT) && bodies.has(line.slice(INDENT.length)));
}

describe("the sections argue in order", () => {
  const text = card();

  it("puts the number, the sentence, one file, the keeper share, where, the ledger, then the debt", () => {
    const order = [
      at(text, "FATHOHM"),
      // The big number's own label, which is the first "GONE DARK" on the card.
      at(text, "GONE DARK"),
      at(text, "has gone dark:"),
      at(text, "start here:"),
      at(text, "exactly one human in their history"),
      at(text, "WHERE"),
      at(text, LEDGER_HEAD),
      at(text, "authorship is declared, not detected: undeclared agent work reads as human."),
      at(text, "COMPREHENSION DEBT"),
      at(text, "TREND"),
      at(text, "https://"),
      at(text, "no telemetry, no network"),
    ];
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("has no WHY section left — the groups moved INTO the ledger", () => {
    // Two sections about the same files, with nothing on screen connecting
    // them, was the thing the ledger replaced. A stray WHY heading would mean
    // the decomposition is being rendered twice again.
    expect(text.split("\n").some((line) => line.trim() === "WHY")).toBe(false);
  });

  it("states the clock the reading was taken by, before any number", () => {
    expect(at(text, "2026-07-31T00:00:00Z")).toBeLessThan(at(text, "GONE DARK"));
  });

  it("names its scorer — a reading you cannot attribute to a lens is not evidence", () => {
    expect(text).toContain(`scorer ${SCORER_VERSION}`);
  });
});

/** The percent sign, by code point: `discipline.test.ts` bans the glyph from a
 *  renderer's source and this file reaches for the same discipline. */
const PERCENT_SIGN = String.fromCharCode(37);

describe("the big number is the dark share", () => {
  const plain = term();

  it("draws the seven-segment faces the design pins", () => {
    // Eight is every segment lit and zero is every segment but the middle;
    // between them they pin the stroke weight, the cell width and the gap.
    expect(bigNumberRows("80", plain)).toEqual([
      "####  ####",
      "#  #  #  #",
      "####  #  #",
      "#  #  #  #",
      "####  ####",
    ]);
  });

  it("draws every diagonal stroke at least two cells thick", () => {
    // THE RULE `bignum.ts` STATES, AS A TEST RATHER THAN A COMMENT. At this
    // resolution a one-cell diagonal reads as a dotted line rather than as a
    // stroke, which is why the chevrons are drawn thick — and the percent sign,
    // written directly under that comment, was not. It shipped as a dotted
    // slash on the largest thing the card draws, and the test guarding this
    // pinned the broken shape as a literal, so it could only ever answer "did
    // this change" and never "is this right".
    //
    // Digits are exempt by construction: they are seven-segment, and `1` is a
    // single vertical stroke whose cells have no horizontal neighbour at all.
    for (const character of ["<", ">", PERCENT_SIGN]) {
      for (const row of bigNumberRows(character, plain)) {
        for (const run of row.split(" ").filter((piece) => piece !== "")) {
          expect(run.length, `${character} draws a ${run.length}-cell run`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("still prints a display floor at headline size", () => {
    // `<1%` is not a decoration: it is the rule that a real sliver of a large
    // codebase never prints as "0%". Asserted as a composition — the floor is
    // its three faces side by side — rather than as a retyped picture.
    const rows = bigNumberRows(`<1${PERCENT_SIGN}`, plain);
    expect(rows).toHaveLength(5);
    for (const [index, row] of rows.entries()) {
      expect(row).toContain(bigNumberRows("<", plain)[index]);
      expect(row).toContain(bigNumberRows(PERCENT_SIGN, plain)[index].trimEnd());
    }
  });

  it("points the two chevrons in opposite directions", () => {
    expect(bigNumberRows("<", plain)).not.toEqual(bigNumberRows(">", plain));
    expect(bigNumberRows("<", plain)).toEqual([...bigNumberRows(">", plain)].map(reverse));
  });

  it("is five rows of one glyph and spaces, whatever the value", () => {
    for (const value of ["0", "100%", "<1%", ">99%", "42%"]) {
      const rows = bigNumberRows(value, plain);
      expect(rows, value).toHaveLength(5);
      expect(new Set(rows.map((row) => row.length)).size, value).toBe(1);
      expect(rows.join(""), value).toMatch(/^[# ]+$/);
    }
  });

  it("swaps the block for `#` under --ascii, and nothing else", () => {
    const unicode = bigNumberRows("80", term({ ascii: false }));
    expect(unicode.join("\n")).not.toMatch(/#/);
    expect(unicode.map((row) => row.replace(/█/g, "#"))).toEqual(bigNumberRows("80", plain));
  });

  it("draws the DARK SHARE — the reading's own bytes, and neither end of the debt", () => {
    // The one assertion this whole release turns on. Until 1.5.0 the digits
    // were the debt FLOOR, with the ceiling in the caption; both are still
    // computed and both are still on the card, twenty lines down and labelled.
    // What the digits draw now is `darkBytes / scoredBytes`, which is why this
    // compares three blocks: a card that reverted to either end of the interval
    // would still draw a plausible number at headline size.
    const darkBlock = bigNumberRows(darkText(MIXED), plain);
    const floorBlock = bigNumberRows(floorText(MIXED), plain);
    const ceilingBlock = bigNumberRows(ceilingText(MIXED), plain);
    expect(darkBlock).not.toEqual(floorBlock);
    expect(darkBlock).not.toEqual(ceilingBlock);

    const text = card();
    for (const row of darkBlock) expect(text).toContain(row.trimEnd());
    expect(text).not.toContain(floorBlock.join("\n  "));
    expect(text).not.toContain(ceilingBlock.join("\n  "));
  });

  it("labels itself GONE DARK on the middle row, and leaves no trailing space anywhere", () => {
    const rows = card().split("\n").slice(3, 8);
    expect(rows[2]).toMatch(/ {2}GONE DARK$/);
    for (const row of rows) expect(row).toBe(row.replace(/\s+$/, ""));
  });
});

describe("the sentence under the number", () => {
  it("says what the number counts, in words git can back", () => {
    // The share and the window both come from outside this file: the first from
    // the reading, the second from the scorer's own constant.
    expect(flat(card())).toContain(
      `${darkText(MIXED)} of this code has gone dark: no human has written or prompted any of ` +
        `it in the last ${DARK_WINDOW_DAYS} days`,
    );
  });

  it("NAMES BOTH VERBS, everywhere it defines the predicate", () => {
    // "written or prompted" is load-bearing, and dropping either half is the
    // one copy error on this card that would be wrong in the direction that
    // FLATTERS the headline. A mixed commit — a human formed the intent, an
    // agent produced the diff — carries the scorer's quarter weight, which is
    // enough to keep `human_author_recency` above zero and the file lit. So a
    // card claiming only that "no human has WRITTEN any of it" would be making
    // a claim about files somebody prompted last week, and a reader who checked
    // with `git log` would catch it.
    //
    // Asserted on all three sentences that define the predicate rather than on
    // the caption alone: the section head and the coda make the same claim to
    // the same reader, and a verb dropped from any of them is the same defect.
    const text = flat(card());
    const structure = ledger(MIXED);
    // The caption is cut out by its own two ends, and both are asserted to
    // exist first: a slice from -1 would hand this test most of the card, where
    // some other sentence would supply the missing verb and hide the defect.
    expect(at(text, "of this code has gone dark")).toBeGreaterThan(-1);
    expect(at(text, "(exact --")).toBeGreaterThan(-1);
    const sentences = [
      text.slice(at(text, "of this code has gone dark"), at(text, "(exact --")),
      LEDGER_HEAD,
      coda(structure),
    ];
    for (const sentence of sentences) {
      expect(sentence, sentence).toMatch(/\b(written|wrote)\b/);
      expect(sentence, sentence).toMatch(/\bprompted\b/);
    }
  });

  it("is right to name prompting: a prompt inside the window keeps a file lit", () => {
    // The fixture proof behind the test above. If prompting did not keep a file
    // lit, "or prompted" would be harmless decoration; because it does, these
    // files are OUT of the headline, and the sentence has to say so.
    const kept = readingOf(MIXED).reading.files.filter((file) => {
      const { last_hand_authored, last_prompted } = file.factors.engagement;
      if (last_prompted === null || isDark(file)) return false;
      return (
        last_hand_authored === null ||
        Date.parse(last_prompted) > Date.parse(last_hand_authored)
      );
    });
    expect(kept.length, "no file in this fixture is held lit by a prompt").toBeGreaterThan(0);
    // Compared on PATHS: `darkOf` re-scores the fixture, so its files are equal
    // to these and identical to none of them, and an identity check here would
    // pass on a card that counted every prompted file as dark.
    const dark = darkOf(MIXED).map((file) => file.path);
    for (const file of kept) expect(dark, file.path).not.toContain(file.path);
  });

  it("marks the headline exact, as a parenthetical rather than a denial", () => {
    // The closing block carries an interval, and this is what stops a reader
    // meeting the two and reading them as competing estimates of one quantity.
    // It is bracketed because it led the clause as "One number, not a range"
    // and a cold reader met the denial before any range existed on the card —
    // a stumble in the one sentence that has to land.
    const text = flat(card());
    expect(text).toContain("(exact -- git records every commit's author and date).");
    expect(text).not.toContain("One number, not a range");
  });

  it("does not render the general sentence at zero, where it would define the empty set", () => {
    // `PROMPTED_ONLY` is agent-written throughout and every file was touched
    // inside the window: 0% dark and 100% comprehension debt, both correct. The
    // general form ("0% of this code has gone dark: no human has written or
    // prompted any of it…") reads as a claim about the whole repository, and on
    // this fixture it would be the product's own headline flattering the exact
    // codebase it exists to warn about.
    const { reading } = readingOf(PROMPTED_ONLY);
    expect(reading.darkBytes).toBe(0);
    const text = card(PROMPTED_ONLY);
    expect(text).not.toContain("of this code has gone dark: no human");
    expect(flat(text)).toContain(
      `None of this code has gone dark: a human wrote or prompted every one of these ` +
        `${reading.files.length} files within the last ${DARK_WINDOW_DAYS} days.`,
    );
    // And it hands the reader to the block that carries the other question.
    expect(text).toContain("COMPREHENSION DEBT");
  });

  /**
   * The zero card's whole job, and the one it used to fail.
   *
   * "Nothing has gone dark" is good news about ONE question, and `PROMPTED_ONLY`
   * is the repository where saying only that is the most misleading true
   * sentence this product can print: 0% dark, 100% comprehension debt. The old
   * card met it with five rows of block cells reading `0%`, then pointed at the
   * hundred without printing it — a whole screen further down, past the
   * mini-map. A reader who stopped after four lines left reassured.
   */
  describe("a zero card carries the other number in its own lede", () => {
    it("prints the wider reading's share before the fold, not just a pointer to it", () => {
      const { reading } = readingOf(PROMPTED_ONLY);
      expect(reading.darkBytes).toBe(0);
      // Not a vacuous assertion: this fixture's two readings agree at 100%, so
      // the lede is stating the bad news the headline cannot.
      expect(reading.floorBlindBytes).toBe(reading.scoredBytes);

      const lede = flat(card(PROMPTED_ONLY).split("\n").slice(0, 10).join("\n"));
      // The bad number opens its OWN paragraph, first word. Buried mid-sentence
      // in the third clause of the third sentence, a skimmer left reassured —
      // which on this fixture is the worst outcome the card can produce.
      expect(lede).toContain(
        "100% of it is code no human has recently written, reviewed, or explained",
      );
      expect(lede).not.toContain("That is the only question git can close on its own");
    });

    it("spends the plain description rather than the term, which would owe the gloss", () => {
      // CLAUDE.md wants the canonical gloss at the first prominent use of
      // "comprehension debt" per surface. Naming the term in the lede would
      // move that first use twelve lines above the block that defines it, and
      // buy a second copy of the definition on one card.
      const lede = flat(card(PROMPTED_ONLY).split("\n").slice(0, 10).join("\n"));
      expect(lede.toLowerCase()).not.toContain("comprehension debt");
      expect(card(PROMPTED_ONLY)).toContain("COMPREHENSION DEBT");
    });

    it("opens on the plain sentence: nothing at headline size, and no caps metaphor", () => {
      const text = card(PROMPTED_ONLY);
      const lines = text.split("\n").filter((line) => line.trim() !== "");

      // The big face is five rows of one repeated glyph. At zero there is no
      // claim to make at that size, and `0%` under the words GONE DARK fails
      // the covered-label test in both directions.
      const face = text.split("\n").filter((line) => /^\s*[#█]{2,}/.test(line));
      expect(face, "the zero card must not draw the big number").toEqual([]);

      // Nor a caps banner in its place. "GONE DARK" is this product's own
      // metaphor and CLAUDE.md allows it only NEXT TO an always-visible plain
      // sentence, plain sentence first — a banner is the metaphor standing
      // alone with its gloss on the next line down.
      expect(text).not.toContain("NOTHING HAS GONE DARK");

      // So the first thing after the header is the sentence itself, and the
      // metaphor arrives inside it, after the plain clause.
      // The general card opens "45% of this code has gone dark: <plain>"; the
      // zero card opens on the same sentence shape at the other value, so the
      // two ledes are one grammar rather than two.
      expect(lines[2]).toContain("None of this code has gone dark:");
      expect(flat(text)).toContain(
        "None of this code has gone dark: a human wrote or prompted every one of these",
      );
    });

    it("still draws the big face when there IS something to shout", () => {
      const { reading } = readingOf(MIXED);
      expect(reading.darkBytes).toBeGreaterThan(0);
      const face = card(MIXED).split("\n").filter((line) => /^\s*[#█]{2,}/.test(line));
      expect(face.length).toBeGreaterThan(0);
    });
  });
});

/**
 * NO MIND-CLAIMS — the rule CLAUDE.md's copy section states, checked on the
 * card's OUTPUT.
 *
 * `lib/vocabulary.guardrail.test.ts` already sweeps `cli/src` for this, and it
 * is the better place for the general rule: it walks every shipped source file
 * and would catch a mind-claim in a renderer nobody thought to test. What it
 * cannot see is the RENDERED card. Its patterns run over one file at a time
 * with comments stripped, and this card's sentences are assembled out of three
 * modules — `cli/src/reading/dark.ts` supplies the group headings, `lib/reading-
 * explained` the gloss, and this file's own copy sits between them. A claim
 * that exists only once the pieces are joined is invisible to a per-file grep
 * and perfectly visible to a reader.
 *
 * The bar here is also deliberately higher than the guardrail's. The guardrail
 * permits "understand" in copy that labels no measurement (the essay argues
 * about the category and is exempt for exactly that reason). Every sentence on
 * this card labels a number, so on this surface the word has no legal use at
 * all — which makes the assertion a property rather than a list of banned
 * phrasings.
 */
describe("no mind-claims anywhere on the card", () => {
  const surfaces: Array<[label: string, text: string]> = [
    ["mixed", card()],
    ["mixed --full", card(MIXED, { full: true })],
    ["mixed --quiet", card(MIXED, { quiet: true })],
    ["nothing dark", card(PROMPTED_ONLY)],
    ["every kind set aside", card(ALL_SET_ASIDE, {}, term({ columns: 100 }))],
    ["an empty repository", card(EMPTY)],
  ];

  for (const [label, text] of surfaces) {
    it(`${label}: never says anyone does or does not understand anything`, () => {
      expect(text, "the card describes the record, never the mind").not.toMatch(
        /\bunderstand(s|ing|able|ings)?\b/i,
      );
      expect(text).not.toMatch(/\bwell[\s-]understood\b/i);
    });
  }

  it("describes the record instead, in the words the product owns", () => {
    // The counterweight: a card that satisfied the rule by saying nothing would
    // pass every assertion above. What replaces the mind-claim is the record —
    // who wrote it, who prompted it, and when.
    const text = flat(card());
    expect(text).toContain("no human has written or prompted any of it");
    expect(text).toContain("recently written, reviewed, or explained");
  });
});

/**
 * `gloss.test.ts` owns the CROSS-SURFACE rule — any surface that names a term
 * defines it, checked clause by clause so the em dash's ascii fold cannot break
 * it. What is asserted here is the two things that rule does not cover: that
 * the sentence on this card is the CONSTANT rather than a copy of it, and where
 * on the card it lands. A third test of the same property would be a third
 * definition waiting to happen.
 */
describe("the canonical gloss is imported, not typed", () => {
  it("carries `DEBT_GLOSS` itself, verbatim", () => {
    // CLAUDE.md's copy rule owes the term its definition at the first prominent
    // use on any surface, and after the demotion the closing block IS the first
    // use on this one. Asserted against the CONSTANT: two surfaces that wrote
    // the sentence out by hand would eventually be two definitions of the
    // category we are trying to be the instrument for.
    expect(flat(card(MIXED, {}, term({ ascii: false })))).toContain(DEBT_GLOSS);
  });

  it("folds to ascii without losing a word of it", () => {
    expect(flat(card())).toContain(asciiFold(DEBT_GLOSS));
  });

  it("sits inside the closing block, where the term is first used", () => {
    // Positions are taken off the gloss's opening words rather than off the
    // whole sentence: it wraps at every terminal width the card supports, so
    // the constant is a phrase on screen and never a substring of one line.
    const text = card();
    expect(at(text, "COMPREHENSION DEBT")).toBeLessThan(at(text, "Comprehension debt: code"));
  });
});

describe("COMPREHENSION DEBT — two labelled readings", () => {
  const text = card();

  it("leads each line with its share and follows it with its label", () => {
    // Scanned down a column of numbers rather than read as two sentences: a
    // reader who takes nothing else from this block should take away that there
    // are TWO of them, which is the whole reason it is not a headline.
    const { reading } = readingOf(MIXED);
    expect(reading.ceilingBlindBytes).not.toBe(reading.floorBlindBytes);
    // EACH END AS A CONDITION. "reading git's record as it stands" made the
    // reader reconstruct what that record's silence implies before either
    // number meant anything; two `if` clauses in one grammar are comparable
    // down the column, which is what the aligned shares are for.
    expect(flat(text)).toContain(
      `${floorText(MIXED)} if no pull request here was ever reviewed in depth`,
    );
    expect(flat(text)).toContain(
      `${ceilingText(MIXED)} if every pull request was reviewed in depth`,
    );
  });

  it("says git cannot settle it, and calls that a gap rather than a margin", () => {
    expect(flat(text)).toContain(
      "git cannot say which. That is the gap, not a margin of error.",
    );
  });

  it("NEVER says the truth sits between them", () => {
    // The tempting phrasing, and it is testably wrong in one direction: a
    // squash-merged pull request leaves nothing in the commit graph, so the
    // ceiling cannot credit a review that happened and the hosted number for a
    // repository like hono lands OUTSIDE the interval. "Between" would sound
    // like humility while claiming a distribution nobody here has measured.
    for (const rendered of [text, card(SQUASH_ONLY), card(PROMPTED_ONLY)]) {
      expect(flat(rendered)).not.toMatch(/\b(sits|lies|falls|somewhere)\b[^.]{0,40}\bbetween\b/i);
      expect(flat(rendered)).not.toMatch(
        /\b(truth|answer|real number|reality)\b[^.]{0,40}\bbetween\b/i,
      );
    }
  });

  it("states the zero-width case as a fact, rather than printing one number twice", () => {
    const { reading } = readingOf(PROMPTED_ONLY);
    expect(reading.ceilingBlindBytes).toBe(reading.floorBlindBytes);
    expect(flat(card(PROMPTED_ONLY))).toContain(
      `${floorText(PROMPTED_ONLY)} here, and it is exact: nothing counted as debt ever ` +
        `went through a pull request, so no review credit could lower it.`,
    );
  });

  it("keeps the headline and the interval visibly different quantities", () => {
    // The card's one arithmetic trap, and the reason the two live in different
    // blocks: `PROMPTED_ONLY` is 0% dark and 100% in debt, both true and about
    // different things. Rendering them at the same size with the same word
    // beside them is exactly what 1.5.0 stopped doing.
    const { reading } = readingOf(PROMPTED_ONLY);
    expect(reading.darkBytes).toBe(0);
    expect(reading.floorBlindBytes).toBe(reading.scoredBytes);
    expect(darkText(PROMPTED_ONLY)).not.toBe(floorText(PROMPTED_ONLY));
  });
});

describe("one denominator", () => {
  it("the groups, the coda and the headline are shares of the same bytes", () => {
    const { reading } = readingOf(MIXED);
    const structure = ledger(MIXED);
    const groupBytes = structure.groups.reduce((sum, group) => sum + group.group.bytes, 0);
    const litBytes = (structure.lit as NonNullable<Ledger["lit"]>).group.bytes;
    expect(groupBytes).toBe(reading.darkBytes);
    expect(groupBytes + litBytes).toBe(reading.scoredBytes);
  });

  it("the mini-map's shares are shares of that same denominator", () => {
    const { reading } = readingOf(MIXED);
    const bytes = miniMapRows(reading).reduce((sum, row) => sum + row.bytes, 0);
    expect(bytes).toBe(reading.scoredBytes);
    // And the headline's own share, formatted the one way this product formats
    // a share, appears on the card exactly as computed here.
    expect(card()).toContain(darkText(MIXED));
  });
});

describe("WHERE names its own encodings", () => {
  it("says what the bar and the block each mean, in the headline's own direction", () => {
    const text = card();
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.includes("WHERE"));
    const [heading, key] = [lines[at], lines[at + 1]];

    // The heading names the block rather than gesturing at it: "WHERE" alone is
    // a question word with no object.
    expect(heading).toContain("WHERE THE DARK CODE IS");
    expect(heading).toContain("bar length = share of this repository");

    // A stacked bar needs its two cells named, and named in the quantity the
    // number above and the section below both select on — which is what makes
    // the key checkable against each row's own clause.
    expect(key).toContain("= gone dark");
    expect(key).toContain("= a human wrote or prompted it recently");
    for (const line of [heading, key]) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("still draws a row per top-level directory under it", () => {
    const text = card();
    const rows = text.slice(at(text, "WHERE"));
    expect(rows).toMatch(/\n {2}components\/ {2}/);
  });

  it("closes each row with how much of THAT directory is dark", () => {
    // The bar and the percentage beside it are shares of the repository; this
    // is a share of the folder, and it is the question somebody who owns
    // `workers/` actually has.
    const rows = card()
      .split("\n")
      .filter((line) => /^ {2}\S+\/ /.test(line));
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) expect(row).toMatch(/ \. (\d+|<1|>99)% dark$/);
  });

  it("reads the clause off the same predicate the section below selects on", () => {
    const { reading } = readingOf(MIXED);
    const workers = reading.files.filter((file) => file.path.startsWith("workers/"));
    // Every file in `workers/` was hand-touched inside the window, so the row
    // must say so rather than inheriting the repository's own share.
    expect(workers.every((file) => !isDark(file))).toBe(true);
    const row = card()
      .split("\n")
      .find((line) => line.includes("workers/")) as string;
    expect(row).toContain("0% dark");
  });
});

describe("the long forms stay off the card", () => {
  it("asserts no review git cannot see, quotes no factor value, names no hosted concept", () => {
    const text = card();
    expect(text).not.toContain("of the scored bytes");
    expect(text).not.toContain("explain-back");
    expect(text).not.toMatch(/never (substantively )?reviewed/);
    expect(text).not.toContain("quarter of one engaged person");
  });

  it("says `1 human in its history`, never `bus factor`", () => {
    // The count is the same and the sentence is not. "Bus factor" is a claim
    // about an organisation — who it can afford to lose — and this reading has
    // no view of who still works here. What git carries is who appears in the
    // history. The FACTOR keeps its name inside `explain`, where it sits beside
    // its weight and its contribution.
    const text = card(FOUR_DARK, {}, term({ columns: 100 }));
    expect(text).toContain("1 human in its history");
    expect(text).not.toContain("bus factor");
  });
});

describe("the hero line", () => {
  const text = card();

  it("names one file before the card abstracts again", () => {
    const first = ledger(MIXED).rows[0];
    expect(flat(text)).toContain(`start here: ${first.path} .`);
  });

  it("sits between the sentence and the map, where the reader still has nothing to open", () => {
    expect(at(text, "has gone dark:")).toBeLessThan(at(text, "start here:"));
    expect(at(text, "start here:")).toBeLessThan(at(text, "WHERE"));
  });

  it("prints the basis for the advice right beside it", () => {
    // "start here" is a RECOMMENDATION, and a recommendation cannot be false —
    // what stops it being empty is that everything it rests on is on the line
    // with it: the last human contact and how many humans are in the file's
    // history. A reader who disagrees can see what produced it.
    //
    // The clause is taken off the SECTION'S OWN ROW rather than rebuilt here,
    // so this also pins that the two agree: a hero line explaining the file
    // differently from the row it points at would be two readings of one file.
    const first = ledger(MIXED).rows[0];
    const row = printedRows(text, MIXED)[0];
    const clause = row.slice(row.indexOf(first.path) + first.path.length).trim();
    expect(clause).not.toBe("");
    expect(flat(text).slice(flat(text).indexOf("start here:"))).toContain(clause);
  });

  it("carries no score, exactly like the row it lifts", () => {
    // It used to open with `0.08`. The score left the rows at 1.5.0 (see
    // `./below`), and a hero that kept it would be the one file on the card
    // wearing a number the section under it no longer prints.
    const line = flat(text).slice(
      flat(text).indexOf("start here:"),
      flat(text).indexOf("exactly one human"),
    );
    expect(line).not.toMatch(/0\.\d\d/);
  });

  it("names the SAME file the section's first row and the nudge name", () => {
    // The one invariant the line has to keep: a reader who scrolls down finds
    // the path where the top of the card said it would be.
    const first = ledger(MIXED).rows[0];
    expect(text).toContain(`factor by factor: fathohm explain ${first.path}`);
    expect(printedRows(text, MIXED)[0]).toContain(first.path);
  });

  it("makes no superlative the ordering cannot back", () => {
    // Row one is the biggest APPLICATION file of the biggest GROUP, which is
    // not the same thing as the biggest dark file. An imperative cannot be
    // false; a superlative here would be, on most repositories.
    expect(text).not.toContain("largest blind spot");
    expect(text).not.toContain("biggest blind spot");
  });

  it("is absent when nothing has gone dark", () => {
    expect(card(ALL_LIT)).not.toContain("start here");
  });
});

/**
 * GONE DARK — the ledger.
 *
 * ── WHAT WAS DELETED FROM THIS DESCRIBE AT 1.5.0, AND WHY ───────────────────
 *
 * THE LEVERAGE LINE and its four tests. It closed the section with "a recorded,
 * commented review of the 5 files above re-scores this repo 72% -> 7%", and the
 * tests here asserted that it named both ends of the recomputation, that it
 * said the figure was recomputed rather than estimated, that it was the last
 * line of the section, and that it went silent when the printed numbers did not
 * move (the `SLIVER` fixture, deleted with them — it existed only to make a
 * five-file review round to nothing).
 *
 * They are gone because the PROPERTY is gone, not because they were awkward to
 * re-point. A review cannot make a file lit. `human_author_recency` is a fact
 * about who AUTHORED the file and when, so no amount of reading it moves the
 * number this card now prints — the line would have closed a list of dark files
 * by recommending an action that provably cannot move its own headline, which
 * is the most expensive kind of wrong: the kind a reader only discovers after
 * doing the work. The counterfactual itself is not lost. It still exists in
 * `fathohm paydown`, where the number being moved is the one it actually moves,
 * and `reviewedBlindShare` is still tested in `ledger.test.ts`.
 *
 * A second deletion, smaller: the tests that asserted a row said `no PR record`
 * or `review unrecorded`. Both clauses were true and both described a review
 * record that is neither this section's predicate nor anything that could
 * change it. A test now asserts their ABSENCE instead.
 */
describe("GONE DARK — the ledger", () => {
  const text = card();

  it("names the window it selects on, from the scorer's own constant", () => {
    expect(text).toContain(LEDGER_HEAD);
  });

  it("states the row rule on its own line, under the head", () => {
    expect(text).toContain("application code first . config, sql, scripts . then tests & styles");
  });

  it("keeps the head on one line, inside eighty columns", () => {
    // A wrapped section head is a ruined screenshot, and this one carries two
    // lines precisely because three clauses do not fit on one.
    const head = text.split("\n").filter((line) => line.includes(LEDGER_HEAD));
    expect(head).toHaveLength(1);
    for (const line of head) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("prints one heading per dark group, in the ledger's own order", () => {
    const structure = ledger(FOUR_DARK);
    const wide = card(FOUR_DARK, {}, term({ columns: 100 }));
    const positions = structure.groups.map((group) => section(wide).indexOf(heading(group)));
    expect(positions.length).toBeGreaterThan(1);
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("draws its headings from `darkLedgerLine`, never a third phrasing", () => {
    // `cli/src/reading/dark.ts` owns the vocabulary and borrows its clauses from
    // `lib/reading-explained` in turn. A heading composed here would be a third
    // description of one partition — which is exactly how the dashboard and the
    // CLI once described the same buckets in two different sets of words.
    for (const group of ledger(MIXED).groups) expect(text).toContain(heading(group));
    expect(flat(text)).toContain(coda(ledger(MIXED)));
  });

  it("puts each file under the heading that describes it", () => {
    const wide = card(FOUR_DARK, {}, term({ columns: 100 }));
    const structure = ledger(FOUR_DARK);
    const body = section(wide);
    for (const group of structure.groups) {
      const mine = heading(group);
      const after = body.slice(body.indexOf(mine) + mine.length);
      const others = structure.groups
        .filter((other) => heading(other) !== mine)
        .map((other) => after.indexOf(heading(other)))
        .filter((index) => index > -1);
      const block = after.slice(0, others.length === 0 ? undefined : Math.min(...others));
      for (const file of group.files.slice(0, group.rowCount)) {
        expect(block, `${file.path} is not under ${mine}`).toContain(file.path);
      }
    }
  });

  it("prints five rows in total, spread across the groups by the allocator", () => {
    expect(printedRows(text, MIXED)).toHaveLength(5);
    // And on a repository with more than one dark group, every group that the
    // largest-remainder allocator fed really does print its rows.
    const wide = term({ columns: 100 });
    const structure = ledger(FOUR_DARK);
    expect(structure.groups.filter((group) => group.rowCount > 0).length).toBeGreaterThan(1);
    expect(printedRows(card(FOUR_DARK, {}, wide), FOUR_DARK, wide)).toHaveLength(
      structure.rows.length,
    );
  });

  it("prints a nonzero group's heading even when it got no rows — in lower case", () => {
    // The heading is the finding; the rows are evidence for it. A group that
    // vanished because it was small would be the decomposition losing a term.
    // Upper case is the card's promise that rows follow, so a starved group
    // states itself in lower case instead — as a complete sentence about a
    // share, which is how the coda already renders the one group that never
    // lists rows.
    const structure = ledger(TINY_SECOND_GROUP);
    const starved = structure.groups.find((group) => group.rowCount === 0);
    expect(starved, "no group was starved of rows").toBeDefined();
    const small = starved as Ledger["groups"][number];
    expect(small.group.bytes).toBeGreaterThan(0);

    const rendered = card(TINY_SECOND_GROUP);
    for (const group of structure.groups) expect(rendered).toContain(heading(group));
    expect(rendered).not.toContain(heading(small).toUpperCase());
    // And it is a heading with nothing under it, not a heading with a stray row.
    expect(printedRows(rendered, TINY_SECOND_GROUP)).toHaveLength(5);
  });

  it("PRINTS A LEDGER THAT ADDS UP — the group shares and the coda make a hundred", () => {
    // The assertion on the rendered TEXT, not on the data structure: this is
    // what a reader with a calculator is going to check, and a decomposition
    // that does not sum in a screenshot refutes the whole precision bar.
    const structure = ledger(MIXED);
    const printed = structure.groups.map((group) => group.printed);
    const lit = (structure.lit as NonNullable<Ledger["lit"]>).printed;
    for (const share of [...printed, lit]) expect(text).toContain(share);
    const units = (share: string): number => Number.parseInt(share.replace(/[%<>]/g, ""), 10);
    expect(printed.reduce((sum, share) => sum + units(share), 0) + units(lit)).toBe(100);
    // And the dark side of that sum is the headline itself — the ledger
    // decomposes the number the card prints, not a neighbouring one.
    expect(printed.reduce((sum, share) => sum + units(share), 0)).toBe(units(darkText(MIXED)));
  });

  it("closes the arithmetic with the lit coda", () => {
    expect(flat(text)).toContain(coda(ledger(MIXED)));
    expect(at(text, "still lit --")).toBeGreaterThan(-1);
  });

  it("folds the rest into one line that names the flag", () => {
    const rendered = card(TINY_SECOND_GROUP);
    expect(rendered).toContain(
      `${darkOf(TINY_SECOND_GROUP).length - 5} more gone dark: fathohm read --full`,
    );
  });

  it("omits the fold line when the whole list fits", () => {
    const dark = darkOf(FOUR_DARK);
    expect(dark.length).toBeGreaterThan(0);
    expect(dark.length).toBeLessThanOrEqual(5);
    const rendered = card(FOUR_DARK, {}, term({ columns: 100 }));
    expect(rendered).toContain(LEDGER_HEAD);
    expect(rendered).not.toContain("more gone dark");
  });

  it("points at the decomposition behind the row the reader is looking at", () => {
    expect(text).toContain(`factor by factor: fathohm explain ${ledger(MIXED).rows[0].path}`);
  });

  it("carries the FULL path, so the command runs as printed", () => {
    // A command a reader has to repair before it runs is worse than none. The
    // path column beside it may be cut; this line never is — it wraps instead.
    const narrow = card(LONG_NAMES);
    const first = ledger(LONG_NAMES).rows[0];
    expect(first.path.length).toBeGreaterThan(40);
    expect(flat(narrow)).toContain(`factor by factor: fathohm explain ${first.path}`);
    expect(narrow).not.toContain("fathohm explain ...");
    expect(narrow).not.toContain("fathohm explain …");
  });

  it("appears with the list even when there is nothing to fold", () => {
    const rendered = card(FOUR_DARK, {}, term({ columns: 100 }));
    expect(rendered).not.toContain("more gone dark");
    expect(rendered).toContain("factor by factor: fathohm explain");
  });

  it("PUTS NO SCORE AND NO REVIEW CLAIM ON A ROW", () => {
    // Both left at 1.5.0 and both would be a defect if they came back. A
    // comprehension-debt score in the first column of a file selected for going
    // dark reads as the REASON it is listed, and it is not — the two quantities
    // do not even correlate across the gallery. "no PR record" and "review
    // unrecorded" are true sentences about a record this section does not
    // select on, so on these rows they are answers to a question nobody asked.
    for (const [fixture, columns] of [
      [MIXED, 80],
      [FOUR_DARK, 100],
      [KINDS_BELOW, 100],
    ] as const) {
      const body = section(card(fixture, {}, term({ columns })));
      expect(body).not.toContain("no PR record");
      expect(body).not.toContain("review unrecorded");
      const rows = printedRows(card(fixture, {}, term({ columns })), fixture, term({ columns }));
      // A score back in the first column would stop the rows matching the
      // bodies `./below` laid out, and an empty list would pass every
      // assertion under it. So the count is checked first.
      expect(rows.length, "no rows to check").toBeGreaterThan(0);
      for (const row of rows) {
        expect(row, row).not.toMatch(/^ {2}0\.\d\d/);
        expect(row, row).not.toMatch(/\b0\.\d\d\b/);
      }
    }
  });

  it("says nothing at all when nothing has gone dark", () => {
    // A section header over an empty list reads as a rendering bug, and on this
    // card it would read as "we could not work it out".
    const { reading } = readingOf(ALL_LIT);
    expect(reading.darkBytes).toBe(0);
    const rendered = card(ALL_LIT);
    expect(rendered).not.toContain(LEDGER_HEAD);
    expect(rendered).not.toContain("more gone dark");
    expect(rendered).not.toContain("factor by factor");
  });
});

/**
 * THE CARD'S ONE COLOUR SCALE, now encoding DARK.
 *
 * Every assertion here compares against a COMPUTED code (`depthColor` of a
 * value the ledger or the mini-map already carries), never against a literal
 * escape. A test that pinned `38;5;167` would answer "did this change?" and
 * never "is this the right end of the ramp" — which is exactly how a green test
 * once hid an unreadable ink.
 *
 * `depthColor` takes the LIT fraction, so a wholly dark thing arrives as 0 and
 * draws at the alarming pole. That is why a dark group and the lit coda are the
 * two ENDS of the scale rather than two points on it: the words already say why
 * each group is dark, and what the colour adds is the one thing words cannot
 * show at a glance — where the column stops being about dark code.
 */
describe("colour is the dark share, everywhere it appears", () => {
  const ESC = String.fromCharCode(27);
  // Built rather than written as a literal: an escape inside a regex literal is
  // what `no-control-regex` exists to catch.
  const ansi = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
  const strip = (line: string): string => line.replace(ansi, "");
  const opens = (code: number): string => `${ESC}[38;5;${code}m`;

  function lines(fixture: ExtractFixture, shared: Term): string[] {
    const { reading, tide } = readingOf(fixture);
    return renderCard(reading, tide, shared, meta());
  }

  /** The one rendered line whose VISIBLE text carries `text`. */
  function lineWith(rendered: readonly string[], text: string): string {
    const found = rendered.filter((line) => strip(line).includes(text));
    expect(found, `no single line reads "${text}"`).toHaveLength(1);
    return found[0];
  }

  const painted = (columns = 80): Parameters<typeof createTerm>[0] => ({
    noColor: false,
    env: { FORCE_COLOR: "1" },
    columns,
  });

  const colored = lines(MIXED, term(painted()));
  // Whichever ground a plain `createTerm` resolves to. The assertions below are
  // about the ENDS of the scale and their direction, never about which table
  // drew them, so they read the ground off the same handle the card used rather
  // than naming one — that is what keeps them true if the default ever moves.
  const GROUND = term(painted()).ground;
  const structure = ledger(MIXED);
  const lit = structure.lit as NonNullable<Ledger["lit"]>;
  // The coda wraps at eighty columns, and `term.color` paints each wrapped line
  // separately — so the line to look for is its opening words, taken off the
  // shared vocabulary rather than retyped here.
  const codaLead = coda(structure).split(" ").slice(0, 3).join(" ");

  it("has two poles at all, and they are not the same colour", () => {
    // The premise everything below rests on. A ramp that returned one code for
    // both ends would make every assertion here vacuously true.
    expect(depthColor(0, GROUND)).not.toBe(depthColor(1, GROUND));
  });

  it("paints every dark group at the pole a lit fraction of zero gives", () => {
    const wide = lines(FOUR_DARK, term(painted(100)));
    const groups = ledger(FOUR_DARK).groups;
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      // A dark group holds no lit bytes BY CONSTRUCTION — that is what the
      // predicate means — so the colour is not a per-group judgement, it is the
      // one end of the scale, computed rather than written as a constant.
      expect(group.score, heading(group)).toBe(0);
      expect(lineWith(wide, heading(group).split(" ")[0]), heading(group)).toContain(
        opens(depthColor(group.score, GROUND)),
      );
    }
  });

  it("paints the coda at the other pole, because a human's hand is on it", () => {
    expect(lit.score).toBe(1);
    expect(lineWith(colored, codaLead)).toContain(opens(depthColor(lit.score, GROUND)));
  });

  it("never paints the lit coda deeper than a dark group", () => {
    // The DIRECTION, which is the only thing the encoding can promise. Asserted
    // on the ramp's own stop index rather than on the hue, so a retuned palette
    // that kept the direction keeps this test green.
    const stop = (score: number): number =>
      (DIVERGING as readonly string[]).indexOf(scoreColor(score));
    for (const group of structure.groups) {
      expect(lit.score, heading(group)).toBeGreaterThan(group.score);
      expect(stop(lit.score), heading(group)).toBeGreaterThan(stop(group.score));
    }
  });

  it("paints each mini-map bar in the two poles its key names", () => {
    const rows = miniMapRows(readingOf(MIXED).reading);
    // The map's lines are the ones under the heading and its key, taken in
    // order rather than found by name: `app/` is a substring of the
    // `app/layout.tsx` row fifteen lines further down, and a search would paint
    // the wrong line.
    const heading = colored.findIndex((line) => strip(line).includes("WHERE"));
    expect(heading).toBeGreaterThan(-1);

    // A stacked bar has two runs and therefore two colours, and they are the
    // ENDS of the ramp rather than a per-row blend: the solid run means "gone
    // dark" and the light run means "not", and a mid-ramp hue on either would
    // be a third value the key never named.
    const dark = opens(depthColor(0, GROUND));
    const lit = opens(depthColor(1, GROUND));
    let mixedRows = 0;
    for (const [index, row] of rows.entries()) {
      const line = colored[heading + 2 + index];
      expect(strip(line), row.name).toContain(row.name);
      expect(line, row.name).toContain(row.darkShare > 0 ? dark : lit);
      if (line.includes(dark) && line.includes(lit)) mixedRows += 1;
    }
    // Both poles actually appear across this map — otherwise the assertion
    // above would be satisfied by a chart drawn in one colour.
    expect(mixedRows).toBeGreaterThan(0);
  });

  it("gives a row no colour at all beyond its dim clause", () => {
    // Every dark row is dark to exactly the same degree, so a per-row hue would
    // be a scale with one value on it, which is decoration. The path is DATA
    // and stays plain; the clause is dim because it is the evidence for the
    // listing rather than a claim of its own.
    const bodies = new Set(darkRows(readingOf(MIXED).reading, term()).map((row) => row.body));
    const rows = colored.filter(
      (line) => strip(line).startsWith(INDENT) && bodies.has(strip(line).slice(INDENT.length)),
    );
    expect(rows).toHaveLength(structure.rows.length);
    for (const row of rows) {
      expect(row, row).not.toMatch(/\[38;5;/);
      expect(row, row).toContain(`${ESC}[2m`);
      // Nothing opens or closes inside the path, either.
      const first = structure.rows[0];
      if (strip(row).includes(first.path)) expect(row.split(first.path)).toHaveLength(2);
    }
  });

  it("sets the hero exactly as the row it lifts: labelled, plain path, dim clause", () => {
    // THE PARITY IS THE POINT. The hero is the GONE DARK section's first row
    // lifted, and that section prints its paths plain — it colours HEADINGS,
    // deliberately, so the one hue is not spent on a distinction the headings
    // already spell out. A painted path here would make one file read two ways
    // on one card. What the hero gets that the row does not is its LABEL: the
    // instruction is chrome, and chrome takes the structure ink.
    const line = lineWith(colored, "start here:");
    const first = structure.rows[0];
    expect(strip(line)).toContain(`start here: ${first.path} `);

    const at = line.indexOf(first.path);
    const before = line.slice(0, at);
    // The label is painted...
    expect(before).toContain(ESC);
    // ...and closed again before the path begins, so nothing bleeds onto it.
    expect(before.trimEnd().endsWith(`${ESC}[0m`)).toBe(true);
    expect(line).toContain(`${ESC}[2m`);

    // The row it duplicates prints the same path with no ink at all.
    const row = colored.find(
      (each) => each !== line && strip(each).trimStart().startsWith(first.path),
    );
    expect(row).toBeDefined();
    expect((row as string).slice(0, (row as string).indexOf(first.path))).not.toContain(ESC);
  });

  it("says all of it with escapes and none of it with them — colour off is the same card", () => {
    const plain = lines(MIXED, term());
    for (const line of [
      lineWith(plain, heading(structure.groups[0]).split(" ")[0]),
      lineWith(plain, codaLead),
      lineWith(plain, "start here:"),
    ]) {
      expect(line, `escape in: ${JSON.stringify(line)}`).not.toContain(ESC);
    }
    // And the whole card, stripped, is the whole card plain — the contract the
    // golden files rest on, restated where the change was made.
    expect(colored.map(strip)).toEqual(plain);
  });
});

describe("the ledger's tiers, inside a group", () => {
  const wide = term({ columns: 100 });
  const rendered = card(KINDS_BELOW, {}, wide);

  it("prints the two application files first, though they are the smallest", () => {
    // The 30KB stylesheet and the 22KB test are the biggest dark files; the 9KB
    // route and the 7KB worker are the smallest. The tiers are what put the
    // route on row one.
    expect(ledger(KINDS_BELOW).rows.map((file) => file.path)).toEqual([
      "app/api/route.ts",
      "workers/src/drain.ts",
      "supabase/migrations/20260719195925_remote_schema.sql",
      "scripts/seed.ts",
      "app/bridge.css",
    ]);
    const rows = printedRows(rendered, KINDS_BELOW, wide);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain("app/api/route.ts");
    expect(rows[4]).toContain("app/bridge.css");
  });

  it("puts the scaffolding between the application code and the styles", () => {
    const rows = section(rendered);
    expect(rows.indexOf("scripts/seed.ts")).toBeGreaterThan(rows.indexOf("workers/src/drain.ts"));
    expect(rows.indexOf("scripts/seed.ts")).toBeLessThan(rows.indexOf("app/bridge.css"));
  });

  it("keeps the demoted test on the list, one row past the cut", () => {
    // Demotion, never exclusion: the 22KB test is the sixth of six and the fold
    // line accounts for it rather than the card losing it.
    expect(ledger(KINDS_BELOW).order.map((file) => file.path)).toContain(
      "cli/src/extract.test.ts",
    );
    expect(rendered).toContain("1 more gone dark");
  });

  it("demotes without dropping: the counts and the denominator do not move", () => {
    const { reading } = readingOf(KINDS_BELOW);
    expect(reading.files).toHaveLength(6);
    expect(darkOf(KINDS_BELOW)).toHaveLength(6);
    expect(rendered).toContain("(6 code files)");
    expect(rendered).toContain("1 more gone dark: fathohm read --full");
  });

  it("needs no special case when every file is a declared kind", () => {
    const { reading } = readingOf(ALL_SET_ASIDE);
    expect(reading.files.every((file) => kindRank(file.path) > 0)).toBe(true);
    const allKinds = card(ALL_SET_ASIDE, {}, wide);
    expect(allKinds).toContain(LEDGER_HEAD);
    for (const file of reading.files) expect(allKinds).toContain(file.path);
    // Row one is the biggest of the FIRST occupied tier — the sql file, not the
    // bigger test above it. The fallback needs no special case; the tiers just
    // run out of application code before they run out of rows.
    expect(ledger(ALL_SET_ASIDE).rows[0].path).toBe("db/schema.sql");
    expect(allKinds).toContain("factor by factor: fathohm explain db/schema.sql");
  });
});

/**
 * A big prompted group and one orphaned file: twenty files nobody has touched
 * since long before the window, and a twenty-first that appears in the tree and
 * in no commit at all.
 *
 * The row budget goes entirely to the first group — the second is a thousandth
 * of the bytes — so the `never` heading prints with nothing under it, which is
 * the case that proves a small group cannot vanish from the ledger.
 */
const TINY_SECOND_GROUP: ExtractFixture = {
  tree: [
    ...Array.from({ length: 20 }, (_unused, index) => [`src/p${index}.ts`, 1000] as const),
    ["src/orphan.ts", 10],
  ],
  commits: [
    {
      daysAgo: 400,
      paths: Array.from({ length: 20 }, (_unused, index) => `src/p${index}.ts`),
      prompted: true,
    },
  ],
};

/**
 * One fixture per dark REASON, and the three of them in one tree so a single
 * card exercises every clause the section can print.
 *
 *   - `orphan.ts` is in the tree and in no commit: no contact of any kind.
 *   - `prompted.ts` was written with an agent by two people, 250 days ago.
 *   - `hand.ts` was hand-written by two people and squash-merged.
 *   - `solo.ts` has exactly one contributor.
 *
 * Every one of them is outside the window, so the card prints three groups —
 * which is what makes this the fixture the row allocator is watched on.
 */
const FOUR_DARK: ExtractFixture = {
  tree: [
    ["src/orphan.ts", 9000],
    ["src/prompted.ts", 8000],
    ["src/hand.ts", 7000],
    ["src/solo.ts", 6000],
  ],
  commits: [
    { daysAgo: 300, paths: ["src/prompted.ts"], author: ADA, prompted: true },
    { daysAgo: 250, paths: ["src/prompted.ts"], author: GRACE, prompted: true },
    { daysAgo: 240, paths: ["src/hand.ts"], author: ADA },
    { daysAgo: 230, paths: ["src/hand.ts"], author: GRACE, squashPr: 3 },
    { daysAgo: 220, paths: ["src/solo.ts"], author: ADA },
  ],
};

/**
 * Code files, committed, and not one byte between them — the third degenerate
 * state, and the one that is not obviously degenerate from the outside. Every
 * share on the card has `scoredBytes` underneath it, so this repository is a
 * division by zero wearing a normal-looking tree.
 */
const ALL_EMPTY: ExtractFixture = {
  tree: [["src/a.ts", 0], ["src/b.ts", 0]],
  commits: [{ daysAgo: 400, paths: ["src/a.ts", "src/b.ts"], author: ADA }],
};

/** Hand-written days ago by two people: nothing has faded, nothing is dark. */
const ALL_LIT: ExtractFixture = {
  tree: [["src/a.ts", 4000], ["src/b.ts", 3000]],
  commits: [
    { daysAgo: 3, paths: ["src/a.ts", "src/b.ts"], author: ADA },
    { daysAgo: 2, paths: ["src/a.ts", "src/b.ts"], author: GRACE },
  ],
};

describe("the why clauses are read off the file, not narrated", () => {
  const wide = term({ columns: 100 });
  const text = card(FOUR_DARK, {}, wide);
  const rowFor = (path: string): string =>
    text.split("\n").find((line) => line.includes(path)) as string;

  it("names no contact at all when there is none", () => {
    expect(rowFor("src/orphan.ts")).toContain("no human commits");
  });

  it("dates the last prompt when nobody has hand-written it", () => {
    expect(rowFor("src/prompted.ts")).toContain("prompted 250d ago");
  });

  it("dates the last hand touch whenever there is one", () => {
    expect(rowFor("src/hand.ts")).toContain("hand-written 230d ago");
    expect(rowFor("src/solo.ts")).toContain("hand-written 220d ago");
  });

  it("counts the humans in the history, and claims nothing about the org", () => {
    expect(rowFor("src/solo.ts")).toContain("1 human in its history");
    expect(text).not.toContain("bus factor");
  });

  it("reads the NEWEST contact — the one that would have kept the file lit", () => {
    // `hand.ts` was hand-written 240 days ago and again 230 days ago; the row
    // says 230. The age the card prints is the SMALLEST that is still true,
    // which is the same convention the group heading above it is built on, so a
    // row can never describe a different contact than the heading it sits under.
    expect(rowFor("src/hand.ts")).not.toContain("240d ago");
  });
});

describe("a bounded reading does not promise a complete one", () => {
  /**
   * The caption closes on WHY the number is exact, and that reason is an
   * invitation: "git records every commit's author and date" tells a reader to
   * go and check. On a shallow clone, a grafted history or a `--since` window,
   * the commits that would have kept a file lit may simply not be in the
   * reading — so the invitation points at a claim this reading was never in a
   * position to make. The share is still exact over what was read; the REASON
   * is a smaller reason, and the card says the smaller one.
   *
   * `--at <ref>` is deliberately not a bound: it moves the tree and the clock
   * together, so it is a complete reading of the past rather than a partial
   * reading of the present.
   */
  it("names the smaller reason on a shallow clone, and points at the note", () => {
    const text = flat(card(SHALLOW));
    expect(text).toContain("Exact over the commits this reading saw");
    expect(text).not.toContain("git records every commit's author and date");
    // The note it points at has to actually be on the card.
    expect(text).toContain("this clone is shallow");
  });

  it("keeps the full promise on an unbounded reading", () => {
    const text = flat(card(MIXED));
    expect(text).toContain("git records every commit's author and date");
    expect(text).not.toContain("which are not all of them");
  });

  it("is not vacuous: the two fixtures differ only in provenance", () => {
    // SHALLOW is MIXED with a flag. If they ever stop sharing a history the
    // pair above stops being a controlled comparison and starts being two
    // unrelated cards that happen to differ.
    const plain = readingOf(MIXED).reading;
    const shallow = readingOf(SHALLOW).reading;
    expect(shallow.darkBytes).toBe(plain.darkBytes);
    expect(shallow.provenance.shallow).toBe(true);
    expect(plain.provenance.shallow).toBe(false);
  });
});

describe("a simulated reading says so, in the sentence that invites checking", () => {
  /**
   * `fathohm read --without ada` scores the history with one person's
   * engagement removed. Until 2026-08-11 nothing on the card said so: the
   * header named the directory and the headline said "93% of this code has
   * gone dark: no human has written or prompted any of it in the last 180
   * days" — about a repository where `git log` says otherwise. The provenance
   * block only spoke up when a `--without` matched NOBODY, i.e. in the one case
   * where the reading had not changed.
   *
   * The caption closes with "git records every commit's author and date",
   * which is an explicit invitation to check. Inviting a reader to check a
   * sentence the simulation has already falsified is the worst copy this
   * product could print, so both the subject and the caption carry the
   * condition — and a screenshot of the number and its sentence, which is the
   * unit people actually share, carries it too.
   */
  const WITHOUT = "priya";

  function simulated(fixture = HANDOVER): string {
    const { reading, tide } = readingOf(fixture, { without: [WITHOUT] });
    return flat(renderCard(reading, tide, term(), meta()).join("\n"));
  }

  it("names the removal in the subject, in `offboard`'s own form", () => {
    // Two commands that simulate the same removal must not describe it two
    // ways: `renderOffboard`'s header has always read "…without priya
    // (simulated)".
    expect(simulated()).toContain(`without ${WITHOUT} (simulated)`);
  });

  it("makes the headline sentence conditional, not a claim about the repository", () => {
    const text = simulated();
    expect(text).toContain(`would have gone dark without ${WITHOUT}`);
    expect(text).toContain("nobody else has written or prompted any of it");
    // The unconditional form must not survive anywhere on a simulated card.
    expect(text).not.toContain("of this code has gone dark:");
  });

  it("proves the removal actually moved the number it is qualifying", () => {
    // Without this the test above passes on a card whose simulation changed
    // nothing, which is the vacuous version of the same assertion.
    const plain = readingOf(HANDOVER).reading;
    const off = readingOf(HANDOVER, { without: [WITHOUT] }).reading;
    expect(off.darkBytes).toBeGreaterThan(plain.darkBytes);
  });

  it("says nothing about a simulation when the name matched nobody", () => {
    // A `--without` that named nobody removed nothing, so the reading is NOT a
    // simulation and the header must not claim it is. That case has its own
    // provenance warning, which is where it belongs.
    const { reading, tide } = readingOf(HANDOVER, { without: ["nobody-by-that-name"] });
    const text = flat(renderCard(reading, tide, term(), meta()).join("\n"));
    expect(text).not.toContain("(simulated)");
    expect(text).toContain("of this code has gone dark:");
    expect(text).toContain("matched nobody in this history");
  });
});

describe("how much of it rests on one person", () => {
  it("states the share of ALL the code with one human, and names the command", () => {
    // A second denominator, declared as one: the risk is not confined to what
    // is already dark — code with a single human in its history goes dark
    // exactly DARK_WINDOW_DAYS after that person stops committing, which is the
    // point of printing it at all and is arithmetic rather than a forecast
    // (recency decays to zero at the window, and nothing else can hold the file
    // up). It routes to `team` rather than `offboard` because `offboard`
    // requires a name, and a command a reader has to repair before it runs is
    // worse than no command.
    const { reading } = readingOf(MIXED);
    let bytes = 0;
    let files = 0;
    for (const file of reading.files) {
      const { full, prompted } = file.factors.engagement.contributors;
      if (full + prompted === 1) {
        bytes += file.bytes;
        files += 1;
      }
    }
    expect(files).toBeGreaterThan(0);
    const share = formatBlindShare(exactBlindShare(bytes, reading.scoredBytes));
    // THE COUNT LEADS. Written share-first, this line opened with the same six
    // words the ledger's group headings use — a different cut of the same
    // repository, on a card where the dark share and the lit share had just
    // added to 100. A reader has every reason to try to add the third number
    // in, and nothing on screen said not to. "9 of 12 files" cannot be added to
    // a byte share, which is exactly why it goes first.
    // "run" is asserted, not incidental. Without it the line ended
    // "Who they are: fathohm team", which parses as its own answer — as though
    // a stranger's contributors had been labelled "fathohm team". See the
    // sibling case below, which pins the property rather than this string.
    expect(flat(card())).toContain(
      `${files} of ${reading.files.length} files -- ${share} of the code -- have ` +
        `exactly one human in their history: when that person stops committing, ` +
        `nothing keeps the file lit. to see who they are: fathohm team`,
    );
  });

  it("points at the command as a command, never as an answer to its own question", () => {
    // The property, not the sentence: whatever the wording becomes, a bare
    // `fathohm team` may never sit directly after the colon of a question
    // about people. Every other pointer on this card carries a path or a flag
    // and reads as a command on sight; this one is two bare words following
    // "Who they are:", which is why it needed an imperative and the others did
    // not. A value assertion answers "did this change?", never "is it right?".
    const text = flat(card());
    expect(text).toMatch(/to see who they are: fathohm team/);
    // The two readings this line has already been reworded to escape.
    expect(text).not.toMatch(/Who they are: fathohm/);
    expect(text).not.toMatch(/Who they are, run:/);
    // And it owns a line. Wrapped into the tail of a three-line paragraph the
    // one runnable thing on the card broke wherever the measure happened to
    // fall, so it could land as a fragment mid-sentence.
    expect(card().split("\n")).toContain("  to see who they are: fathohm team");

    // ONE SHAPE FOR EVERY POINTER: `<what you get>: <command>`, the left side
    // lower-case so nothing on it can be read as a heading or an answer. This
    // line was the exception, which is why it needed an imperative the others
    // did not and why it has now been reworded twice. Asserted as the PROPERTY
    // over every pointer the card prints rather than as a list, so a new one
    // cannot arrive in a fourth grammar.
    const pointers = card(PROMPTED_DOMINANT)
      .split("\n")
      .filter((line) => line.includes(": fathohm "));
    // Not vacuous: this fixture prints the team route and the explain nudge.
    // (`N more gone dark: fathohm read --full` needs a longer ledger than any
    // fixture here has, and it is built by the same rule.)
    expect(pointers.length).toBe(2);
    for (const line of pointers) {
      expect(line, line).toMatch(/^ {2}[a-z0-9][^:]*: fathohm [a-z]/);
    }
  });

  it("states a deadline that has already passed as a condition, not as a future", () => {
    // The verb is the whole point. "it goes dark N days after they stop" is a
    // forecast, and for the single-keeper files that are ALREADY dark the
    // forecast describes somebody's past — the card promising a future that has
    // happened. "when that person stops committing" is true on both sides of
    // that line, which is the only form that can carry both cases at once.
    const text = flat(card());
    expect(text).toContain("when that person stops committing");
    expect(text).not.toMatch(/it goes dark \d+ days after they stop/);
  });

  it("is SUPPRESSED when no file has exactly one human in its history", () => {
    // "0% of this code has one human in its history" is a true sentence about a
    // repository where the line has nothing to say.
    const { reading } = readingOf(ALL_LIT);
    const solo = reading.files.filter((file) => {
      const { full, prompted } = file.factors.engagement.contributors;
      return full + prompted === 1;
    });
    expect(solo).toHaveLength(0);
    expect(card(ALL_LIT)).not.toContain("one human in their history");
  });
});

describe("degenerate repositories never show a percentage", () => {
  for (const [name, fixture] of [
    ["an empty repository", EMPTY],
    ["a tree with no code in it", NON_CODE],
    ["a tree whose code files are all empty", ALL_EMPTY],
  ] as const) {
    it(`${name} reads "nothing to fathom here yet"`, () => {
      const { reading } = readingOf(fixture);
      expect(isDegenerate(reading)).toBe(true);
      const text = card(fixture);
      expect(text).toContain("nothing to fathom here yet");
      expect(text).not.toMatch(/%/);
      expect(text).not.toContain("TREND");
      // No digits and no pitch on a reading that saw nothing.
      expect(text).not.toContain("####");
      expect(text).not.toContain("https://");
    });
  }

  it("still carries the permanent provenance line", () => {
    expect(flat(card(EMPTY))).toContain("authorship is declared, not detected: undeclared agent work reads as human.");
  });
});

describe("--quiet", () => {
  const text = card(MIXED, { quiet: true });

  it("is ONE line carrying both numbers: the dark share and the debt interval", () => {
    // A machine's view, or a second run in a terminal that already saw the
    // first. Both quantities, because a caller that only got the headline would
    // have to run the card again to learn the thing the card is careful about.
    const { reading } = readingOf(MIXED);
    const debt = formatInterval(
      reading.ceilingBlindBytes / reading.scoredBytes,
      reading.floorBlindBytes / reading.scoredBytes,
      term(),
    );
    expect(text).toContain(`${darkText(MIXED)} gone dark . comprehension debt ${debt}`);
    expect(text.split("\n").filter((line) => line.includes("gone dark"))).toHaveLength(1);
  });

  it("keeps the header and the provenance around it", () => {
    expect(text).toContain("FATHOHM");
    expect(flat(text)).toContain("authorship is declared, not detected: undeclared agent work reads as human.");
  });

  it("drops the digits, the map, the ledger, the trend and the pitch", () => {
    expect(text).not.toContain("####");
    expect(text).not.toContain("has gone dark:");
    expect(text).not.toContain("WHERE");
    expect(text).not.toContain(LEDGER_HEAD);
    // Both of the section's pointers go with it. `--quiet` is a machine's
    // view; a suggestion to run another command is the opposite of quiet.
    expect(text).not.toContain("more gone dark");
    expect(text).not.toContain("factor by factor");
    expect(text).not.toContain("TREND");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("no telemetry, no network");
  });

  it("prints one debt number when the interval is a point", () => {
    expect(card(PROMPTED_ONLY, { quiet: true })).toContain(
      `${darkText(PROMPTED_ONLY)} gone dark . comprehension debt ${floorText(PROMPTED_ONLY)}`,
    );
  });
});

describe("the closing pitch", () => {
  const text = card();

  it("carries the TREND strip INSIDE the debt block, under the heading that names it", () => {
    // The strip plots the comprehension-debt INTERVAL over time. It used to sit
    // above this block, so a reader met "today: 24% - 72%" a dozen lines after
    // a headline of 45%, with nothing on screen to say they were different
    // quantities. Two unexplained numbers in one card is the exact confusion
    // this release exists to remove.
    expect(at(text, "COMPREHENSION DEBT")).toBeLessThan(at(text, "TREND"));
    expect(at(text, "TREND")).toBeLessThan(at(text, "git does not record PR reviews"));
  });

  it("names the mechanism and what it settles, in two lines and no feature list", () => {
    // The first clause is load-bearing: this block has just refused to say
    // which of the two readings is right, and this names the thing that
    // settles it. The three ticked bullets under it ("weekly digest",
    // "per-member view") were a landing page's grammar in a terminal — an
    // advertisement closing a reading that had spent forty lines earning trust.
    expect(flat(text)).toContain(
      "git does not record PR reviews. The GitHub App reads them and settles which reading " +
        "is right -- https://fathohm.dev",
    );
    for (const cut of ["weekly digest", "per-member view", "review depth per file"]) {
      expect(flat(text), cut).not.toContain(cut);
    }
  });

  it("says the same thing whether or not there is a spread", () => {
    // The pitch used to quantify itself ("collapses 24% - 72% to one number"),
    // which was a sentence about the headline when the headline WAS that
    // interval. On a repository whose two readings agree there is no spread to
    // collapse, and the sentence has to hold anyway.
    const { reading } = readingOf(PROMPTED_ONLY);
    expect(reading.ceilingBlindBytes).toBe(reading.floorBlindBytes);
    expect(flat(card(PROMPTED_ONLY))).toContain(
      "The GitHub App reads them and settles which reading is right",
    );
    expect(text).not.toContain("collapses");
  });

  it("ends on the two properties and the experiment, not on a proof claim", () => {
    // "zero network calls (there is a test that proves it)" lost the pedantry
    // argument twice: a test demonstrates rather than proves, and the npx that
    // launched the reading fetched a package first. The line that replaced it
    // makes only checkable statements.
    const lines = text.split("\n");
    expect(lines[lines.length - 1]).toContain("Verify by running it offline");
    expect(text).toContain("no telemetry, no network");
    expect(text).not.toContain("zero network calls");
    expect(text).not.toContain("proves it");
  });
});

describe("--full", () => {
  it("lists every dark path, largest bytes first", () => {
    const dark = darkOf(MIXED);
    const text = card(MIXED, { full: true });
    expect(text).toContain(`gone dark, largest first (${dark.length} files`);
    for (const file of dark) expect(text).toContain(file.path);

    // Bytes are the headline's own weighting, so the top of this list is the
    // top of the number; path breaks the tie, so two runs of the same
    // repository list the same files in the same order.
    const listing = text.slice(at(text, "gone dark, largest first"));
    const positions = [...dark]
      .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1))
      .map((file) => listing.indexOf(file.path));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("KEEPS the score column — the one place on the card it survives", () => {
    // It left the default rows because a debt score beside a file selected for
    // going dark reads as the reason it is listed. A reader who asked for the
    // long form is past that risk and the number is useful to them, which is
    // also what keeps "the score is off the row, not out of the tool" true.
    const listing = card(MIXED, { full: true }).slice(
      at(card(MIXED, { full: true }), "gone dark, largest first"),
    );
    for (const file of darkOf(MIXED)) {
      const row = listing.split("\n").find((line) => line.includes(file.path)) as string;
      expect(row, file.path).toContain(file.floor.toFixed(3));
    }
  });

  it("is absent by default", () => {
    expect(card()).not.toContain("gone dark, largest first");
  });
});

describe("provenance", () => {
  it("raises a loud, unquantified banner on a truncated history", () => {
    const text = card(SHALLOW);
    expect(text).toContain("PARTIAL READING");
    expect(text).toContain("this clone is shallow");
    // Emphatically NOT "you are seeing 40% of the history": the part that was
    // never fetched is the part that cannot be measured.
    const banner = text.slice(text.indexOf("PARTIAL READING"));
    expect(banner.split("\n").slice(0, 4).join("\n")).not.toMatch(/%/);
  });

  it("says when the ceiling rests on subject lines alone", () => {
    expect(card(SQUASH_ONLY)).toContain("the ceiling rests on subject lines");
  });

  it("warns when a --without matched nobody, so silence is never mistaken for safety", () => {
    const { reading, tide } = readingOf(MIXED, { without: ["nobody@example.dev"] });
    const text = renderCard(reading, tide, term(), meta()).join("\n");
    expect(text).toContain('--without "nobody@example.dev" matched nobody');
  });

  it("says nothing about --without when it matched somebody", () => {
    const { reading, tide } = readingOf(MIXED, { without: ["ada@example.dev"] });
    const text = renderCard(reading, tide, term(), meta()).join("\n");
    expect(text).not.toContain("matched nobody");
  });

  it("names submodules as passed over, rather than silently under-reporting", () => {
    const { reading, tide } = readingOf({ ...MIXED, provenance: { submodulesSkipped: 2 } });
    const text = renderCard(reading, tide, term(), meta()).join("\n");
    expect(text).toContain("2 submodules were passed over");
  });

  it("records the window and the ref when the reading was bounded", () => {
    const { reading, tide } = readingOf({
      ...MIXED,
      provenance: { sinceBound: "2026-01-01T00:00:00Z", atRef: "v1.2.0" },
    });
    const text = renderCard(reading, tide, term(), meta()).join("\n");
    expect(text).toContain("window: since 2026-01-01");
    expect(text).toContain("read as of v1.2.0");
  });
});

function reverse(text: string): string {
  return [...text].reverse().join("");
}
