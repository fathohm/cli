import type { RepoReading } from "../reading/scoring";
import { structureInk } from "./ramp";
import type { ColorCode, Term } from "./term";
import { formatBytes, headLayout, INDENT, paragraph, wrap } from "./text";

/**
 * Everything a renderer needs that is not the reading itself: what to call the
 * repository, which flags are on, which lenses produced the numbers.
 *
 * Deliberately flat data. A renderer takes `(reading, term, meta)` and returns
 * `string[]` — it never resolves a path, spawns git, or scores anything, which
 * is what lets the golden tests hand it a fixture and compare bytes.
 */
export interface RenderMeta {
  /** What the header calls the thing being read — a directory name, usually. */
  readonly target: string;
  /** `--quiet`: the header, the headline, the provenance. Nothing else. */
  readonly quiet: boolean;
  /** `--full`: the long form — every dark path, not just the tide's next. */
  readonly full: boolean;
  /** How far ahead a fade date was looked for. Stated wherever one is absent. */
  readonly horizonDays: number;
  /** Printed on every surface: a reading you cannot attribute to a lens is not
   *  evidence, and two scorer versions are two different readings. */
  readonly scorerVersion: string;
}

/**
 * WHAT KIND OF THING THIS CARD READ.
 *
 * A terminal is scrollback, and three `fathohm` runs in a row all opened with
 * the same six characters — so a reader scrolling up could not tell a whole
 * repository from one file without parsing the sentence after the dash. The
 * scope is now stated rather than inferred.
 *
 * `repository` is the default and prints NOTHING. Most commands read a repo,
 * an unmarked card means the usual thing, and a tag on every header would be
 * noise that stops being read by the second screen. Only the departure from
 * the default earns the marker.
 */
export type HeaderScope = "repository" | "file";

/** The word each scope announces itself with, or null for the default. */
const SCOPE_TAG: Record<HeaderScope, string | null> = {
  repository: null,
  file: "ONE FILE",
};

/*
 * The scope tag wears the card's one structural accent — `structureInk`, resolved
 * for whichever ground this handle was built for. The tag was the first thing to
 * wear it; the section headings and the runnable tokens now wear the same one,
 * which is the point: a reader learns one colour that means "this is chrome, not
 * a measurement" instead of a different accent per surface.
 *
 * THE WORD IS LOAD-BEARING, THE COLOUR IS NOT. Under `--no-color`, in a pipe,
 * in a CI log — the places scrollback confusion is *worst* — the ink is gone
 * and `ONE FILE` still says it. Cover the colour and the header still answers
 * the question; that is the same test the copy rule puts to every label.
 */

/**
 * The header, on every command.
 *
 * The timestamp is not decoration. `now` is an input to the reading — every
 * factor that decays is measured against it — so a card without it is a
 * measurement without units, and `--now` replays are unverifiable. It is
 * printed whether the clock came from `--now`, from `--at`'s ref, or from the
 * wall.
 *
 * One line where it fits; otherwise the SUBJECT keeps the first line and the
 * lenses (clock, scorer) take the second. Not a greedy wrap: filling line one
 * to the column and letting `scorer v2` fall alone onto line two is how a
 * header stops looking composed, and this is the first thing anyone sees.
 *
 * A SUBJECT TOO LONG FOR THE TERMINAL WRAPS RATHER THAN OVERFLOWING. Repository
 * names are whatever a directory is called and the subject can carry a clause
 * of its own (`· the humans (3 in its history)`), so "it will fit" is not a
 * property this can assume — and one line over the column ruins the screenshot
 * the whole card exists to be. A path is still one token and `wrap` still
 * refuses to break one, which is the right trade: a filename you cannot copy is
 * worse than a long line.
 */
export function renderHeader(
  term: Term,
  parts: readonly string[],
  scope: HeaderScope = "repository",
  subjectInk?: ColorCode,
): string[] {
  const separator = ` ${term.glyph("dot")} `;
  const scopeInk = structureInk(term.ground);
  const tag = SCOPE_TAG[scope];
  const wordmark = tag === null ? "FATHOHM" : `FATHOHM ${tag}`;
  const subject = `${wordmark} ${term.glyph("dash")} ${parts[0] ?? ""}`;
  const tail = parts.slice(1);

  const oneLine = [subject, ...tail].join(separator);
  // The tail is wrapped too, not emitted on faith: `explain --without <query>`
  // and offboard's baseline part put arbitrary reader-typed text in it, and a
  // tail line is multiple wrappable tokens — the one-unbreakable-token
  // exemption that covers a long path does not cover a joined lens list.
  const lines =
    oneLine.length <= term.width
      ? [oneLine]
      : [
          ...wrap(subject, term.width),
          ...wrap(tail.join(separator), term.width),
        ];

  /**
   * THE WORDMARK, IN THE STRUCTURE INK — and the rule it used to break survives.
   *
   * What this file forbade was lending the *ramp* to the brand: "colouring it
   * would make the brand a data colour, which is the one thing the ramp is not
   * allowed to be lent to". `structureInk` is never on the ramp — `ramp.test.ts`
   * asserts exactly that — so the wordmark can carry a colour without ever
   * carrying a reading. The ban was on the scale, not on ink.
   *
   * And the first line is the one that has to earn a second look. It is what a
   * reader meets between a test run and a git status, and it was set in the
   * same white as everything under it: a masthead that looked like output.
   */
  lines[0] =
    term.color("FATHOHM", [scopeInk, "bold"]) +
    (tag === null ? "" : ` ${term.color(tag, scopeInk)}`) +
    lines[0].slice(wordmark.length);

  /**
   * THE SUBJECT MAY WEAR ITS OWN READING'S COLOUR, and one caller asks it to.
   *
   * `explain` is the command a reader runs several times in a row — the picker
   * prints one card per file into the same scrollback — and every one of those
   * cards opened with the same six characters followed by a path in the same
   * plain white as the sentence under it. Nothing on the screen said where one
   * file's answer ended and the next one's began.
   *
   * So the path takes the colour of the score printed two lines below it. This
   * is not chrome borrowing the scale: the card's GONE DARK section already
   * paints its file paths from `depthColor`, and this is the same path being
   * painted by the same fact. It also means a reader scrolling back gets the
   * verdict from the header alone, before reading a number.
   *
   * Applied AFTER the wrap, to the subject's own segment only — the wordmark
   * and tag keep theirs, the tail keeps none, and a subject that wrapped across
   * two lines is left alone rather than half-painted.
   */
  /**
   * THE LENSES RECEDE SO THE SUBJECT LEADS.
   *
   * `2026-08-20T00:00:00Z · scorer v4` is byte-identical on every card a reader
   * will ever see, and it was set at full weight directly under the one line
   * that changes. Dim is not "less important" — the timestamp is load-bearing
   * and still printed, every time — it is "you have read this before".
   *
   * NOT WHEN A SIMULATION IS NAMED. `--without` produces a different reading,
   * and the whole reason that clause sits in the header is that a screenshot of
   * the table without it would be a claim about a repository that does not
   * exist. A warning that recedes is a warning that was removed, so the tail
   * keeps full weight whenever it carries one.
   */
  const simulated = tail.some((part) => part.includes("(simulated)"));
  if (!simulated) {
    const from = lines.length === 1 ? -1 : wrap(subject, term.width).length;
    if (from === -1) {
      const at = lines[0].indexOf(separator + tail.join(separator));
      if (at !== -1 && tail.length > 0) {
        lines[0] = lines[0].slice(0, at) + term.color(lines[0].slice(at), "dim");
      }
    } else {
      for (let i = from; i < lines.length; i += 1) lines[i] = term.color(lines[i], "dim");
    }
  }

  const path = parts[0] ?? "";
  if (subjectInk !== undefined && path !== "") {
    const at = lines[0].indexOf(path);
    if (at !== -1) {
      lines[0] =
        lines[0].slice(0, at) + term.color(path, subjectInk) + lines[0].slice(at + path.length);
    }
  }
  return lines;
}

/**
 * `--scope <dir>`: the denominator this card divided by, said out loud.
 *
 * A subtree reading is the one shape of output here that can be true and
 * misleading at the same time. Every number on the card is correct about the
 * directory and NONE of them is the repository's — so a screenshot with the
 * flag cropped out of the command line is a claim about a codebase nobody
 * measured, and "45% gone dark" reads exactly the same either way.
 *
 * So the card states its own denominator: which directory, how many files, how
 * many bytes, and that the repository's own number is a different number. It
 * sits directly under the header, on EVERY scoped command, because the last
 * line that could carry it is the first line somebody stops reading.
 *
 * The flag is not enough on its own and neither is the header. `read --scope
 * lib` prints `git-only reading of acme-api/lib`, which is the subject named
 * correctly and still leaves "of what?" to inference; this is the sentence
 * that closes it. Dim, like the simulation note `offboard` prints and for the
 * same reason: it qualifies the reading rather than measuring anything.
 */
export function scopeNote(reading: RepoReading, term: Term): string[] {
  if (reading.scope === null) return [];
  const files = reading.files.length === 1 ? "1 file" : `${reading.files.length} files`;
  return paragraph(
    `Reading: ${reading.scope}/ ${term.glyph("dash")} ${files}, ` +
      `${formatBytes(reading.scoredBytes)}, scoped; the repository's own number is different`,
    term.width,
    "",
    "",
  ).map((line) => term.color(line, "dim"));
}

/**
 * A SECTION HEADING, and the note that qualifies it.
 *
 * The card is one scroll of text with five sections in it, and until now they
 * were announced in the same ink as the sentences under them — so the reader
 * had to parse a line before knowing whether it was a heading. Caps alone did
 * not carry it: the ledger's group rows are capitalised too, and they are data.
 *
 * TWO WEIGHTS, ONE LINE. The title takes the structure ink; the note after it
 * takes dim. A heading like `WHERE THE DARK CODE IS · bar length = share of
 * this repository` is one label and one instruction, and setting them alike is
 * what made the whole line read as neither. Splitting them means the eye can
 * take the section name at a glance and the instruction only when it needs it.
 *
 * The separator belongs to the note, so a heading with no note prints no
 * dangling punctuation — and under `--no-color` the line is byte-for-byte what
 * it always was, because every part is composed at full width and painted
 * afterwards.
 */
export function sectionHead(
  term: Term,
  title: string,
  note?: string,
  separator?: string,
): string[] {
  const gap = separator ?? `  ${term.glyph("dot")}  `;
  const plain = note === undefined ? title : `${title}${gap}${note}`;

  // LAID OUT FIRST, PAINTED AFTER — the rule the whole render layer keeps. An
  // escape has bytes and no width, so measuring a coloured string is measuring
  // the wrong thing, and a head that wraps would break in the wrong place.
  const laid = headLayout(plain, term);

  const opener = `${INDENT}${title}`;
  if (!laid[0].startsWith(opener)) return laid;

  const head = INDENT + term.color(title, structureInk(term.ground));
  const rest = laid[0].slice(opener.length);
  return [
    head + (rest === "" ? "" : term.color(rest, "dim")),
    // A head long enough to wrap carries its clause onto the next line, and the
    // clause is the dim half wherever it lands.
    ...laid.slice(1).map((line: string) => term.color(line, "dim")),
  ];
}

/**
 * THE RUNNABLE TOKEN, painted after the wrap has measured the line.
 *
 * `fathohm team`, `fathohm read --full`, `https://fathohm.dev` — every one of
 * these is something the reader is meant to type or open, and every one of them
 * was set in the same ink as the sentence carrying it. A card that ends by
 * naming three commands and distinguishes none of them from prose is asking the
 * reader to find the interface inside a paragraph.
 *
 * SAME ACCENT AS A HEADING, AND FOR THE SAME REASON. The structure ink means
 * "this is the tool, not a measurement". A section name and a command name are
 * both that; only the scale is a reading. The bold is what separates the two
 * roles without spending a second hue on it.
 *
 * PAINTED IN THE OUTPUT, NEVER IN THE INPUT. An escape has bytes and no width,
 * so a token coloured before `paragraph` sees it moves the wrap. And a token
 * that the wrap split across two lines is left alone rather than half-painted:
 * a command with an escape in the middle of it is a command that breaks when
 * somebody copies it, which is worse than a command that is merely plain.
 */
export function runnable(
  term: Term,
  lines: readonly string[],
  token: string,
): string[] {
  const index = lines.findIndex((line) => line.includes(token));
  if (index === -1) return [...lines];
  const line = lines[index];
  const at = line.indexOf(token);
  const painted =
    line.slice(0, at) +
    term.color(token, [structureInk(term.ground), "bold"]) +
    line.slice(at + token.length);
  return lines.map((each, i) => (i === index ? painted : each));
}
