import { exactBlindShare } from "../../../lib/blind-share-format";
import { BLIND_SPOT_THRESHOLD, WEIGHTS } from "../../../lib/demo-data";
import { withinLimit, type CheckBound } from "./check";
import { byDisplayOrder } from "./kind";
import { reviewedBlindBytes, reviewedScore } from "./counterfactual";
import type { RepoReading, ScoredFile } from "./scoring";

/**
 * `fathohm paydown` — what a recorded review would return, one rung at a time.
 *
 * THERE IS NO SCORING IN THIS FILE, and no new mechanic either. The reading
 * card already closes on one sentence of this shape — "a recorded, commented
 * review of the 5 files above re-scores this repo 75% → 71%" — computed by
 * giving those files the review record git cannot see and running
 * `scoreFromFactors` again. This command is that single sentence turned into a
 * ladder, and every number on it comes out of the same two functions the card's
 * closer already uses.
 *
 * WHAT A RUNG IS. Rung N is the reading re-scored with a recorded, commented
 * review on the first N files of the ladder — cumulative, and re-tested file by
 * file against the line. It is not an extrapolation from rung one, and it is
 * not a per-file delta added up: reviewing two files can move fewer bytes than
 * the sum of what each would move alone is a shape the arithmetic has to be
 * incapable of getting wrong, so the arithmetic is never done that way.
 *
 * WHAT THE LADDER IS ORDERED BY. `byDisplayOrder` — the ledger's order, the
 * ordinal argument's order, the picker's order: application code ahead of
 * scaffolding, tests and styles last, bytes descending inside a tier. It is NOT
 * ordered by "fewest files to reach a target", and nothing here calls it the
 * cheapest or the shortest path, because a byte-greedy set would reach a given
 * share in fewer files and that claim would be refutable from the same clone.
 * What the card promises is what this order actually is.
 *
 * WHAT REVIEW CANNOT DO, SAID OUT LOUD. Full review credit is a bounded amount
 * of credit, so a file that is agent-authored and faded far enough stays below
 * the line with the whole of it. Those files are counted, weighed and printed
 * as their own section rather than quietly dropped — a ladder that only showed
 * the files it could move would be the command lying by omission about the ones
 * it could not.
 *
 * NO EFFORT, NO COST, NO TIME. Nothing here estimates how long a review takes,
 * how hard a file is, or what a rung is worth in anybody's afternoon. Git
 * carries no evidence for any of it, and a number with no evidence behind it on
 * a card whose only asset is checkability is worse than no number.
 */

/**
 * WHETHER A RECORDED REVIEW CLEARS THE LINE ON ITS OWN — computed from the two
 * constants, never asserted.
 *
 * It is true today: review depth carries the heaviest weight in `lib/demo-data`
 * and the line sits below it, so `score ≥ w(review)` the moment the record
 * exists, whatever the rest of a file's factors say. Which means the remainder
 * section below is EMPTY on every repository this version can read — and the
 * card says so as a fact about the scorer rather than pretending to have
 * checked something.
 *
 * It is not a fact about fathohm. Move the line above the review weight and
 * this goes false, the remainder starts filling, and the card starts printing
 * the other sentence — without anyone having to remember that it should. The
 * same treatment `holdsAtCeiling` gets in `./fade`, for the same reason.
 */
export const REVIEW_CLEARS_THE_LINE = WEIGHTS.human_review_depth >= BLIND_SPOT_THRESHOLD;

/** A count of files, their bytes, and their share of the scored code. */
export interface PaydownTally {
  readonly files: number;
  readonly bytes: number;
  /** Share of the reading's scored bytes, 0–100. */
  readonly share: number;
}

/** One rung: the whole reading, re-scored with N files reviewed. */
export interface PaydownRung {
  /** How many files of the ladder this rung covers. Cumulative. */
  readonly files: number;
  /** The reading's floor share with those files reviewed, 0–100. */
  readonly floor: number;
  /** The same reading's ceiling share, 0–100. */
  readonly ceiling: number;
  /**
   * The blind bytes at each end. Carried beside the shares because `check`
   * compares bytes against its limit and never a rounded percentage — a rung
   * that claimed to pass a gate has to be right about it at 39.6% against 40.
   */
  readonly floorBlindBytes: number;
  readonly ceilingBlindBytes: number;
}

/**
 * The reader's own gate, and where on this ladder it starts passing.
 *
 * Null when nothing — no `--max-blind`, no `.fathohm.toml` — has said what this
 * repository's limit is. fathohm has no default limit and will not invent one
 * here: a rung named as "where your build goes green" against a threshold this
 * product chose would be a claim about somebody else's tolerance.
 */
export interface PaydownGate {
  readonly threshold: number;
  /** Which end `check` reads: its default ceiling, or `--pessimistic`'s floor. */
  readonly bound: CheckBound;
  readonly passesToday: boolean;
  /**
   * The cumulative file count of the first rung whose reading is inside the
   * limit — 0 when it already passes, null when no rung on the ladder reaches
   * it. Null is never "impossible": the ladder stops at ten rungs, and a repo
   * may cross with twelve.
   */
  readonly passesAt: number | null;
}

export interface PaydownReading {
  /** The reading the ladder was computed on — already carrying any baseline. */
  readonly reading: RepoReading;
  /** Both ends as they stand: rung zero. Shares, 0–100. */
  readonly before: { readonly floor: number; readonly ceiling: number };
  /** Every liftable file, in the card's print order. Uncapped; the card defers. */
  readonly ladder: readonly ScoredFile[];
  readonly rungs: readonly PaydownRung[];
  /** The ladder, weighed. */
  readonly liftable: PaydownTally;
  /** Below the line, and still below it with full review credit. */
  readonly unliftable: PaydownTally;
  readonly gate: PaydownGate | null;
}

export interface PaydownOptions {
  /** `check`'s limit, from `--max-blind` or the config, or null when neither. */
  readonly maxBlind: number | null;
  /** `check --pessimistic`: the gate reads the floor instead of the ceiling. */
  readonly pessimistic: boolean;
}

/**
 * The rungs a ladder of this length gets: 1, 3, 5, 10, each capped at what
 * there is.
 *
 * Capped rather than dropped, so a repository with four liftable files ends its
 * ladder on four rather than on three and leaves the reader to wonder what the
 * fourth would do. Deduplicated, because two rungs of the same size are the
 * same rung printed twice.
 */
export const RUNG_SIZES: readonly number[] = [1, 3, 5, 10];

export function rungSizes(ladderLength: number): number[] {
  if (ladderLength <= 0) return [];
  const sizes: number[] = [];
  for (const size of RUNG_SIZES) {
    const capped = Math.min(size, ladderLength);
    if (!sizes.includes(capped)) sizes.push(capped);
  }
  return sizes;
}

/**
 * The whole ladder for one reading. Pure: no extract, no clock, no terminal.
 *
 * `offboard` needs the extract because its simulation is the scorer run over a
 * different event set. This one does not: nothing about the history changes,
 * only the review record — which is a factor, not an event — so the reading the
 * caller already computed is the only input there is. That is also what makes a
 * `--without` baseline compose for free: the reading handed in is the composed
 * one, and every rung is a rung of THAT repository.
 */
export function paydownReading(
  reading: RepoReading,
  options: PaydownOptions,
): PaydownReading {
  const ladder: ScoredFile[] = [];
  const unliftable: ScoredFile[] = [];
  for (const file of reading.files) {
    if (file.floor >= BLIND_SPOT_THRESHOLD) continue;
    if (reviewedScore(file) >= BLIND_SPOT_THRESHOLD) ladder.push(file);
    else unliftable.push(file);
  }
  ladder.sort(byDisplayOrder);

  const rungs = rungSizes(ladder.length).map((files) =>
    rungAt(reading, ladder.slice(0, files), files),
  );

  return {
    reading,
    before: {
      floor: exactBlindShare(reading.floorBlindBytes, reading.scoredBytes),
      ceiling: exactBlindShare(reading.ceilingBlindBytes, reading.scoredBytes),
    },
    ladder,
    rungs,
    liftable: tally(ladder, reading.scoredBytes),
    unliftable: tally(unliftable, reading.scoredBytes),
    gate: gateOf(reading, rungs, options),
  };
}

function rungAt(
  reading: RepoReading,
  reviewed: readonly ScoredFile[],
  files: number,
): PaydownRung {
  const floorBlindBytes = reviewedBlindBytes(reading, reviewed, "floor");
  const ceilingBlindBytes = reviewedBlindBytes(reading, reviewed, "ceiling");
  return {
    files,
    floor: exactBlindShare(floorBlindBytes, reading.scoredBytes),
    ceiling: exactBlindShare(ceilingBlindBytes, reading.scoredBytes),
    floorBlindBytes,
    ceilingBlindBytes,
  };
}

function tally(files: readonly ScoredFile[], scoredBytes: number): PaydownTally {
  let bytes = 0;
  for (const file of files) bytes += file.bytes;
  return { files: files.length, bytes, share: exactBlindShare(bytes, scoredBytes) };
}

/**
 * Where the reader's own gate starts passing — through `check`'s own
 * comparison, not a second one.
 *
 * The bound is the one `check` would actually read: its default ceiling, or the
 * floor under `--pessimistic`. Both ends fall as files are reviewed (credit
 * only ever raises a score), so the first rung inside the limit is the answer
 * and there is no later rung that undoes it.
 */
function gateOf(
  reading: RepoReading,
  rungs: readonly PaydownRung[],
  options: PaydownOptions,
): PaydownGate | null {
  if (options.maxBlind === null) return null;
  const threshold = options.maxBlind;
  const bound: CheckBound = options.pessimistic ? "floor" : "ceiling";
  const blindBytes = (rung: PaydownRung): number =>
    bound === "floor" ? rung.floorBlindBytes : rung.ceilingBlindBytes;

  const today = bound === "floor" ? reading.floorBlindBytes : reading.ceilingBlindBytes;
  const passesToday = withinLimit(today, reading.scoredBytes, threshold);
  const first = rungs.find((rung) =>
    withinLimit(blindBytes(rung), reading.scoredBytes, threshold),
  );

  return {
    threshold,
    bound,
    passesToday,
    passesAt: passesToday ? 0 : (first?.files ?? null),
  };
}
