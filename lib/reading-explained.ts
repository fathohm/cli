// lib/reading-explained.ts
//
// THE READING, EXPLAINED — the headline's own decomposition, in words.
//
// The `why?` popover already shows the ARITHMETIC: four factors, four weights,
// a weighted sum. What it cannot say is the SEMANTICS — what kind of engagement
// is missing from this codebase, and what would supply it. After scoring v2
// went live the founder had to ask an assistant, in chat, why a repo read
// ">99%": only three files hand-touched inside the two-month window, everything
// else prompted-only at quarter credit. That story was derivable the whole time
// (every v1+ score row carries `factors.engagement`) and nothing rendered it. A
// trust product whose headline needs a human interpreter is failing its own
// bright line.
//
// So this module partitions the SAME scored files the headline is computed from
// into buckets, each carrying its file count and byte share, and turns each into
// one sentence whose every number is derived. Pure, deterministic, no clock of
// its own (`now` is a parameter), no IO.
//
// Two rules this file exists to keep:
//
//   1. ONE DENOMINATOR. The input is the already-filtered `FileEntry[]` from
//      the isCodeFile + repo_tree choke point — the identical array
//      `computeHeadline` is handed. Shares are of SCORED bytes, exactly like
//      the headline. A second read here would be a second denominator, and two
//      denominators on one screen is the bug PR #25 was written to end.
//
//   2. NEVER HAND-WRITE A CLAIM THE CODE CAN COMPUTE. Percentages, file counts,
//      day-ages and the review-lift arithmetic all come out of the buckets. The
//      only literals in these sentences are the RULES themselves ("a quarter of
//      one engaged person", "the two-month window"), which are statements of
//      methodology, not measurements of this repo.
import {
  BLIND_SPOT_THRESHOLD,
  WEIGHTS,
  scoreFromFactors,
  type Engagement,
  type Factors,
  type StoredFactors,
} from "./demo-data";
import { formatBlindShare } from "./blind-share-format";
import type { FileEntry } from "./map-tree";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * WHAT "THE COMPREHENSION LINE" MEANS, in one clause, in words a stranger can
 * parse without a legend.
 *
 * The term itself is kept deliberately — it is the category name, it is what
 * people search for, and retiring it would cost the positioning. The rule is
 * only that it never travels alone: every surface that prints the term prints
 * this clause beside it, always visible, never behind a tooltip or a link.
 *
 * One constant, so the CLI's cards cannot drift into two different definitions
 * of the same line. It describes the RECORD — never what anyone understands —
 * because that is the thing actually measured.
 */
export const LINE_GLOSS = "no human has recently written, reviewed, or explained it";

/**
 * THE CANONICAL GLOSS — the definition every surface owes the term at its first
 * prominent use (CLAUDE.md, "Copy rule").
 *
 * One constant because it is one sentence, and two surfaces that wrote it out
 * by hand would eventually be two definitions of the category we are trying to
 * be the instrument for. The second clause is not decoration: "measured from the
 * record, not a survey" is the whole difference between this definition and
 * Addy Osmani's, which turns on whether anybody "genuinely understands" the
 * code and is therefore unmeasurable. He named the thing; this sentence is what
 * makes it a number.
 */
export const DEBT_GLOSS =
  "Comprehension debt: code no human has recently written, reviewed, or explained " +
  "— measured from the record, not a survey.";

export type BucketId =
  | "above"
  | "prompted-only"
  | "no-human"
  | "faded"
  | "thin-contact"
  | "unexplained";

/**
 * The CLASSIFICATION order — first match wins, and the partition is total.
 *
 * `unexplained` comes first on purpose. A row stamped before scoring v1 has no
 * engagement record at all, and its four factors would classify it perfectly
 * well — which is exactly the temptation. Reading a story out of a lens that
 * never recorded one is guessing, and this product's only asset is that it
 * does not guess.
 *
 * Doubles as the deterministic tie-break when two buckets hold equal bytes.
 */
export const BUCKET_ORDER: readonly BucketId[] = [
  "unexplained",
  "above",
  "prompted-only",
  "no-human",
  "faded",
  "thin-contact",
];

/** The buckets that sit BELOW the fathom line — the ones a mover line can
 *  address. `unexplained` is deliberately absent: we do not know which side of
 *  the line those bytes are on, so we cannot offer to move them. */
const BELOW_LINE: readonly BucketId[] = ["prompted-only", "no-human", "faded", "thin-contact"];

/** Why the files above the line are above it, by dominant factor contribution. */
export type AboveReason = "review" | "verified" | "fresh";

export interface Bucket {
  id: BucketId;
  fileCount: number;
  bytes: number;
  /** Share of SCORED bytes, 0..1 — the headline's own denominator. */
  share: number;
  /** `above` only: which factor's weighted contribution is largest. */
  aboveReason?: AboveReason;
  /**
   * `faded` only: the age in days of the NEWEST `last_hand_authored` in the
   * bucket. The newest, not the oldest, because every other file here is older
   * — so "N+ days" is the most favourable claim that is still true, and the
   * sentence can never overstate the staleness.
   */
  handAgeDays?: number;
  /**
   * Below-line buckets only: the bucket's MEDIAN score after a substantive
   * human review (`human_review_depth → 1`), recomputed through the real
   * scorer. This is the "≈0.5" in the mover line — computed, never quoted, and
   * the same arithmetic lib/map-insights' review simulation runs, so the two
   * surfaces cannot promise different lifts for the same files.
   */
  reviewLift?: number;
}

export interface ReadingExplanation {
  /** Non-empty buckets only, byte-share descending. An empty bucket renders
   *  nothing at all — "0 files were prompted" is noise, not information. */
  buckets: Bucket[];
  /** The largest below-line bucket: the one the closing mover line addresses.
   *  Null when nothing sits below the line (or nothing is explainable). */
  mover: Bucket | null;
  scoredFileCount: number;
  scoredBytes: number;
}

/**
 * Which bucket one file belongs to, or null when it is not scored at all.
 *
 * Unscored files are NOT a bucket. They are the note's own final line, and
 * folding them in would put unmeasured bytes inside a measured denominator.
 */
export function bucketOf(file: FileEntry): BucketId | null {
  if (file.score === null) return null;
  const factors = file.factors;
  const engagement = factors?.engagement;
  // No factors (defensive) or no engagement record: explainable only by guessing.
  if (!factors || !engagement) return "unexplained";
  if (file.score >= BLIND_SPOT_THRESHOLD) return "above";
  const { full, prompted } = engagement.contributors;
  // "Nobody engaged": no full contributor, no substantive review, never
  // explained back. What separates the next two buckets is whether a human was
  // in the loop at all — prompting is contact, even if it is quarter credit.
  const noEngagement =
    full === 0 && factors.human_review_depth === 0 && factors.question_answerability === 0;
  if (noEngagement && prompted > 0) return "prompted-only";
  if (noEngagement && prompted === 0) return "no-human";
  if (full > 0) return "faded";
  // The residual — reviewed once and shallowly, say. The partition must be
  // exhaustive: a file that fits nothing would be a silent drop, and a silent
  // drop is how a denominator starts lying.
  return "thin-contact";
}

/**
 * Partition the headline's own file set into buckets.
 *
 * `files` MUST be the array `computeHeadline` is handed — that is the whole
 * parity guarantee. `now` is a parameter so the derivation stays pure and the
 * day-ages are testable.
 */
export function explainReading(files: FileEntry[], now: Date): ReadingExplanation {
  const members = new Map<BucketId, FileEntry[]>();
  let scoredBytes = 0;
  let scoredFileCount = 0;

  for (const file of files) {
    const id = bucketOf(file);
    if (id === null) continue;
    scoredBytes += file.size;
    scoredFileCount += 1;
    const list = members.get(id);
    if (list) list.push(file);
    else members.set(id, [file]);
  }

  const buckets = BUCKET_ORDER.filter((id) => (members.get(id)?.length ?? 0) > 0)
    .map((id) => buildBucket(id, members.get(id) as FileEntry[], scoredBytes, now))
    // Byte-share order for reading; rule order breaks a tie, so the same rows
    // always produce the same list.
    .sort((a, b) => b.bytes - a.bytes || BUCKET_ORDER.indexOf(a.id) - BUCKET_ORDER.indexOf(b.id));

  return {
    buckets,
    mover: buckets.find((b) => BELOW_LINE.includes(b.id)) ?? null,
    scoredFileCount,
    scoredBytes,
  };
}

function buildBucket(id: BucketId, files: FileEntry[], scoredBytes: number, now: Date): Bucket {
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  const bucket: Bucket = {
    id,
    fileCount: files.length,
    bytes,
    share: scoredBytes > 0 ? bytes / scoredBytes : 0,
  };
  if (id === "above") bucket.aboveReason = dominantAboveReason(files);
  if (id === "faded") {
    const days = newestHandAgeDays(files, now);
    if (days !== null) bucket.handAgeDays = days;
  }
  if (BELOW_LINE.includes(id)) bucket.reviewLift = medianReviewLift(files);
  return bucket;
}

/** Factor → the reason its dominance names. Iterated in THIS order so an exact
 *  tie resolves the same way every time. */
const ABOVE_REASONS: ReadonlyArray<{ factor: keyof Factors; reason: AboveReason }> = [
  { factor: "human_review_depth", reason: "review" },
  { factor: "question_answerability", reason: "verified" },
  { factor: "human_author_recency", reason: "fresh" },
  { factor: "bus_factor", reason: "fresh" },
];

/** The largest byte-weighted contribution (`mean × weight`) among the four
 *  factors, mapped to the reason it names. Byte-weighted because the headline
 *  is: a four-line config must not out-vote a four-thousand-line parser. */
function dominantAboveReason(files: FileEntry[]): AboveReason {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let best: AboveReason = ABOVE_REASONS[0].reason;
  let bestContribution = -Infinity;
  for (const { factor, reason } of ABOVE_REASONS) {
    let weighted = 0;
    for (const f of files) {
      if (!f.factors) continue;
      weighted += f.factors[factor] * f.size;
    }
    const contribution = (totalBytes > 0 ? weighted / totalBytes : 0) * WEIGHTS[factor];
    if (contribution > bestContribution) {
      bestContribution = contribution;
      best = reason;
    }
  }
  return best;
}

function newestHandAgeDays(files: FileEntry[], now: Date): number | null {
  let newest: number | null = null;
  for (const f of files) {
    const iso = f.factors?.engagement?.last_hand_authored;
    if (!iso) continue;
    const at = new Date(iso).getTime();
    if (!Number.isFinite(at)) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest === null ? null : ageInDays(newest, now);
}

/** Whole days between a timestamp and `now`, clamped at zero. A future-dated
 *  event (clock skew, a rebase) reads as "today" rather than as the future —
 *  the same clamp the scorer's decay curve applies. */
export function ageInDays(at: string | number, now: Date): number {
  const at_ms = typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(at_ms)) return 0;
  return Math.max(0, Math.floor((now.getTime() - at_ms) / DAY_MS));
}

/** The median score this bucket's files would carry after one substantive
 *  review — recomputed through `scoreFromFactors`, exactly as the review
 *  simulation does. Median, not mean, so one enormous outlier cannot promise a
 *  lift the typical file will not get. */
function medianReviewLift(files: FileEntry[]): number {
  const lifted = files
    .filter((f): f is FileEntry & { factors: StoredFactors } => f.factors !== null)
    .map((f) => scoreFromFactors({ ...f.factors, human_review_depth: 1 }))
    .sort((a, b) => a - b);
  // Nothing to recompute from: a review is worth its own weight and no more.
  if (lifted.length === 0) return WEIGHTS.human_review_depth;
  const mid = Math.floor(lifted.length / 2);
  return lifted.length % 2 === 1 ? lifted[mid] : (lifted[mid - 1] + lifted[mid]) / 2;
}

// ── the sentences ──────────────────────────────────────────────────────────
//
// Every number below is read off the bucket. What is written by hand is the
// RULE the bucket names — "a quarter of one engaged person" is the scorer's
// engagement unit, "the two-month window" is the v2 decay curve's property.
// Those are methodology, and they are the same sentence for every repo; the
// measurements are never.

const ABOVE_REASON_TEXT: Record<AboveReason, string> = {
  review: "substantive human review is what holds them up",
  verified: "explain-back sessions have verified them",
  fresh: "recent hand-writing is what holds them up",
};

/** One line per non-empty bucket, stating the rule in the methodology's own
 *  vocabulary with this repo's numbers in it. */
export function bucketSentence(bucket: Bucket): string {
  const share = formatBlindShare(bucket.share * 100);
  switch (bucket.id) {
    case "above":
      return (
        `${bucket.fileCount} ${bucket.fileCount === 1 ? "file holds" : "files hold"} above the line — ` +
        `${ABOVE_REASON_TEXT[bucket.aboveReason ?? "fresh"]}. They are ${share} of the scored bytes.`
      );
    case "prompted-only":
      return (
        `${share} of the scored bytes were prompted — written with an agent, never hand-authored ` +
        `and never substantively reviewed. A prompted file counts as a quarter of one engaged person.`
      );
    case "no-human":
      return `${share} of the scored bytes carry no human engagement of any kind — agent and automation events only.`;
    case "faded":
      return bucket.handAgeDays === undefined
        ? `${share} of the scored bytes were hand-written, but the last hand touch is too old to hold them up.`
        : `${share} of the scored bytes were hand-written, but last hand-touched ${bucket.handAgeDays}+ days ago — ` +
            `past the two-month window comprehension holds without review.`;
    case "thin-contact":
      return (
        `${share} of the scored bytes had some human contact, but too little of it — a review too shallow, ` +
        `or too few keepers, to hold them above the line.`
      );
    case "unexplained":
      return (
        `${share} of the scored bytes were scored under an older lens that recorded no engagement — ` +
        `recompute this repository to explain them.`
      );
  }
}

/** What each below-line bucket calls one of its files, in the mover line. */
const MOVER_SUBJECT: Record<BucketId, string> = {
  "prompted-only": "a prompted file",
  "no-human": "a file no human has touched",
  faded: "a faded file",
  "thin-contact": "a thinly-contacted file",
  // Never used — the mover is chosen from BELOW_LINE — but total, so the
  // lookup cannot be the thing that breaks when a bucket is added.
  above: "a file",
  unexplained: "a file",
};

/**
 * The closing line: what would actually move this number, addressed to the
 * biggest below-line bucket. The lift is the bucket's own computed median, so
 * it is a promise this repo's files can keep.
 */
export function moverSentence(bucket: Bucket): string {
  const lift = (bucket.reviewLift ?? WEIGHTS.human_review_depth).toFixed(2);
  return (
    `A substantive review lifts ${MOVER_SUBJECT[bucket.id]} here to ≈${lift}; an explain-back session ` +
    `adds verified comprehension on top. Time alone only lowers this number.`
  );
}

// ── the briefs: the same buckets, at terminal length ───────────────────────
//
// The sentences above are the dashboard's. They have a column to themselves and
// a reader who has already opened a repository, signed in, and met the word
// "comprehension debt". `npx fathohm` has none of that: its card is read once,
// in a scroll-back buffer, by somebody who ran it on a dare. A cold-user test
// found the long forms failing there in three specific ways, and each one is a
// rule these briefs keep:
//
//   1. THEY MUST NOT ASSERT WHAT GIT CANNOT SEE. "never substantively
//      reviewed" is a claim about a review record a `.git` directory does not
//      contain. The honest form is "no review on git's record" — the same fact,
//      attributed to the evidence that carries it.
//   2. THEY MUST NOT QUOTE SCORER INTERNALS. "counts as a quarter of one
//      engaged person" and a bare "≈0.48" are true, decomposable, and useless
//      to a reader five seconds in. What they need is what MOVES the number.
//   3. THEY MUST NOT NAME HOSTED CONCEPTS. An "explain-back session" has no
//      referent for somebody who has not installed anything.
//
// These are compressions, not translations, and they are strictly ADDITIVE:
// nothing above changed, and the dashboard keeps rendering the long forms. What
// does carry over unchanged is the rule that matters — every number is read off
// the bucket, because a hand-written share is the same bug in a smaller font.

/** The above-line reason, without the hosted vocabulary. */
const ABOVE_REASON_BRIEF: Record<AboveReason, string> = {
  review: "a substantive review on record",
  verified: "verified comprehension",
  fresh: "recent hand-authored commits",
};

/**
 * One bucket, one line, share first.
 *
 * Share first because the card is scanned down its left edge: a column of
 * percentages that add to the headline is a decomposition a reader can check
 * at a glance, and a decomposition they can check is the whole trust argument
 * at bullet size.
 *
 * The switch is exhaustive and has no `default`. A new `BucketId` with no brief
 * is a compile error rather than a bucket that silently renders nothing — a
 * partition that drops a member is how a denominator starts lying.
 */
export function bucketBrief(bucket: Bucket): string {
  const share = formatBlindShare(bucket.share * 100);
  switch (bucket.id) {
    case "above": {
      const files = `${bucket.fileCount} ${bucket.fileCount === 1 ? "file" : "files"}`;
      return `${share} above the line — ${ABOVE_REASON_BRIEF[bucket.aboveReason ?? "fresh"]} (${files})`;
    }
    case "prompted-only":
      return `${share} prompted — agent-authored commits only, no review on git's record`;
    case "no-human":
      return `${share} show no human engagement in git's record`;
    case "faded":
      return bucket.handAgeDays === undefined
        ? `${share} faded — hand-written, but not recently enough to score above the line`
        : `${share} faded — last hand-authored commit ${bucket.handAgeDays}+ days ago`;
    case "thin-contact":
      return `${share} thin contact — some human engagement, not enough to score above the line`;
    // Refuses to guess, exactly as the long form does: these rows were scored
    // by a lens that recorded no engagement, and reading a story out of one is
    // the single thing this product does not do.
    case "unexplained":
      return `${share} unexplained — scored under a lens that recorded no engagement; recompute to explain`;
  }
}

/**
 * THE LEDGER HEADER — one bucket, as the heading of a group of file rows.
 *
 * The CLI's card stopped listing five files under one banner and became a
 * LEDGER: one group per bucket, its files under it, and the shares adding up to
 * the headline in print. A group needs a heading, and a heading is a different
 * typographic job from a bullet — it is scanned, not read, so it leads with the
 * finding rather than with the share and it is set in capitals by the caller.
 *
 * WHAT IT MAY NOT DO IS INVENT WORDS. `bucketBrief` above is the CLI's
 * vocabulary for these buckets and the dashboard's long forms are the same
 * vocabulary at length; a third phrasing would mean three surfaces describing
 * one partition in three ways, and the whole reason this module exists is that
 * they cannot. So every clause below appears verbatim in the brief it is drawn
 * from — reordered, never re-coined.
 *
 * THE SHARE IS A PARAMETER, and that is deliberate. Every other sentence here
 * formats its own share from the bucket, because the bucket is the only thing
 * that knows it. The ledger cannot: its percentages are allocated under the
 * PRINTED headline by largest remainder so that the column adds up on screen,
 * which is arithmetic no single bucket can do alone. Passing the text in keeps
 * the vocabulary here and the arithmetic where it belongs, rather than letting
 * this module format a number that would not match the one above it.
 *
 * Exhaustive, no `default`, `above` included: the coda that closes the ledger is
 * this function too, in lower case, because "what is left" is the last line of
 * the same sum.
 */
export function bucketLedgerLine(bucket: Bucket, share: string): string {
  switch (bucket.id) {
    case "above": {
      const files = `${bucket.fileCount} ${bucket.fileCount === 1 ? "file" : "files"}`;
      return (
        `above the line — ${share} of the code · ` +
        `${ABOVE_REASON_BRIEF[bucket.aboveReason ?? "fresh"]} (${files})`
      );
    }
    case "prompted-only":
      return `agent-authored, no review on git's record — ${share} of the code`;
    case "no-human":
      return `no human engagement in git's record — ${share} of the code`;
    case "faded":
      return bucket.handAgeDays === undefined
        ? `hand-written, but not recently enough to score above the line — ${share} of the code`
        : `hand-written, but ${bucket.handAgeDays}+ days ago — ${share} of the code`;
    case "thin-contact":
      return `some human engagement, not enough to score above the line — ${share} of the code`;
    case "unexplained":
      return `scored under a lens that recorded no engagement — ${share} of the code`;
  }
}

/**
 * What acts on the number, in plain words.
 *
 * No score and no arithmetic: the long form's "≈0.48" is a value on a scale the
 * card never shows, and a number without its scale is decoration. What survives
 * the compression is the DIRECTION — one thing lifts, nothing else does, and
 * time only ever sinks.
 *
 * "above the line" is a promise, so it is only made when the bucket's own
 * computed lift actually clears the line. Same value the long form quotes, same
 * fallback: a bucket with nothing to recompute from is worth a review's own
 * weight and no more.
 */
export function moverBrief(mover: Bucket): string {
  const lift = mover.reviewLift ?? WEIGHTS.human_review_depth;
  const reach = lift >= BLIND_SPOT_THRESHOLD ? "above the line" : "most of the way to the line";
  // Prefixed "scoring:" so the line reads as a statement about the model — the
  // one thing it can defensibly be — rather than as advice about what a team
  // should go do.
  return (
    `scoring: a substantive review lifts ${MOVER_SUBJECT[mover.id]} ${reach} — ` +
    `with no new activity a score only decays`
  );
}

// ── per-file contact, for the Map readout ──────────────────────────────────

/**
 * A relative age in the reading voice. Coarse on purpose: the readout is
 * answering "is this recent?", and a precise-looking "37.4 days" implies a
 * precision the underlying event timestamp does not earn.
 */
export function relativeAge(iso: string, now: Date): string {
  const days = ageInDays(iso, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/** Never happened — as opposed to never measured, which is why the whole line
 *  is omitted when there is no engagement record at all. */
const NO_CONTACT = "—";

/** The two contacts a file has ever had, side by side. Only rendered when the
 *  file HAS an engagement record: absent one, the caller omits this entirely
 *  rather than print two dashes that look like a measured zero. */
export function contactLine(engagement: Engagement, now: Date): string {
  const hand = engagement.last_hand_authored ? relativeAge(engagement.last_hand_authored, now) : NO_CONTACT;
  const prompted = engagement.last_prompted ? relativeAge(engagement.last_prompted, now) : NO_CONTACT;
  return `last hand-written: ${hand} · last prompted: ${prompted}`;
}

/** The quarter-credit line, and only when it is true of this file: some people
 *  have touched it, none of them by hand. Null otherwise — a file with a real
 *  contributor must never be told it has none. */
export function promptedOnlyLine(engagement: Engagement): string | null {
  const { full, prompted } = engagement.contributors;
  if (full > 0 || prompted === 0) return null;
  return (
    `${prompted} ${prompted === 1 ? "contributor" : "contributors"} ` +
    `(prompted-only — ${prompted === 1 ? "counts" : "each counts"} as ¼).`
  );
}
