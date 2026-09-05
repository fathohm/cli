import {
  BLIND_SPOT_THRESHOLD,
  scoreFromFactors,
  WEIGHTS,
  type Factors,
} from "../../../lib/demo-data";
import { scoredAnswerability } from "../../../lib/answerability-core";
import {
  bucketOf,
  bucketSentence,
  contactLine,
  explainReading,
  promptedOnlyLine,
} from "../../../lib/reading-explained";
import { nearestMatch } from "../cmd/args";
import { CliError, EXIT } from "../cmd/errors";
import { ceilingFactors, holdsAtCeiling } from "../reading/fade";
import type { RepoReading, ScoredFile } from "../reading/scoring";
import type { Term } from "./term";
import { darkFiles } from "./below";
import { fileEntries } from "./entries";
import { renderHeader, scopeNote, type RenderMeta } from "./meta";
import { depthColor, structureInk } from "./ramp";
import { daysBetween } from "../reading/days";
import { INDENT, isoSeconds, padEnd, padStart, paragraph, prose } from "./text";

/**
 * `fathohm explain <path>` — one file, factor by factor.
 *
 * The card answers "how much"; this answers "why this one", and it is the
 * surface the bright line about black boxes is actually enforced on: a score
 * that cannot be decomposed into visible factors is a critical bug, not a
 * shortcut. So the table shows all four factors, their weights, their
 * contributions, and both ends of the interval side by side — the ceiling
 * column is exactly where a reader can see that the missing review record is
 * worth more than everything else combined, which is the argument for
 * installing the App made in arithmetic rather than in copy.
 *
 * Nothing is rounded into agreement: the contributions are printed to three
 * decimals and they add up to the score printed under them.
 */

/** The four weighted factors, in the order the weights are declared. */
const FACTOR_ROWS: ReadonlyArray<{ key: keyof Factors; label: string }> = [
  { key: "human_review_depth", label: "human review depth" },
  { key: "human_author_recency", label: "human author recency" },
  { key: "bus_factor", label: "bus factor" },
  { key: "question_answerability", label: "question answerability" },
];

/**
 * THE HIGHEST SCORE ANY FILE CAN CURRENTLY REACH — derived, never typed.
 *
 * `scoredAnswerability` returns 0 unconditionally (scorer v3, the fix for the
 * self-assessment loophole: an org could otherwise lower its own headline by
 * answering its own question). The weight was deliberately NOT redistributed —
 * "the 0.10 is not retired, it is unearned" — so the arithmetic caps every file
 * in every repository at 0.900, and this card never said so.
 *
 * Computed from the scorer rather than written as a constant, for two reasons.
 * `discipline.test.ts` fails any renderer that restates a scoring constant; and
 * the day a verified check can raise the factor, this becomes 1.000 on its own
 * and the caveat below RETIRES ITSELF rather than becoming a stale sentence.
 */
const CEILING_OF_THE_SCALE = scoreFromFactors({
  human_review_depth: 1,
  human_author_recency: 1,
  bus_factor: 1,
  question_answerability: scoredAnswerability([], new Date(0)),
});

/** Factors the record can actually move. The rest are unearned, not measured. */
function isEarnable(key: keyof Factors): boolean {
  return key !== "question_answerability" || CEILING_OF_THE_SCALE >= 1;
}

const LABEL_WIDTH = 24;
const WEIGHT_WIDTH = 7;
const CELL_WIDTH = 17;

/**
 * The file the reader meant, or a `CliError` that names one they might have.
 *
 * Exit 2, not 3: a path that is not in the tree is a mistyped argument, and
 * the repository was read perfectly well. Suffix and basename matches are
 * tried before the edit-distance search so `explain scorer.ts` works from
 * anywhere in a repo, which is how people actually type a path they are
 * looking at in an editor.
 *
 * THE ORDER OF THE FOUR ATTEMPTS IS THE WHOLE DESIGN, and the ordinal sits
 * second on purpose. `fathohm explain 3` is a convenience for the row a reader
 * is looking at on the card; a file literally named `3` is somebody's actual
 * source. A real path in the tree beats a positional shorthand every time, so
 * the exact match runs first and the ordinal only ever resolves a token that
 * names nothing.
 */
export function selectFile(reading: RepoReading, request: string): ScoredFile {
  const wanted = normalizePath(request);
  if (wanted === "") throw unknownPath(reading, request);

  const exact = reading.files.find((file) => file.path === wanted);
  if (exact !== undefined) return exact;

  const ordinal = asOrdinal(request);
  if (ordinal !== null) return byOrdinal(reading, ordinal);

  const suffix = reading.files.filter((file) => file.path.endsWith(`/${wanted}`));
  if (suffix.length === 1) return suffix[0];

  const base = reading.files.filter((file) => basename(file.path) === basename(wanted));
  if (base.length === 1) return base[0];

  throw unknownPath(reading, request, wanted);
}

/**
 * Digits and nothing else — the token as TYPED, not the normalized path.
 *
 * `./3` is somebody pointing at a file; `3` is somebody pointing at a row. The
 * leading `-` is accepted only so that `explain -- -1` gets the range hint
 * rather than a fuzzy search for a file named `-1`.
 */
const ORDINAL = /^-?[0-9]+$/;

function asOrdinal(request: string): number | null {
  if (!ORDINAL.test(request)) return null;
  const ordinal = Number.parseInt(request, 10);
  return Number.isFinite(ordinal) ? ordinal : null;
}

/**
 * The Nth dark file, counting from 1 — in the order the card PRINTS them, not a
 * numbering of its own.
 *
 * THE ORDER IS THE LEDGER'S: group by group down the card, and inside each
 * group application code first, then the scaffolding, then tests and styles.
 * `explain 1` is therefore the row the section leads with and the file the
 * card's `start here:` line names — on a repository whose biggest dark file is
 * a schema dump, it is not that dump.
 *
 * There is only one list because there is only one `darkFiles`. A
 * second sort here — "by bytes, obviously" — would number rows the reader is
 * not looking at, which is the failure mode an ordinal argument has to be
 * incapable of.
 *
 * N INDEXES THE ORDER, NOT THE FIVE PRINTED ROWS. The ledger shares its row
 * budget across the groups, so the rows on screen are a SUBSEQUENCE of this
 * list rather than its head: a small group's single row can sit above a large
 * group's fourth file. Numbering the printed rows instead would make N mean
 * something different on `read` and on `read --full`, and a number that shifts
 * with a flag is worse than no number. What holds either way is the end a
 * reader actually uses: 1 is the row the card leads with, and every path the
 * card prints is printed in full for the times a number is not what is wanted.
 */
function byOrdinal(reading: RepoReading, ordinal: number): ScoredFile {
  const dark = darkFiles(reading);
  if (ordinal >= 1 && ordinal <= dark.length) return dark[ordinal - 1];
  throw new CliError(
    EXIT.usage,
    `there is no dark row ${ordinal} in this reading`,
    dark.length === 0
      ? "nothing in this reading has gone dark, so there is no row to number."
      : `the reading has ${dark.length} dark ${dark.length === 1 ? "file" : "files"} — ` +
          `1 through ${dark.length}.`,
  );
}

function unknownPath(reading: RepoReading, request: string, wanted?: string): CliError {
  // Slack proportional to the path's length: two edits is a typo in `app.ts`
  // and a coincidence in `workers/src/parse-events.ts`.
  const query = wanted ?? normalizePath(request);
  const near =
    query === ""
      ? null
      : nearestMatch(
          query,
          reading.files.map((file) => file.path),
          Math.max(2, Math.ceil(query.length / 3)),
        );
  return new CliError(
    EXIT.usage,
    `no file named ${request} in this reading`,
    near !== null
      ? `did you mean \`${near}\`?`
      : "`fathohm read --full` and `fathohm fade` both list paths from this reading.",
  );
}

function normalizePath(request: string): string {
  return request.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

export function renderExplain(
  reading: RepoReading,
  file: ScoredFile,
  term: Term,
  meta: RenderMeta,
): string[] {
  const width = term.width - INDENT.length;
  const lines = renderHeader(
    term,
    [
      file.path,
      // WHICH REPOSITORY THIS PATH IS IN. Every other command names the repo in
      // its header; `explain` was the one that did not, and a bare `lib/utils.js`
      // is the same six characters in every checkout on the machine. Two runs in
      // two clones produced two cards a reader could not tell apart.
      `in ${meta.target}`,
      // A `--without` reading is a DIFFERENT reading, and this is the one surface
      // where that is easy to forget: the factor table looks exactly like the
      // real one, and a screenshot of it with a number somebody quotes later
      // would be a claim about a repository that does not exist. So the
      // simulation is named on the same line as the file, every time.
      ...simulated(reading),
      isoSeconds(reading.now),
      `scorer ${meta.scorerVersion}`,
    ],
    "file",
    // The header wears the floor, exactly as the big number does: it is the end
    // of the interval the evidence proves, and picking the other end would put
    // a colour on the screen that the record cannot defend.
    depthColor(file.floor, term.ground),
  );
  lines.push(...scopeNote(reading, term));

  lines.push("", ...scoreLine(file, term));
  lines.push("", ...factorTable(file, term), ...unearnedWeight(term, width));
  lines.push("", ...engagement(file, reading.now, term, width));
  lines.push("", ...bucket(reading, file, term, width));
  lines.push("", ...fadeSentences(reading, file, meta, term, width));
  return lines;
}

/**
 * The header part that says whose engagement is missing, or nothing at all.
 *
 * The queries AS TYPED, in the order they were given — not the identities they
 * resolved to. A reader checking the card against their own invocation is
 * matching what they wrote, and a name silently rewritten into an email address
 * would read as the tool having removed somebody else.
 */
function simulated(reading: RepoReading): string[] {
  if (reading.withoutMatches.length === 0) return [];
  const names = reading.withoutMatches.map((match) => match.query).join(", ");
  return [`without ${names} (simulated)`];
}

function scoreLine(file: ScoredFile, term: Term): string[] {
  // BOTH ENDS WEAR THE RAMP, and they are the only numbers on this card that
  // do. A floor and a ceiling are comprehension values on the 0-1 scale, so
  // `depthColor` buckets them exactly as `scoreColor` buckets a gallery cell —
  // the same reading is the same colour in the terminal and on the Map, by
  // construction rather than by anyone matching hexes.
  const depth = (value: number): string => term.color(value.toFixed(3), depthColor(value, term.ground));
  const interval =
    file.ceiling === file.floor
      ? depth(file.floor)
      : `${depth(file.floor)} floor ${term.glyph("dot")} ${depth(file.ceiling)} ceiling`;
  return [
    `${INDENT}score ${interval} ` +
      term.color(`(the line is ${BLIND_SPOT_THRESHOLD.toFixed(2)})`, "dim"),
  ];
}

/**
 * value × weight = contribution, at both ends of the interval.
 *
 * The ceiling column is the floor's evidence with `human_review_depth` at 1 —
 * and only for a PR-mediated file, because a file that never went through a
 * pull request cannot have pull-request reviews. When it did not, both columns
 * are the same numbers, which is itself the finding: for that file the reading
 * is already exact.
 */
function factorTable(file: ScoredFile, term: Term): string[] {
  const ceiling = file.prMediated ? ceilingFactors(file.factors) : file.factors;
  const arrow = term.glyph("arrow");
  const rule = term.glyph("rule");

  // THE COLUMN HEADS TAKE THE STRUCTURE INK; THE CELLS UNDER THEM TAKE THE SCALE
  // WHERE THE RECORD CAN MOVE THEM. The earlier version of this note said the
  // cells stayed plain because `question_answerability` would show a permanent
  // red alarm — true of that ONE row, and the wrong conclusion drawn from it:
  // the fix is to say what is unearned, not to withhold the encoding from the
  // three factors the reading actually measures.
  const lines = [
    term.color(
      INDENT +
        padEnd("factor", LABEL_WIDTH) +
        padStart("weight", WEIGHT_WIDTH) +
        " " +
        padEnd("floor", CELL_WIDTH) +
        "ceiling",
      structureInk(term.ground),
    ),
  ];
  for (const { key, label } of FACTOR_ROWS) {
    // Each cell is composed and PADDED at full width, then painted — an escape
    // has bytes and no width, so a number coloured before `padEnd` measures it
    // moves the column the moment a terminal supports colour.
    const floorCell = padEnd(cell(file.factors[key], WEIGHTS[key], arrow), CELL_WIDTH);
    const ceilingCell = cell(ceiling[key], WEIGHTS[key], arrow);
    const earnable = isEarnable(key);
    const row =
      INDENT +
      padEnd(label, LABEL_WIDTH) +
      padStart(WEIGHTS[key].toFixed(2), WEIGHT_WIDTH) +
      " " +
      // A FACTOR'S READING IS A COMPREHENSION VALUE, so it takes the scale —
      // but only where the record can move it. `question_answerability` is 0 on
      // every file in every repository until a check can be verified by someone
      // other than its author, so painting it would put an identical red alarm
      // on one row of every card ever printed: an encoding that never varies
      // carries no information and reads as a finding about THIS file.
      (earnable
        ? term.color(floorCell, depthColor(file.factors[key], term.ground)) +
          term.color(ceilingCell, depthColor(ceiling[key], term.ground))
        : term.color(floorCell + ceilingCell, "dim"));
    lines.push(row);
  }
  lines.push(
    INDENT +
      " ".repeat(LABEL_WIDTH + WEIGHT_WIDTH + 1) +
      padEnd(rule.repeat(CELL_WIDTH - 4), CELL_WIDTH) +
      rule.repeat(CELL_WIDTH - 4),
  );
  // Padded at full width FIRST, painted after — an escape has bytes and no
  // width, so a cell coloured before it is padded moves the column the moment
  // the terminal supports colour. `discipline.test.ts` holds this to the byte.
  lines.push(
    INDENT +
      term.color(padEnd("score", LABEL_WIDTH), structureInk(term.ground)) +
      " ".repeat(WEIGHT_WIDTH + 1) +
      term.color(padEnd(file.floor.toFixed(3), CELL_WIDTH), depthColor(file.floor, term.ground)) +
      term.color(file.ceiling.toFixed(3), depthColor(file.ceiling, term.ground)),
  );
  return lines;
}

/**
 * WHY ONE ROW OF THAT TABLE IS ALWAYS ZERO, said before a stranger finds it.
 *
 * The gallery's factor caption and the dashboard's top-driver panel both
 * already EXCLUDE `question_answerability`, each with the same note: it is zero
 * on every file, so it would win on every file and name a cause nobody can act
 * on. This card is the surface whose entire job is decomposing a score, and it
 * was the one that still printed the factor as though it were a reading — a
 * flat `0.00` indistinguishable from a file that genuinely scored zero, and no
 * mention anywhere that the arithmetic therefore stops at 0.900.
 *
 * A number the card cannot explain is the thing CLAUDE.md calls a critical bug,
 * not a shortcut. So it is explained.
 *
 * The sentence is emitted only while the cap is real. When a verified check can
 * raise the factor, `CEILING_OF_THE_SCALE` reaches 1 and this returns nothing —
 * the disclosure retires with the defect rather than outliving it.
 */
function unearnedWeight(term: Term, width: number): string[] {
  if (CEILING_OF_THE_SCALE >= 1) return [];
  return paragraph(
    `question answerability reads 0 on every file: it needs an answer somebody other than ` +
      `the author verified, and git has no such record. Its weight is held rather than shared ` +
      `out, so nothing here can score above ${CEILING_OF_THE_SCALE.toFixed(3)}.`,
    width,
  ).map((line) => term.color(line, "dim"));
}

function cell(value: number, weight: number, arrow: string): string {
  return `${value.toFixed(2)} ${arrow} ${(value * weight).toFixed(3)}`;
}

/**
 * The two contacts this file has ever had, and the quarter-credit line when it
 * is true of it. Both come from `lib/reading-explained` — the readout on the
 * hosted Map says exactly this, in exactly these words.
 */
function engagement(file: ScoredFile, now: Date, term: Term, width: number): string[] {
  const lines = paragraph(prose(term, contactLine(file.factors.engagement, now)), width);
  const prompted = promptedOnlyLine(file.factors.engagement);
  if (prompted !== null) lines.push(...paragraph(prose(term, prompted), width));
  // Why the two columns of the table above do, or do not, differ. The second
  // case is the one worth saying out loud: for a file that never went through
  // a pull request there is no missing record to give the benefit of, so its
  // interval is a point and the CLI's reading of it is already exact.
  lines.push(
    ...paragraph(
      file.prMediated
        ? `pull-request mediated ${term.glyph("dash")} a merge or a squash subject touched it, ` +
            `so a review record could exist for it and the ceiling gives it the benefit.`
        : `never pull-request mediated ${term.glyph("dash")} there is no review record this file ` +
            `could have, so its ceiling is its floor and this reading of it is exact.`,
      width,
    ),
  );
  return lines;
}

/**
 * The sentence for the group this file sits in — the WHOLE reading's bucket,
 * not a bucket of one. A share computed over a single file would print "100%
 * of the scored bytes were prompted", which is true of nothing.
 */
function bucket(reading: RepoReading, file: ScoredFile, term: Term, width: number): string[] {
  const entries = fileEntries(reading);
  const mine = entries.find((entry) => entry.path === file.path);
  const id = mine === undefined ? null : bucketOf(mine);
  if (id === null) return [];
  const found = explainReading(entries, reading.now).buckets.find((b) => b.id === id);
  if (found === undefined) return [];
  return [
    term.color(`${INDENT}in this reading it sits with:`, structureInk(term.ground)),
    ...paragraph(prose(term, bucketSentence(found)), width),
  ];
}

function fadeSentences(
  reading: RepoReading,
  file: ScoredFile,
  meta: RenderMeta,
  term: Term,
  width: number,
): string[] {
  const lines: string[] = [];

  /**
   * A VERDICT WEARS THE COLOUR OF THE READING IT IS A VERDICT ABOUT.
   *
   * The card already does exactly this — its `NO HUMAN WROTE OR PROMPTED IT`
   * heading is drawn from the ramp and so is `still lit`, because both are
   * sentences that restate a number sitting beside them. These are the same
   * shape: "already below the line" is `floor < 0.30` in words, so it takes the
   * colour the score line has already given that floor, and a reader who takes
   * only the colour still gets the same answer as one who reads the sentence.
   *
   * Whole lines, painted AFTER `paragraph` has wrapped them — the wrap has
   * already happened, so an escape at the head of a finished line cannot move
   * anything. Colouring the input instead is what broke the debt block's own
   * wrap on the first attempt.
   */
  const verdict = (text: string, value: number): string[] =>
    paragraph(text, width).map((line) => term.color(line, depthColor(value, term.ground)));

  if (file.fadesAt !== null) {
    const days = daysBetween(reading.now, new Date(`${file.fadesAt}T00:00:00Z`));
    lines.push(
      ...verdict(
        `crosses the line on ${file.fadesAt} ${term.glyph("dash")} ${days} days from this reading, ` +
          `with no new commits.`,
        file.floor,
      ),
    );
  } else if (file.floor < BLIND_SPOT_THRESHOLD) {
    lines.push(
      ...verdict(
        `already below the line ${term.glyph("dash")} there is nothing left to fade.`,
        file.floor,
      ),
    );
  } else {
    lines.push(
      ...verdict(
        `holds past the horizon ${term.glyph("dash")} no crossing within ${meta.horizonDays} days.`,
        file.floor,
      ),
    );
  }

  if (holdsAtCeiling(file)) {
    lines.push(
      ...verdict(
        `holds if reviews credited ${term.glyph("dash")} full review credit alone keeps this file ` +
          `above the line with no further commits, indefinitely. That is the unmeasured review ` +
          `range doing the work.`,
        file.ceiling,
      ),
    );
  }
  return lines;
}
