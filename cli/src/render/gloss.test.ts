import { describe, expect, it } from "vitest";

import { DEBT_GLOSS, LINE_GLOSS } from "../../../lib/reading-explained";
import {
  ALL_SET_ASIDE,
  HANDOVER,
  MIXED,
  PROMPTED_ONLY,
  SHALLOW,
  SQUASH_ONLY,
  offboardOf,
  paydownOf,
  readingOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { evaluateCheck } from "../reading/check";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import { renderCard } from "./card";
import { renderCheckMarkdown } from "./check";
import { renderMapNote, renderMapPage } from "./html-map";
import type { RenderMeta } from "./meta";
import { renderOffboard } from "./offboard";
import { renderPaydown } from "./paydown";

/**
 * THE TERM NEVER TRAVELS ALONE.
 *
 * "Comprehension line" is jargon. It is KEPT jargon — it is the category name,
 * it is what people search for after reading the essays, and retiring it would
 * cost the positioning that makes this product a category rather than a linter
 * stat. The standing rule is not that the term goes; it is that the plain
 * sentence is never more than a clause away from it.
 *
 * So this is a property over every rendered surface rather than a string
 * pinned in one golden: if a card says "comprehension line", that same card
 * says what the line means, in words a stranger can parse, with no tooltip and
 * no link. A golden proves one card said it once; this proves a new card
 * cannot forget to.
 *
 * The failure it exists to catch is real and already happened once: the
 * hosted sweep glossed the term everywhere behind the login and the CLI card —
 * the surface most people meet first — kept saying "scores below the
 * comprehension line" with nothing defining the line anywhere on screen.
 *
 * EVERY SURFACE, not just the read card. "Per surface" in the copy rule means
 * per thing a reader can meet on its own, and four of them name the term
 * without ever putting the reading card on screen: `offboard`, `paydown`, the
 * note `map` prints, and the HTML file `map` writes — which is the one that
 * gets kept and sent to somebody who never ran the command at all. A rule
 * enforced against one renderer is a rule the other four can quietly fail, and
 * all four of them did, for a whole release.
 *
 * TWO TERMS FROM 1.5.0, and the rule is the same for both. The reading card no
 * longer headlines a comprehension-debt share, so it no longer says
 * "comprehension line" — it names COMPREHENSION DEBT in its closing block
 * instead, which is a first prominent use on that surface and therefore owes
 * the canonical gloss. `offboard` and `paydown` still speak in lines. Whichever
 * term a surface reaches for, the definition of that term is on the same
 * screen: a rule that only covered the old word would have gone quietly
 * vacuous on the card the day the card changed, which is precisely the rot the
 * counting test below exists to catch.
 */

/**
 * A gloss as the card can actually contain it.
 *
 * Both glosses carry an em dash, and `prose()` folds that to `--` under
 * `--ascii`. Comparing the raw constant would therefore pass in one terminal
 * and fail in another for reasons that have nothing to do with the copy. So the
 * assertion is made on the CLAUSES either side of the dash: they are the
 * sentence's whole content, they cannot both survive a rewrite that guts the
 * definition, and they are glyph-independent.
 */
function clauses(gloss: string): string[] {
  return gloss
    .split("—")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Assert a surface that names a term also defines it, in either terminal. */
function expectGlossed(text: string, gloss: string): void {
  for (const clause of clauses(gloss)) {
    expect(text, `the surface names the term but never says what it means`).toContain(clause);
  }
}

/** The two terms a surface can reach for, each with the gloss it owes. */
const TERMS: Array<[term: string, gloss: string]> = [
  ["comprehension line", LINE_GLOSS],
  ["comprehension debt", DEBT_GLOSS],
];

function term(): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
}

function meta(): RenderMeta {
  return {
    target: "acme-api",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
  };
}

/** The card as one line of prose — `paragraph()` wraps mid-phrase, so a
 *  phrase assertion on raw lines tests the column, not the copy. */
function flat(lines: readonly string[]): string {
  return lines.join(" ").replace(/\s+/g, " ");
}

/**
 * Whether a surface names a term, ignoring case.
 *
 * The card sets its section heading in capitals and the gloss opens with a
 * capital, so a case-sensitive `includes("comprehension debt")` reports "this
 * card never names the term" about the very card that headlines it — which is
 * a rule that has gone vacuous while staying green. Typography is not the
 * subject; the word is.
 */
function names(text: string, term: string): boolean {
  return text.toLowerCase().includes(term);
}

/**
 * The written page as text: tags out, whitespace collapsed.
 *
 * The same job `flat()` does for a card. A gloss is emitted inside ONE element,
 * so stripping the markup cannot join a sentence that the page did not actually
 * carry — and it stops the assertion failing over an attribute that happens to
 * sit between two words.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const READ_FIXTURES: Array<[label: string, fixture: ExtractFixture]> = [
  ["a mixed repository", MIXED],
  ["a repository that is all prompted work", PROMPTED_ONLY],
  ["a shallow clone", SHALLOW],
  ["a squash-merge history", SQUASH_ONLY],
  ["a repository with everything set aside", ALL_SET_ASIDE],
  ["a handover", HANDOVER],
];

/**
 * EVERY OTHER SURFACE THAT NAMES A TERM — each rendered whole, exactly as the
 * reader meets it.
 *
 * One entry per thing somebody can see without seeing anything else: two
 * `offboard` branches (the degenerate one renders its own captions and is
 * therefore its own surface), the `paydown` ladder, the note `map` leaves in
 * the terminal, and the file `map` writes — which outlives the session and gets
 * opened by people who never ran the command.
 */
const OTHER_SURFACES: Array<[label: string, render: () => string]> = [
  [
    "offboard: a departure with a baseline",
    () =>
      flat(
        renderOffboard(offboardOf(HANDOVER, "priya", { without: ["sam"] }), term(), meta()),
      ),
  ],
  [
    "offboard: a name that matches nobody",
    () => flat(renderOffboard(offboardOf(HANDOVER, "pryia"), term(), meta())),
  ],
  ["paydown: a ladder", () => flat(renderPaydown(paydownOf(MIXED), term(), meta()))],
  [
    "paydown: a ladder with a baseline and a gate",
    () =>
      flat(
        renderPaydown(
          paydownOf(HANDOVER, { without: ["sam"], maxBlind: 40 }),
          term(),
          meta(),
        ),
      ),
  ],
  [
    "map: the note the terminal prints",
    () =>
      flat(
        renderMapNote(
          readingOf(MIXED).reading,
          "/tmp/fathohm-map.html",
          48_000,
          term(),
          meta(),
        ),
      ),
  ],
  ["map: the file it writes", () => stripTags(renderMapPage(readingOf(MIXED).reading, meta()))],
  [
    // The newest surface, and the one that travels furthest from the terminal
    // that made it: a `check --format markdown` verdict is pasted into a pull
    // request and read by people who never ran the command and may never have
    // seen a card. It names the term, so it owes the definition on its own
    // account — there is no card on the screen to borrow one from.
    "check: the pasteable verdict",
    () => {
      const { reading } = readingOf(MIXED);
      return flat(
        renderCheckMarkdown(
          reading,
          evaluateCheck(reading, { maxBlind: 10, pessimistic: false }),
          meta(),
        ),
      );
    },
  ],
];

describe("every card that names a term also defines it", () => {
  for (const [label, fixture] of READ_FIXTURES) {
    it(`read: ${label}`, () => {
      const { reading, tide } = readingOf(fixture);
      const text = flat(renderCard(reading, tide, term(), meta()));
      // A card that never says it owes nothing — a degenerate reading prints
      // neither term, and demanding a definition of it would be demanding
      // copy about a number that is not on the screen.
      for (const [name, gloss] of TERMS) {
        if (names(text, name)) expectGlossed(text, gloss);
      }
    });
  }

  for (const [label, render] of OTHER_SURFACES) {
    it(label, () => {
      const text = render();
      // NON-VACUITY, PER SURFACE. The rule is conditional — name the term, owe
      // the definition — so a surface that stops naming either term passes it
      // by saying nothing, which is exactly how this file went half-green
      // through 1.5.0. Every one of these headlines a comprehension-debt number
      // today; if one stops, somebody should have to look at why.
      const named = TERMS.filter(([name]) => names(text, name));
      expect(named.map(([name]) => name), "this surface names no term at all").not.toEqual([]);
      for (const [, gloss] of named) expectGlossed(text, gloss);
    });
  }

  it("actually exercised the rule — a suite that skipped every case proves nothing", () => {
    // The read cases above skip a card that names neither term, which is
    // correct and is exactly how this whole describe could rot into nine green
    // vacuous assertions. So: count them. Most fixtures render a full card, and
    // if that stops being true the number moves and somebody looks.
    //
    // COUNTED PER TERM, not per card, and that is the lesson 1.5.0 taught this
    // file: the old counter asked only how many cards said "comprehension
    // line", so when the card stopped saying it the counter went to zero and
    // reported a broken rule rather than a moved one. Either term keeps a card
    // in the count, and each term is required to be exercised somewhere.
    const named = new Map(TERMS.map(([name]) => [name, 0]));
    for (const [, fixture] of READ_FIXTURES) {
      const { reading, tide } = readingOf(fixture);
      const text = flat(renderCard(reading, tide, term(), meta()));
      for (const [name] of TERMS) {
        if (names(text, name)) named.set(name, (named.get(name) as number) + 1);
      }
    }
    expect(
      [...named.values()].reduce((sum, count) => sum + count, 0),
    ).toBeGreaterThanOrEqual(4);
    // "comprehension debt" is the reading card's own term from 1.5.0, so a
    // suite where no read card names it has stopped testing the card.
    expect(named.get("comprehension debt")).toBeGreaterThanOrEqual(4);
  });

  it("states the record, never a mind — the glosses themselves pass the copy bar", () => {
    // The sentences every surface inherits: if either ever became a claim about
    // what somebody understands, it would carry that claim to all of them at
    // once. Cheaper to assert here than to find later on four cards.
    for (const [, gloss] of TERMS) {
      expect(gloss).not.toMatch(/\bunderstand(s|ing)?\b/i);
      expect(gloss).toMatch(/written|reviewed|explained/);
    }
    // The second clause is what separates our definition from the published
    // one it is an instrument for: Osmani's turns on whether anybody "genuinely
    // understands" the code, which is unmeasurable. Losing this clause would
    // quietly give the term back its mind-claim.
    expect(DEBT_GLOSS).toContain("measured from the record, not a survey");
  });
});
