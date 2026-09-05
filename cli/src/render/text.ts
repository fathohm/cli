import type { ColorCode, Term } from "./term";

/**
 * The typesetting the card is made of: wrapping, padding, truncation, and the
 * one transliteration `--ascii` owes the sentences it does not own.
 *
 * Nothing here knows what a reading is. It is deliberately the only module in
 * `render/` with no import from the scorer — layout and measurement, so the
 * renderers above it can be about what they say rather than about columns.
 */

/** Two spaces. Every section of the card hangs off this one indent. */
export const INDENT = "  ";

/**
 * Greedy word wrap. Words longer than the width are NOT broken: a file path is
 * a single token, and a path split across two lines is a path you cannot
 * copy, paste, or grep for. An over-long line is the lesser failure.
 */
export function wrap(text: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/**
 * A wrapped paragraph with a hanging indent: `first` opens it (a bullet, a
 * label), `rest` carries every continuation. Both are counted against the
 * width, so a bulleted sentence and a plain one end in the same column.
 */
export function paragraph(
  text: string,
  width: number,
  first: string = INDENT,
  rest: string = first,
): string[] {
  const body = wrap(text, width - Math.max(first.length, rest.length));
  return body.map((line, index) => `${index === 0 ? first : rest}${line}`);
}

/**
 * A section heading's LAYOUT — no ink, which is what the name now says.
 *
 * It was called `sectionHead`, and so is the one in `./meta` that paints. Two
 * exported functions with one name in sibling modules, one of which applies the
 * card's whole annotation layer and one of which does not, and the difference
 * between a painted card and a plain one came down to which line of which
 * import block a renderer happened to use. `read` and `explain` took the ink;
 * `team`, `offboard` and `paydown` took the layout and looked like a different
 * product for it. Nobody chose that. The import did.
 *
 * `meta.sectionHead` now calls this for its layout and paints the result, so
 * there is one heading behaviour and one place to change it.
 *
 * `paragraph` would do, and it is the wrong tool: `wrap` tokenises on
 * whitespace and rejoins on a single space, so a head set as
 * `NAME  ·  what it selects on` comes back as `NAME · what it selects on` —
 * the two-space gutter that separates the label from its clause collapses, and
 * the head reads as one run-on phrase. So the line is emitted verbatim when it
 * fits, and only a head too long for the terminal is wrapped, where losing the
 * gutter is the smaller failure.
 */
export function headLayout(text: string, term: Term): string[] {
  const line = `${INDENT}${text}`;
  return line.length <= term.width
    ? [line]
    : paragraph(text, term.width - INDENT.length, INDENT, `${INDENT}${INDENT}`);
}

/**
 * How many words {@link wrap} will lay a string out as — the unit
 * {@link paintWords} indexes by. Exactly `wrap`'s own tokenisation, so a caller
 * can say "the score is the word after the head" without counting spaces.
 */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

/**
 * A wrapped paragraph, coloured BY WORD rather than by line.
 *
 * COLOUR IS APPLIED AFTER THE WRAP, ALWAYS. An escape sequence is bytes with no
 * width, so a sentence coloured before it is measured wraps in the wrong place
 * — the whole reason `offlineCloser` colours its lines rather than its text.
 * But the hero line needs two colours *inside* one wrapped sentence, and the
 * word is the only unit that survives the wrap: `wrap` never breaks one, never
 * reorders them, and always rejoins them with a single space.
 *
 * So `codeOf` is asked about word `n` of the whole paragraph, and adjacent
 * words that answer the same are painted as ONE run — a per-word escape pair
 * would triple the bytes of a line for no visible difference, and these bytes
 * are pinned in a golden file. `null` leaves a word alone.
 *
 * With colour off `term.color` is the identity, so the output is the input
 * line for line and byte for byte. That is the contract, not a side effect.
 */
export function paintWords(
  lines: readonly string[],
  term: Term,
  codeOf: (index: number, word: string) => ColorCode | readonly ColorCode[] | null,
): string[] {
  let index = 0;
  return lines.map((line) => {
    const body = line.trimStart();
    if (body === "") return line;
    const lead = line.slice(0, line.length - body.length);
    const runs: Array<{ code: ColorCode | readonly ColorCode[] | null; words: string[] }> = [];
    for (const word of body.split(" ")) {
      const code = codeOf(index, word);
      index += 1;
      const open = runs[runs.length - 1];
      if (open !== undefined && open.code === code) open.words.push(word);
      else runs.push({ code, words: [word] });
    }
    return (
      lead +
      runs
        .map((run) => {
          const text = run.words.join(" ");
          return run.code === null ? text : term.color(text, run.code);
        })
        .join(" ")
    );
  });
}

/** Left-aligned in a fixed column. Longer text overflows rather than being cut
 *  — the caller truncates first if the column is load-bearing. */
export function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Right-aligned in a fixed column: what every number column wants. */
export function padStart(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

/** Cut from the RIGHT, keeping the head. For labels. */
export function truncate(text: string, width: number, ellipsis: string): string {
  if (text.length <= width) return text;
  const keep = width - ellipsis.length;
  return keep <= 0 ? ellipsis.slice(0, width) : text.slice(0, keep) + ellipsis;
}

/**
 * Cut from the LEFT, keeping the tail. For paths: `…/src/scorer.ts` still
 * tells you which file it is, and `workers/src/sco…` does not.
 *
 * Module-private now that `truncatePath` is the way a path reaches a column;
 * it survives as that function's fallback for the paths a middle cut cannot
 * improve on.
 */
function truncateStart(text: string, width: number, ellipsis: string): string {
  if (text.length <= width) return text;
  const keep = width - ellipsis.length;
  return keep <= 0 ? ellipsis.slice(0, width) : ellipsis + text.slice(text.length - keep);
}

/**
 * The fewest tail characters a middle cut may leave. Eight is about
 * `page.tsx` — below that the tail stops naming a file and the head is buying
 * context nobody can use.
 */
export const MIN_TAIL = 8;

/**
 * Cut from the MIDDLE, keeping the first segment and the tail.
 *
 * A path has two informative ends and a middle that is mostly scaffolding.
 * Cutting from the left alone throws away the more valuable of the two:
 * `…pplications/[id]/page.tsx` has lost which top-level area of the repository
 * the file is in, and in a monorepo that is the first thing a reader wants —
 * they know whether `workers/` or `app/` is theirs before they know what
 * `[id]` is. Keeping the first segment costs four or five columns and buys
 * back the orientation: `src/…/[id]/page.tsx`.
 *
 * TWO CASES FALL BACK to a left cut, and both are the same rule: THE FILENAME
 * ALWAYS WINS. A path with no directory in it has no first segment to keep,
 * and a path whose first segment is so long that fewer than `MIN_TAIL`
 * characters are left would be spending the column on a directory nobody asked
 * about while the filename disappears.
 *
 * The result is exactly `width` characters whenever anything was cut, so a
 * padded column stays a column.
 */
export function truncatePath(text: string, width: number, ellipsis: string): string {
  if (text.length <= width) return text;

  const cut = text.indexOf("/");
  if (cut === -1) return truncateStart(text, width, ellipsis);

  const head = text.slice(0, cut + 1);
  const tail = width - head.length - ellipsis.length;
  if (tail < MIN_TAIL) return truncateStart(text, width, ellipsis);

  return head + ellipsis + text.slice(text.length - tail);
}

/**
 * The ASCII fold, for prose fathohm did not write.
 *
 * `--ascii` is a promise about the byte set, and the card's own glyphs keep it
 * through `term.glyph`. The bucket and contact sentences come from
 * `lib/reading-explained.ts` — shared with the dashboard, and rightly written
 * for a browser — so they arrive carrying an em dash, a `≈`, a `¼`. Rewording
 * them here would fork the copy; leaving them would break the promise. So the
 * only thing that happens is a character substitution, one table, applied
 * nowhere else.
 *
 * PATHS ARE NEVER FOLDED. A filename is data: a unicode path printed back with
 * its characters replaced is a path that no longer names the file.
 */
const ASCII_FOLD: ReadonlyArray<readonly [RegExp, string]> = [
  [/—/g, "--"],
  [/–/g, "-"],
  [/·/g, "."],
  [/≈/g, "~"],
  [/¼/g, "1/4"],
  [/→/g, "->"],
  [/…/g, "..."],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
];

export function asciiFold(text: string): string {
  let folded = text;
  for (const [pattern, replacement] of ASCII_FOLD) folded = folded.replace(pattern, replacement);
  return folded;
}

/** Prose from a shared module, in this terminal's byte set. */
export function prose(term: Term, text: string): string {
  return term.ascii ? asciiFold(text) : text;
}

/**
 * The reading's own timestamp, to the second.
 *
 * Milliseconds are noise on a card whose subject is months of decay, and
 * `--now 2026-07-31T00:00:00Z` should print back exactly what was typed rather
 * than the same instant wearing a `.000`.
 */
export function isoSeconds(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The UTC calendar day, the form `fadesAt` already speaks. */
export function isoDay(at: string | Date): string {
  return (typeof at === "string" ? at : at.toISOString()).slice(0, 10);
}

const KILO = 1024;

/**
 * A byte count in three characters and a suffix. Terse on purpose: it is a
 * column beside a date and a score, and it is there to rank files by weight,
 * not to be added up.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0B";
  if (bytes < KILO) return `${Math.round(bytes)}B`;
  const kilobytes = bytes / KILO;
  if (kilobytes < KILO) return `${roundedSize(kilobytes)}K`;
  return `${roundedSize(kilobytes / KILO)}M`;
}

/** One decimal below ten, none above: `9.4K`, `12K`. */
function roundedSize(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

/**
 * `formatBytes`, but the printed figure never falls below the quantity.
 *
 * For UPPER BOUNDS in prose: "none the only name on more than 12K" over a
 * 12.7K load is checkably false against the same clone, because nearest
 * rounding shrank the bound below the thing it bounds. Ceiling at the same
 * displayed precision keeps the sentence true and the figure at most one
 * display unit generous — never smaller.
 */
export function formatBytesCeil(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0B";
  if (bytes < KILO) return `${Math.ceil(bytes)}B`;
  const kilobytes = bytes / KILO;
  if (kilobytes < KILO) return `${ceiledSize(kilobytes)}K`;
  return `${ceiledSize(kilobytes / KILO)}M`;
}

/** `roundedSize`'s precision, ceiling instead of nearest. */
function ceiledSize(value: number): string {
  const tenths = Math.ceil(value * 10) / 10;
  return tenths < 10 ? tenths.toFixed(1) : String(Math.ceil(value));
}

/**
 * A small count as a word: `five rows`, not `5 rows`.
 *
 * Only where the number is part of a SENTENCE about the card's own shape — how
 * many rows are standing there — never for a measurement. A quantity read off
 * the repository is a figure and stays one; a figure inside prose reads as data
 * the reader is meant to check against something, and there is nothing here to
 * check it against. Beyond twelve the word is longer than the fact, so the
 * digits come back.
 */
const COUNT_WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

export function countWord(count: number): string {
  return Number.isInteger(count) && count >= 0 && count < COUNT_WORDS.length
    ? COUNT_WORDS[count]
    : String(count);
}

/**
 * A value as one shell argument, quoted only when it has to be.
 *
 * Every command this card prints is meant to be copied straight back into the
 * terminal, and a person's name is the one argument fathohm prints that
 * routinely contains a space. An unquoted `fathohm offboard Ada Lovelace` is a
 * usage error the reader has to debug before the tool has answered anything —
 * which is worse than printing no command at all.
 *
 * SINGLE quotes, because the value is a git author name — unauthenticated
 * metadata anybody who ever committed controls. Inside double quotes `$`,
 * backtick and `!` stay live to the shell, so a name shaped like a command
 * substitution would execute the moment a reader pastes the suggested
 * command. Single quotes make every byte literal; an embedded quote uses the
 * standard `'\''` splice.
 */
export function quoteArg(value: string): string {
  return /^[\w.@/+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

