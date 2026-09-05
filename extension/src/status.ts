import {
  isDegenerate,
  type RepoReading,
  type ScoredFile,
} from "../../cli/src/reading/scoring";
import {
  DARK_WINDOW_DAYS,
  darkReasonOf,
  newestContact,
  type DarkReasonId,
} from "../../cli/src/reading/dark";
import { exactBlindShare, formatBlindShare } from "../../lib/blind-share-format";
import { scoreColor } from "../../lib/palette";
import { contactLine, promptedOnlyLine, relativeAge } from "../../lib/reading-explained";

/**
 * Every string the extension puts on a screen, as pure functions.
 *
 * Nothing here imports `vscode` and nothing here reads a clock. The extension
 * host module is the one place that owns a `Date`, a status-bar item and a
 * terminal; this file owns the words, which means the words can be pinned by a
 * test runner that has no editor anywhere in the picture.
 *
 * ── WHICH NUMBER THIS IS, CHANGED 2026-08-25 ────────────────────────────────
 *
 * The status bar used to headline the COMPREHENSION-DEBT FLOOR, and the CLI
 * card stopped headlining it at 1.5.0. `extension/README.md` had carried the
 * mismatch as an open follow-up ever since. It is closed here: both surfaces
 * now lead with the DARK SHARE, and they get it from the same `darkBytes` the
 * same scorer summed, so the terminal and the status bar cannot be two
 * readings of one repository.
 *
 * The reason is not tidiness. The floor share is one end of an INTERVAL — 4%
 * to 72% on a real repository — because `human_review_depth` carries 0.40 of
 * the score and git records no reviews. A status bar has room for one number
 * and no room for a hedge, so it was printing the top of that interval as
 * though it were the reading. Cover the label on `fathohm 72%` and a stranger
 * reads a catastrophe that the evidence does not support in either direction.
 * The dark share has no interval in it: `human_author_recency === 0` is a fact
 * git settles exactly, so one number is the honest whole of it.
 *
 * ── THE COVERED-LABEL RULE ──────────────────────────────────────────────────
 *
 * Cover "fathohm" and `59% dark` still says which way is bad news, which is
 * what the rule asks of a label. What it cannot say in the width of a status
 * bar is 59% of WHAT, measured HOW — so every surface that shows it also
 * carries {@link coveredLabelGloss}, the plain sentence that survives the
 * cover. It is the FIRST block of both tooltips, before any arithmetic,
 * because a reader who never opens the rest still gets the claim. The gloss
 * itself carries no metaphor at all: plain sentence first, and the one
 * metaphor word earns its place beside it in the label or loses it.
 *
 * ── WHAT THE SENTENCE MAY CLAIM ─────────────────────────────────────────────
 *
 * "no human wrote or prompted it in the last 180 days" is a statement about
 * the RECORD, and it is checkable against the same clone with `git log`. It is
 * not "no human understands it", which is a claim about the contents of
 * people's heads that no experiment could falsify. It is also not a
 * comprehension-debt reading and never stands in for one — the two do not
 * correlate, and saying so is the second block of the workspace tooltip.
 */

/**
 * The one sentence the extension repeats wherever it speaks. Verbatim in the
 * README, verbatim in the footer of both tooltips — the extension inherits the
 * CLI's verifiable-offline story and must never add the network call, the
 * telemetry ping or the content read that would make this line false.
 */
export const TRUST_LINE =
  "reads your local git history — metadata only, never file contents, no network";

/**
 * Whether this reading has anything to show at all. Shared with the card's own
 * gate rather than re-derived: an empty repository, a tree with no code in it
 * and a zero-byte denominator are the three shapes that would put "0%" on a
 * screen, and "0% dark" on a repo that was never read is the one claim the
 * status bar must never make.
 */
export function hasReading(reading: RepoReading): boolean {
  return !isDegenerate(reading);
}

/**
 * The dark share as a percent (0..100) — `darkBytes` over the scored bytes,
 * the same division the card's big number goes through. Not re-derived from
 * the files here: a second derivation would be free to disagree with the
 * terminal the moment either side learned a new event kind.
 */
export function darkShare(reading: RepoReading): number {
  return exactBlindShare(reading.darkBytes, reading.scoredBytes);
}

/**
 * The dark share as TEXT, through the shared formatter — so the display floors
 * travel with it. 0.4% prints `<1%` rather than `0%`, which would erase the
 * finding at exactly the moment it first appears, and 99.6% prints `>99%`
 * rather than `100%`, which would claim a repository nobody has touched any
 * of. The CLI card refuses those two roundings and so must the status bar,
 * because they are the same reading.
 */
export function darkShareText(reading: RepoReading): string {
  return formatBlindShare(darkShare(reading));
}

/** The workspace item: the repo's dark share, named. */
export function repoStatusText(reading: RepoReading): string {
  return `fathohm ${darkShareText(reading)} dark`;
}

/**
 * The colour, off the public ramp `scoreColor` buckets — the same function the
 * terminal's `depthColor` and the gallery's cells go through, so a status bar
 * and a Map cell at the same depth can never disagree. The argument is
 * `1 − share`, because the ramp's red pole is the deep end and a high dark
 * share is a deep repository. The card passes `1 − dark` to `depthColor` for
 * the same reason.
 */
export function repoStatusColor(reading: RepoReading): string {
  return scoreColor(1 - darkShare(reading) / 100);
}

/**
 * The active-file item — a STATE, not a score.
 *
 * The repository number is a byte-weighted share; a single file has no share
 * of itself, it is dark or it is lit. Printing `this file 0.08` beside
 * `fathohm 59% dark` was two different measurements in adjacent items with
 * nothing saying so, and the 0.08 was a comprehension-debt score the headline
 * no longer reports.
 *
 * The age is the age of the NEWEST human contact, hand-written or prompted,
 * whichever is later — the same most-favourable-claim-that-is-still-true
 * convention `darkReasonOf` classifies on. A file with no human contact at all
 * says so rather than printing an age it does not have.
 */
export function fileStatusText(reading: RepoReading, file: ScoredFile): string {
  const reason = darkReasonOf(file);
  if (reason === "lit") return "this file · lit";
  if (reason === "never") return "this file · dark, no human contact";
  const contact = newestContact(file.factors.engagement);
  return contact === null
    ? "this file · dark"
    : `this file · dark, last touched ${relativeAge(contact, reading.now)}`;
}

/**
 * Two poles, not a ramp. The file item reports a boolean, so a continuous
 * colour would imply a precision the state does not carry.
 */
export function fileStatusColor(file: ScoredFile): string {
  return scoreColor(darkReasonOf(file) === "lit" ? 1 : 0);
}

/**
 * The file the editor is focused on, IF this reading scored it — and null
 * otherwise, which is what hides the chip.
 *
 * Exact path match only. A reading's denominator is the code files in the
 * tree, filtered by the hosted `isCodeFile` choke point; a README, a lockfile,
 * an untracked scratch file and anything a `.fathohm.toml` excluded are all
 * legitimately absent, and guessing a nearest neighbour for them would put a
 * number beside a file the number is not about.
 */
export function fileInReading(reading: RepoReading, relativePath: string): ScoredFile | null {
  return reading.files.find((file) => file.path === relativePath) ?? null;
}

/**
 * A workspace-relative path in git's spelling, or null when the document is
 * not under the folder at all.
 *
 * Both arguments are filesystem paths, and the comparison is byte-exact after
 * separator normalisation: git's index is case-sensitive even where the
 * filesystem underneath it is not, so a case-folded match here would pair
 * `src/App.ts` with a reading of `src/app.ts` and print the wrong file's score.
 * A miss hides the chip, which is the honest outcome.
 */
export function relativeRepoPath(root: string, file: string): string | null {
  const base = toPosix(root).replace(/\/+$/, "");
  const target = toPosix(file);
  if (base === "" || !target.startsWith(`${base}/`)) return null;
  const relative = target.slice(base.length + 1);
  return relative === "" ? null : relative;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * THE PLAIN SENTENCE. The share, then what the share is a share OF, then the
 * kind of evidence it rests on — record, not survey.
 */
export function coveredLabelGloss(share: string): string {
  return (
    `${share} of this code: no human wrote or prompted it in the last ` +
    `${DARK_WINDOW_DAYS} days — measured from the record, not a survey.`
  );
}

/**
 * The workspace item's tooltip, as markdown blocks (the caller joins them).
 *
 * The gloss, then what this number is NOT, then what was read.
 *
 * The second block used to be the other end of an interval. There is no
 * interval any more, and the honest replacement is not silence: a reader who
 * has just been handed an exact percentage will assume it is the whole story,
 * and it is exactly half of one. Git records authorship and not reviews, so a
 * file can be dark here and have been read closely by three people last week.
 * Saying that in the tooltip is the same refusal the card makes at length —
 * the dark share is not a comprehension-debt reading and never stands in for
 * one.
 */
export function repoTooltip(reading: RepoReading, repoName: string): string[] {
  const files = reading.files.length;
  return [
    coveredLabelGloss(darkShareText(reading)),
    `This number has no range in it — git settles authorship exactly. It says ` +
      `nothing about whether anyone has READ this code: git keeps no review ` +
      `record at all, so a dark file may have been read closely last week.`,
    `${files} code ${files === 1 ? "file" : "files"} in \`${repoName}\`, weighed by the bytes ` +
      `git reported.`,
    `_${TRUST_LINE}_`,
  ];
}

/**
 * The active-file item's tooltip: the same gloss, then why THIS file is dark
 * or lit, then its two contacts.
 *
 * The four-factor decomposition used to live here and does not any more. It
 * decomposed a comprehension-debt score, and the extension no longer reports
 * one — a decomposition of a number nothing else on the surface shows is worse
 * than no decomposition, because it invites the reader to treat it as the
 * reading. The bright line it existed to serve is not weakened: this tooltip
 * shows no score, and the state it does show is fully evidenced by the two
 * contact dates and the window, both printed here. `Fathohm: Explain This
 * File` still prints the factors, and the CLI card is where a score belongs.
 *
 * The second block exists because the gloss's "this code" means the
 * REPOSITORY. In a tooltip hanging off one file, that has to be said out loud
 * before the file's own state arrives.
 */
export function fileTooltip(reading: RepoReading, file: ScoredFile): string[] {
  const blocks = [
    coveredLabelGloss(darkShareText(reading)),
    "That share is the whole repository. This file:",
    `\`${file.path}\` — ${reasonClause(darkReasonOf(file))}`,
  ];

  const contact = [contactLine(file.factors.engagement, reading.now)];
  const prompted = promptedOnlyLine(file.factors.engagement);
  if (prompted !== null) contact.push(prompted);
  blocks.push(contact.join("  \n"));

  blocks.push(
    "Run **Fathohm: Explain This File** for the same reading factor by factor.",
    `_${TRUST_LINE}_`,
  );
  return blocks;
}

/**
 * Why this file reads the way it does, in the CLI ledger's own four cases.
 *
 * `lit` is a member of the partition rather than the absence of the other
 * three, for the same reason it is one in `DARK_REASON_ORDER`: a state
 * computed as "not any of the above" is a remainder, and a remainder cannot be
 * explained to the reader looking at it.
 */
function reasonClause(reason: DarkReasonId): string {
  switch (reason) {
    case "lit":
      return `a human wrote or prompted it inside the last ${DARK_WINDOW_DAYS} days.`;
    case "faded-hand":
      return `gone dark — a human wrote it by hand, and that was more than ` +
        `${DARK_WINDOW_DAYS} days ago.`;
    case "faded-prompted":
      return `gone dark — a human last reached it by prompting an agent, and that was ` +
        `more than ${DARK_WINDOW_DAYS} days ago.`;
    case "never":
      return `gone dark — no human has ever written or prompted it on this record.`;
  }
}

/**
 * The command the terminal is handed. The CLI card IS the UI — the extension
 * shells out to the real `fathohm` rather than redrawing it, so the number in
 * the status bar and the card in the terminal can never be two readings.
 *
 * Quoted, because a repository path may contain a space. Single quotes on
 * POSIX shells (and PowerShell); double quotes on Windows, where `cmd.exe` has
 * no single-quote form at all.
 */
export function explainCommandLine(relativePath: string, windows: boolean): string {
  return `npx fathohm explain ${quoteArgument(relativePath, windows)}`;
}

function quoteArgument(value: string, windows: boolean): string {
  return windows
    ? `"${value.replace(/"/g, '""')}"`
    : `'${value.replace(/'/g, "'\\''")}'`;
}
