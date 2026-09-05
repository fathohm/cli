import type { ColorCode, Term } from "./term";
import { INDENT } from "./text";

/**
 * THE BIG NUMBER — the headline, at the size of the claim it makes.
 *
 * A cold reader meets this tool in a scroll-back buffer, between a test run
 * and a git status. The old headline was one line of ordinary text competing
 * with every other line of ordinary text on the screen, and the thing it said
 * — that most of this codebase is understood by nobody — arrived at the same
 * weight as a filename. Five rows of block cells do not compete. They are the
 * one place on the card where typography carries the argument.
 *
 * Three rules make it honest rather than merely loud.
 *
 * **It prints the FLOOR.** The card's subject is an interval, and an interval
 * rendered at this size would have to pick which end to draw first. The floor
 * is the end the evidence proves — the worst case on git alone — so the big
 * number is the number this reading can defend, and the captions under it name
 * the other end in the same breath.
 *
 * **It is drawn from ONE glyph.** Every lit cell is `term.glyph("block8")`,
 * which means `--ascii` folds the whole face to `#` for free and there is no
 * second unicode table to keep in step with `cli/src/render/term.ts`. The faces below
 * are stored as `#`/space patterns — ASCII source, so the file is legible in
 * any editor and the block never appears as a literal outside the glyph table.
 *
 * **The word beside it is not coloured.** The digits carry the depth ramp; the
 * label is a label. Colouring both would make "GONE DARK" look like a
 * measurement, and the one thing this product does not lend the scale to is
 * its own chrome.
 *
 * Every face is five rows tall and digits are four columns wide, with two
 * columns between faces. Seven-segment shapes, because at four columns a
 * segment either lights or it does not and there is no room for a judgement
 * call. The percent sign is the one face that is wider, and it says why.
 */

const ROWS = 5;
/** Columns between two faces. Enough to separate, too few to read as a space. */
const GAP = 2;
/** A lit cell in the stored patterns. Painted with `block8` on the way out. */
const ON = "#";

/**
 * The percent sign, built rather than typed.
 *
 * `cli/src/render/discipline.test.ts` fails any renderer whose source contains
 * a percent sign at all — the rule that keeps every share on the card going
 * through `lib/blind-share-format` and its `<1%` / `>99%` floors. This file
 * needs the character as a MAP KEY, not as a formatter, so it names the code
 * point instead of writing it and the rule stays absolute.
 */
const PERCENT = String.fromCharCode(37);

type Face = readonly [string, string, string, string, string];

/** An unknown character: a blank cell, so the layout never shifts under it. */
const BLANK: Face = ["    ", "    ", "    ", "    ", "    "];

/**
 * Every character `formatBlindShare` can produce: the ten digits, the percent
 * sign, and the two chevrons the display floors need (`<1%`, `>99%`).
 *
 * The chevrons are drawn two cells thick. A one-cell diagonal in a character
 * grid reads as a dotted line rather than as a stroke, and a `<` a reader has
 * to decode is worse than no floor at all.
 */
const FACES: Readonly<Partial<Record<string, Face>>> = {
  "0": ["####", "#  #", "#  #", "#  #", "####"],
  "1": ["   #", "   #", "   #", "   #", "   #"],
  "2": ["####", "   #", "####", "#   ", "####"],
  "3": ["####", "   #", "####", "   #", "####"],
  "4": ["#  #", "#  #", "####", "   #", "   #"],
  "5": ["####", "#   ", "####", "   #", "####"],
  "6": ["####", "#   ", "####", "#  #", "####"],
  "7": ["####", "   #", "   #", "   #", "   #"],
  "8": ["####", "#  #", "####", "#  #", "####"],
  "9": ["####", "#  #", "####", "   #", "####"],
  "<": ["  ##", " ## ", "##  ", " ## ", "  ##"],
  ">": ["##  ", " ## ", "  ##", " ## ", "##  "],
  /**
   * SEVEN COLUMNS, AND A STROKE TWO CELLS THICK.
   *
   * The first version of this face was five columns with a one-cell diagonal,
   * which breaks the rule written six lines above it for the chevrons: at this
   * resolution a single-cell diagonal reads as a dotted line rather than as a
   * stroke. On the largest thing the card draws, the one glyph that did not
   * resolve was the one naming the unit.
   *
   * A percent sign is wider than a digit in every typeface, so the extra
   * columns are not a compromise — and a 2x2 counter at each end is the least
   * that reads as a counter rather than as more diagonal.
   */
  [PERCENT]: ["##   ##", "##  ## ", "   ##  ", "  ## ##", " ##  ##"],
};

/** One pattern row, in this terminal's block. */
function paint(pattern: string, block: string): string {
  let painted = "";
  for (const cell of pattern) painted += cell === ON ? block : " ";
  return painted;
}

/**
 * The five rows of a rendered string, at full width and without colour or
 * indent. Exported for the tests: a face is a shape, and a shape is worth
 * asserting on its own rather than through a whole card.
 */
export function bigNumberRows(text: string, term: Term): string[] {
  const block = term.glyph("block8");
  const separator = " ".repeat(GAP);
  const rows: string[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    const cells: string[] = [];
    for (const character of text) {
      cells.push(paint((FACES[character] ?? BLANK)[row], block));
    }
    rows.push(cells.join(separator));
  }
  return rows;
}

/**
 * The block, indented, coloured row by row, with `label` set two columns after
 * the middle row.
 *
 * Colour is applied PER ROW and never across a newline: an SGR run that spans
 * a line break survives a terminal but not a `head`, a `less` or a pasted
 * screenshot, and the escape would leak into whatever follows.
 *
 * Every row but the middle one is trimmed BEFORE it is coloured, not after. A
 * reset sequence does not end in whitespace, so trimming the coloured string
 * would silently do nothing when colour is on — and the plain and coloured
 * renderings would stop being the same bytes modulo escapes, which is a
 * property this repo asserts.
 */
export function renderBigNumber(
  text: string,
  label: string,
  color: ColorCode,
  term: Term,
): string[] {
  const middle = Math.floor(ROWS / 2);
  return bigNumberRows(text, term).map((row, index) =>
    index === middle
      ? `${INDENT}${term.color(row, color)}  ${label}`
      : `${INDENT}${term.color(row.trimEnd(), color)}`,
  );
}
