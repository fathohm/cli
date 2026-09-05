import { formatBlindShare, formatLimitPercent } from "../../../lib/blind-share-format";
import { DEBT_GLOSS } from "../../../lib/reading-explained";
import type { CheckVerdict } from "../reading/check";
import { DARK_WINDOW_DAYS } from "../reading/dark";
import type { RepoReading } from "../reading/scoring";
import { createTerm, type Term } from "./term";
import { darkFiles, whyDark } from "./below";
import { HOSTED_URL } from "./hosted";
import { renderHeader, type RenderMeta } from "./meta";
import { renderProvenance } from "./provenance";
import { INDENT, countWord, formatBytes, isoSeconds, paragraph, quoteArg } from "./text";

/**
 * THE GATE, in one sentence.
 *
 * This is the surface a build failure is argued about in front of, and the
 * whole of its design is that the argument has nowhere to go:
 *
 *   - the VERDICT WORD comes first, in the first column, so `grep` and a
 *     glance find it in the same place in a thousand-line CI log;
 *   - the sentence names WHICH BOUND was gated, because "63% debt" from
 *     a tool that reports an interval is not yet a claim;
 *   - it carries the BYTES beside the share, so the one case where the printed
 *     percentage and the verdict look like they disagree — a reading half a
 *     point from its limit, where the share rounds to the threshold — is
 *     settled on the page rather than in a thread;
 *   - and the provenance block follows, unabridged, because what the reading
 *     could not see is part of the verdict whether or not it changed it.
 *
 * A truncated history is the one case with no verdict at all, and it is
 * rendered upside down: the PARTIAL READING banner and everything the clone is
 * missing come FIRST, and the refusal comes after them. The reader must have
 * met the reason before they meet the non-answer, or "no verdict" reads as a
 * bug in the tool rather than as the tool declining to guess.
 */

/**
 * THE THREE WORDS, in one place.
 *
 * The verdict word is what `grep` finds in a CI log and what a markdown
 * heading leads with, and it is the same word in both because it is written
 * down once. A second spelling somewhere would be two gates the day one of
 * them changed.
 */
export function verdictWord(verdict: CheckVerdict): string {
  if (verdict.indeterminate) return "NO VERDICT";
  return verdict.passed ? "PASS" : "FAIL";
}

export function renderCheck(
  reading: RepoReading,
  verdict: CheckVerdict,
  term: Term,
  meta: RenderMeta,
): string[] {
  const width = term.width - INDENT.length;
  const lines = renderHeader(term, [
    `check of ${meta.target}`,
    isoSeconds(reading.now),
    `scorer ${meta.scorerVersion}`,
  ]);

  if (verdict.indeterminate) {
    lines.push("", ...renderProvenance(reading, term));
    lines.push("", ...paragraph(noVerdict(term), width));
    return lines;
  }

  lines.push("", ...paragraph(sentence(verdict, term), width));
  // FAIL gets a next step; PASS needs none. One line, one command — and the
  // command reproduces THIS gate exactly (limit, bound, any `--without`
  // baseline), because a pointer at a different gate would answer a question
  // nobody asked. The rung where it passes exists whenever FAIL printed:
  // review's weight clears the line, so the full ladder always reaches the
  // limit (see REVIEW_CLEARS_THE_LINE).
  if (!verdict.passed && !verdict.nothingToGate) {
    lines.push("", ...paragraph(ladderPointer(reading, verdict), width));
  }
  lines.push("", ...renderProvenance(reading, term));
  return lines;
}

/** The command that prints the rung where this exact gate passes. */
function ladderPointer(reading: RepoReading, verdict: CheckVerdict): string {
  const flags = [`--max-blind ${verdict.threshold}`];
  if (verdict.bound === "floor") flags.push("--pessimistic");
  for (const match of reading.withoutMatches) {
    flags.push(`--without ${quoteArg(match.query)}`);
  }
  return `the ladder back under this limit: fathohm paydown ${flags.join(" ")}`;
}

/**
 * The one sentence. `NO VERDICT` / `PASS` / `FAIL` are the three words this
 * command is allowed to say, and they are not coloured: a CI log strips ANSI,
 * and a verdict that is only legible in colour is a verdict half its readers
 * cannot read.
 */
function sentence(verdict: CheckVerdict, term: Term): string {
  const dash = term.glyph("dash");
  const limit = formatLimitPercent(verdict.threshold);

  if (verdict.nothingToGate) {
    return (
      `PASS ${dash} nothing to fathom here yet: this tree holds no code to gate, ` +
      `so there is no debt to measure against your limit of ${limit}.`
    );
  }

  const share = formatBlindShare(verdict.share);
  // Named for what it is rather than for the column it came out of: "scored
  // bytes" is the denominator's internal name, and a gate is read by somebody
  // who has never opened this repository's schema.
  const bytes = `${formatBytes(verdict.blindBytes)} of the ${formatBytes(verdict.scoredBytes)} read`;
  const bound =
    verdict.bound === "ceiling"
      ? "even with full credit for every review git cannot see"
      : "on the evidence git can see, with no review credit at all";

  return verdict.passed
    ? `${verdictWord(verdict)} ${dash} ${bound}, ${share} of this repository sits below the line ` +
        `(${bytes}), within your limit of ${limit}.`
    : `${verdictWord(verdict)} ${dash} ${bound}, ${share} of this repository sits below the line ` +
        `(${bytes}), over your limit of ${limit}.`;
}

function noVerdict(term: Term): string {
  return (
    `NO VERDICT ${term.glyph("dash")} this history is truncated, so fathohm neither passed ` +
    `nor failed the gate: a verdict on a fragment is a verdict on nothing. Fetch the full ` +
    `history (a clone without --depth, or \`git fetch --unshallow\`) and run it again.`
  );
}

/* ── the pasteable form ─────────────────────────────────────────────────── */

/**
 * `check --format markdown` — the same verdict, for the place it gets argued.
 *
 * A gate failure is settled in a pull request, not in the terminal that
 * produced it, and until now getting it there meant a screenshot of a card or a
 * hand-typed paraphrase. A paraphrase is where a number loses its bound, its
 * denominator and its limit, so the pasteable form is rendered by the tool
 * rather than by the person under time pressure.
 *
 * WHAT IT IS ALLOWED TO BE, and it is a short list:
 *
 *   - THE SAME VERDICT, from the same function. The heading's word and the
 *     sentence under it are `verdictWord` and `sentence`, byte for byte what
 *     the terminal prints. A second wording would be a second gate.
 *   - PLAIN SENTENCE FIRST. The verdict reads as English before any term is
 *     named, and the term that follows carries its definition on the same
 *     screen — this is a surface of its own, opened by people who never ran
 *     the command, so it owes the gloss on its own account.
 *   - TWO CUTS, NEVER BLURRED. The verdict is about the comprehension line;
 *     the paths under it are the DARK list, which is a different predicate.
 *     They are labelled as such, because a heading that implied the three
 *     files caused the number would be inventing a cause.
 *   - A RECORD, NEVER A MIND. Every clause under a path is read off the file's
 *     own engagement record, through the same `whyDark` the card prints.
 *
 * NOT WRAPPED, and no ANSI. Markdown reflows on its own, and a hard-wrapped
 * table or bullet list is a paste that renders wrong. The term handle exists
 * for the glyphs and nothing else.
 */
export function renderCheckMarkdown(
  reading: RepoReading,
  verdict: CheckVerdict,
  meta: RenderMeta,
): string[] {
  const term = markdownTerm();
  const dot = term.glyph("dot");
  const lines = [
    `## fathohm check ${term.glyph("dash")} ${verdictWord(verdict)}`,
    "",
    // WHAT WAS READ, AND WHEN. A verdict pasted into a thread outlives the
    // terminal that produced it, and one with no subject and no clock on it is
    // a percentage somebody will quote next quarter about a repository that
    // has moved. Same three parts every card's header carries.
    `*${meta.target} ${dot} ${isoSeconds(reading.now)} ${dot} scorer ${meta.scorerVersion}*`,
    "",
  ];

  if (verdict.indeterminate) {
    lines.push(noVerdict(term), "", ...footer(reading, verdict, term));
    return lines;
  }

  lines.push(sentence(verdict, term), "");
  // The label, after the reading of it — the card's order, and the copy rule's.
  lines.push(`${DEBT_GLOSS}`, "");

  const rows = darkFiles(reading).slice(0, MARKDOWN_PATHS);
  if (rows.length > 0) {
    lines.push(
      `**Where the dark code is** ${term.glyph("dash")} no human wrote or prompted these in ` +
        `the last ${DARK_WINDOW_DAYS} days. A different cut from the line above, and the ` +
        `first ${countWord(rows.length)} the reading names, in its own order (group, then ` +
        `application code, then bytes):`,
      "",
      ...rows.map(
        (file) => `- \`${file.path}\` ${term.glyph("dash")} ${whyDark(file, reading.now, term)}`,
      ),
      "",
    );
  }

  lines.push(...footer(reading, verdict, term));
  return lines;
}

/** Three, because a pasted comment is read whole or not at all. The full list
 *  is one command away and the footer prints the command. */
const MARKDOWN_PATHS = 3;

/**
 * The closer: how to reproduce THIS verdict, and what the reading could not
 * see.
 *
 * The reproduction line carries the gate's own flags for the same reason the
 * terminal's ladder pointer does — a command that hands the reader different
 * numbers than the comment they are reading is worse than no command. The
 * lower-bound line is the permanent provenance sentence, unabridged: a verdict
 * that travels away from the terminal takes its caveats with it or it stops
 * being evidence.
 */
function footer(reading: RepoReading, verdict: CheckVerdict, term: Term): string[] {
  const flags = [`--max-blind ${verdict.threshold}`];
  if (verdict.bound === "floor") flags.push("--pessimistic");
  for (const match of reading.withoutMatches) flags.push(`--without ${quoteArg(match.query)}`);
  return [
    "---",
    "",
    `Reproduce it on any clone: \`npx fathohm check ${flags.join(" ")}\` ` +
      `${term.glyph("dash")} git metadata only, no network, nothing written.`,
    "",
    "Authorship is declared, not detected: undeclared agent work reads as human. " +
      `Git records no pull-request reviews; the hosted reading does — ${HOSTED_URL}`,
  ];
}

/**
 * The handle markdown is composed with: unicode glyphs, no colour, no column.
 *
 * The same call `html-map.ts` makes for the page it writes, and for the same
 * reason — the terminal's width and its escapes are facts about a terminal,
 * and this output is going somewhere else.
 */
function markdownTerm(): Term {
  return createTerm({ noColor: true, ascii: false, env: {}, isTTY: false, columns: WIDE });
}

/** Wide enough that nothing wraps: markdown does its own reflowing. */
const WIDE = 10_000;
