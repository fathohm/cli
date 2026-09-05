import { exactBlindShare } from "../../../lib/blind-share-format";
import { BLIND_SPOT_THRESHOLD, scoreFromFactors } from "../../../lib/demo-data";
import { ceilingFactors } from "./fade";
import type { RepoReading, ScoredFile } from "./scoring";

/**
 * THE COUNTERFACTUAL — what the scorer returns if a review existed.
 *
 * Every leverage, paydown and `check --if-reviewed` sentence is built out of
 * the three functions below, and each one re-runs the real scorer rather than
 * estimating around it. That is why they compute here and not in the file that
 * prints them: a number a reader is invited to check has to come from the same
 * arithmetic the number above it came from, and a printer that did its own
 * subtraction would eventually disagree with the card it sits under.
 *
 * None of this is a claim about how well anything WAS reviewed. It is what the
 * scorer says IF a recorded, commented review existed, and every sentence built
 * on it stays conditional for exactly that reason.
 */

/**
 * ONE FILE'S SCORE WITH THE REVIEW RECORD GIT CANNOT SEE.
 *
 * The counterfactual every leverage and paydown sentence is built out of, in
 * one place. It is `ceilingFactors` — the same "full review credit" the reading
 * card's ceiling is computed from — run through `scoreFromFactors`, the
 * function the dashboard scores with. A second spelling of "the same factors
 * with review depth at one" would eventually disagree with the ceiling on the
 * card above it, about the same file, in the same terminal.
 *
 * It is not an estimate of how well anything was reviewed. It is what the
 * scorer returns IF a recorded, commented review existed, and every sentence
 * built on it is conditional for exactly that reason.
 */
export function reviewedScore(file: ScoredFile): number {
  return scoreFromFactors(ceilingFactors(file.factors));
}

/** Which end of the interval a re-scored reading is being measured at. */
export type ReviewedBound = "floor" | "ceiling";

/**
 * THE BLIND BYTES this repository would carry if the named files had a
 * recorded, commented review on them — at either end of the interval.
 *
 * Recomputed, not estimated, and the distinction is the whole sentence. The
 * leverage line says "recomputed through the same scorer", so this re-tests
 * every file against the line and re-weighs the bytes. Arithmetic that happened
 * to give the same answer would still make the sentence a claim about code that
 * does not exist, and this product's only asset is that its sentences are
 * checkable.
 *
 * BYTES RATHER THAN A SHARE, because `check` compares bytes against its limit
 * and never a rounded percentage. A paydown ladder that told a reader their
 * gate passes at rung three has to be right about it at 39.6% against a limit
 * of 40, which is a question only the integers can answer.
 *
 * AT THE CEILING END a lifted file is scored exactly as it is at the floor end
 * — full review credit is full review credit — while an unlifted file keeps the
 * ceiling it already had. So a file that was already PR-mediated moves nothing
 * here: its ceiling was computed with that same credit, which is precisely why
 * the ceiling is the end `check` gates by default.
 */
export function reviewedBlindBytes(
  reading: RepoReading,
  reviewed: readonly ScoredFile[],
  bound: ReviewedBound = "floor",
): number {
  const lifted = new Set(reviewed.map((file) => file.path));
  let blindBytes = 0;
  for (const file of reading.files) {
    const score = lifted.has(file.path)
      ? reviewedScore(file)
      : bound === "floor"
        ? file.floor
        : file.ceiling;
    if (score < BLIND_SPOT_THRESHOLD) blindBytes += file.bytes;
  }
  return blindBytes;
}

/** The same, as the share the card prints: a percent in 0–100. */
export function reviewedBlindShare(
  reading: RepoReading,
  reviewed: readonly ScoredFile[],
): number {
  return exactBlindShare(reviewedBlindBytes(reading, reviewed), reading.scoredBytes);
}
