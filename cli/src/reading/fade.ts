import {
  BLIND_SPOT_THRESHOLD,
  scoreFromFactors,
  type Factors,
} from "../../../lib/demo-data";
import {
  decay,
  engagementWeight,
  type FactorEvent,
} from "../../../workers/src/scorer";

/**
 * Fade: the day a file crosses the line, derived rather than predicted.
 *
 * Everything in a comprehension score is static except one factor. Bus factor
 * does not decay — the people who engaged with a file stay engaged with it.
 * Review depth does not decay. Answerability decays, but on its own clock and
 * only where a paydown session exists, which git cannot see (it is 0 in every
 * CLI reading). What moves is `human_author_recency`, and it moves on the
 * scorer's own quadratic curve.
 *
 * So "this file falls below 0.30 on the 7th of March" is not a forecast. It is
 * `scoreFromFactors` evaluated with a later clock — the same arithmetic the
 * dashboard would run that morning, run today. The only reason a bisection is
 * needed at all is that recency is a MAX over events, which has no clean
 * inverse; the curve itself is exact.
 *
 * That is why `decay` is imported from workers/src/scorer.ts rather than
 * re-derived here. A fade date computed against a curve the scorer does not use
 * would be a number about nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The ceiling's factor set: the floor's evidence plus full review credit.
 *
 * `human_review_depth: 1` is not an estimate of how well a file was reviewed.
 * It is the best case the missing record COULD hold — git records no reviews,
 * so the honest git-only answer is an interval, and this is its upper end. The
 * caller decides whether a file is entitled to it (PR-mediated only); this
 * function only knows how to build it.
 */
export function ceilingFactors(factors: Factors): Factors {
  return { ...factors, human_review_depth: 1 };
}

/**
 * The recency factor a set of events would produce at an arbitrary clock —
 * `max` over events of `w(e) × decay(e)`, which is line-for-line what
 * `deriveFactors` computes, using the same two imported helpers.
 *
 * Non-increasing in `at`: `decay` is flat at 1 until an event's own date, then
 * falls, then clamps to 0 — so the max of any number of them can only ever go
 * down as the clock moves forward. That monotonicity is what makes the
 * bisection below correct rather than merely convergent.
 */
export function recencyAt(events: readonly FactorEvent[], at: Date): number {
  let best = 0;
  for (const event of events) {
    const weight = engagementWeight(event);
    if (weight > 0) best = Math.max(best, weight * decay(event.occurredAt, at));
  }
  return best;
}

function scoreAt(
  events: readonly FactorEvent[],
  factors: Factors,
  at: Date,
): number {
  return scoreFromFactors({
    ...factors,
    human_author_recency: recencyAt(events, at),
  });
}

/**
 * The day a file's FLOOR score crosses below the line, or null.
 *
 * Null means one of two different things, and the caller must not conflate
 * them: the file is already below (there is nothing left to fade), or it holds
 * past `horizonDays` (fathohm will not name a date it was not asked to look
 * for). Renderers say which by checking the score they already hold.
 *
 * **Day convention.** A day is a UTC calendar day, and a file "fades on day D"
 * when its score at the END of D — the instant midnight opens D+1 — is below
 * the line, while the end of D−1 still held. Since the score only falls, the
 * end of a day is its worst moment, so this reads as "the first day the file is
 * not above the line for the whole of it". Day 0 is the calendar day containing
 * `now`, so a file may fade today.
 *
 * Worked, because the tests pin it: a solo hand-written commit at
 * 2026-01-01T00:00Z crosses in closed form at t ≈ 65.73 days. End of
 * 2026-03-06 is t = 65 (still above); end of 2026-03-07 is t = 66 (below). The
 * answer is 2026-03-07 — the day the crossing actually happens inside.
 *
 * Which is the convention stated the other way round, and the form the tests
 * check against the closed-form solution: **the returned day is the UTC
 * calendar day containing the exact crossing instant.** A crossing that lands
 * precisely on midnight belongs to the day it opens, because the line is `< 0.30`
 * and a score of exactly 0.30 is still above it.
 */
export function fadeDate(
  events: readonly FactorEvent[],
  factors: Factors,
  now: Date,
  horizonDays: number,
): string | null {
  // Already below: the crossing is in the past, and a date behind us is not a
  // warning, it is a misreading of the same number the card already printed.
  if (scoreFromFactors(factors) < BLIND_SPOT_THRESHOLD) return null;
  if (!Number.isFinite(horizonDays) || horizonDays < 0) return null;

  const days = Math.floor(horizonDays);
  const midnight = utcMidnight(now);
  // Holds past the horizon. Checked before the search so the invariant the
  // bisection needs — a below-the-line right end — is established, not assumed.
  if (scoreAt(events, factors, dayEnd(midnight, days)) >= BLIND_SPOT_THRESHOLD) {
    return null;
  }

  // Smallest day index whose end is below the line. `low` is a day that may
  // still hold; `high` is a day known to have crossed; they meet on the first.
  let low = 0;
  let high = days;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (scoreAt(events, factors, dayEnd(midnight, mid)) < BLIND_SPOT_THRESHOLD) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return isoDay(midnight + low * DAY_MS);
}

/**
 * Whether a file stays above the line at its CEILING no matter how long nobody
 * touches it — the question "is the spread doing all the work here?"
 *
 * Computed, never asserted. It happens to be true for every PR-mediated file
 * today, because review depth carries weight 0.4 and the line is 0.30, so full
 * review credit alone clears it — but that is an arithmetic consequence of two
 * constants that live in lib/demo-data.ts, not a fact about fathohm. Move the
 * line to 0.45 and this function starts returning false without anyone having
 * to notice that it should.
 *
 * "Forever" is modelled as the settled state: every factor that decays has run
 * all the way out. Recency goes to 0 (180 days of nobody touching it) and
 * answerability with it (it decays to 0 by 365 days, and is 0 in a git-only
 * reading regardless). What is left is what cannot fade — review credit, if the
 * file is entitled to any, and the bus factor.
 */
export function holdsAtCeiling(file: {
  factors: Factors;
  prMediated: boolean;
}): boolean {
  const base = file.prMediated ? ceilingFactors(file.factors) : file.factors;
  const settled: Factors = {
    ...base,
    human_author_recency: 0,
    question_answerability: 0,
  };
  return scoreFromFactors(settled) >= BLIND_SPOT_THRESHOLD;
}

/** Midnight UTC opening the calendar day that contains `at`, in epoch ms. */
function utcMidnight(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/** The instant day `index` closes: midnight UTC opening the day after it. */
function dayEnd(midnight: number, index: number): Date {
  return new Date(midnight + (index + 1) * DAY_MS);
}

function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
