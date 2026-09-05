// lib/answerability-core.ts
//
// The zod-free pure core of question_answerability, split from
// lib/answerability.ts so consumers of the pure math (workers/src/scorer.ts,
// and through it the CLI bundle) don't drag the zod runtime in via the IO
// schemas. lib/answerability.ts re-exports everything here — importers of the
// original module are unaffected; only the scorer imports this module
// directly. Pure: deterministic, no clock, no IO, no zod.

export type SelfAssessment = "could" | "partially" | "couldnt";

/** could answer = 1.0, partially = 0.5, couldn't = 0.0 (spec'd values). */
export const ASSESSMENT_VALUE: Record<SelfAssessment, number> = {
  could: 1.0,
  partially: 0.5,
  couldnt: 0.0,
};

export interface AnswerabilityCheck {
  id: number;
  occurredAt: string;
  assessments: SelfAssessment[];
}

// Decay constants, in the scorer's *_MS convention (see RECENCY_WINDOW_MS in
// workers/src/scorer.ts): full value within 90 days, linear to 0 by 365 days.
const FULL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const ZERO_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/** The latest check by occurred_at; tie → highest id. Order-independent. */
export function latestCheck(checks: AnswerabilityCheck[]): AnswerabilityCheck | null {
  let latest: AnswerabilityCheck | null = null;
  for (const c of checks) {
    if (latest === null) {
      latest = c;
      continue;
    }
    const byTime = new Date(c.occurredAt).getTime() - new Date(latest.occurredAt).getTime();
    if (byTime > 0 || (byTime === 0 && c.id > latest.id)) latest = c;
  }
  return latest;
}

/** Mean of the assessment values; 0 for an empty list (defensive — the IO
 *  boundary enforces exactly 3). */
export function assessmentMean(assessments: SelfAssessment[]): number {
  if (assessments.length === 0) return 0;
  return assessments.reduce((sum, a) => sum + ASSESSMENT_VALUE[a], 0) / assessments.length;
}

/**
 * The SELF-REPORTED answerability reading for a path: assessmentMean(latest
 * check) × decay. decay = min(1, max(0, (365d − age) / (365d − 90d))) — the
 * same clamped-linear family as human_author_recency; ages ≤ 90d (and
 * future-dated checks, clock skew) clamp to full value, ≥ 365d clamp to 0.
 * No checks → 0.
 *
 * DISPLAY ONLY. This does not reach a score — see `scoredAnswerability`.
 * It is what the team told us about itself, which is worth showing back to
 * them and worth nothing as evidence.
 */
export function selfReportedAnswerability(checks: AnswerabilityCheck[], now: Date): number {
  const latest = latestCheck(checks);
  if (latest === null) return 0;
  const age = now.getTime() - new Date(latest.occurredAt).getTime();
  const decay = Math.min(1, Math.max(0, (ZERO_WINDOW_MS - age) / (ZERO_WINDOW_MS - FULL_WINDOW_MS)));
  return assessmentMean(latest.assessments) * decay;
}

/**
 * The SCORED value of `question_answerability`: **0, unconditionally**.
 *
 * Every Fathohm surface prints the same promise — "measured from the record,
 * not a survey." A self-assessment is a survey. Until v3 the scorer fed
 * `selfReportedAnswerability` straight into the weighted sum, so three clicks
 * and no typing were worth +0.100, enough to carry a lightly-reviewed
 * agent-authored file from 0.267 to 0.367 and a faded solo file from 0.208 to
 * 0.308 — both across the 0.30 blind-spot line. An org could lower its own
 * headline number by answering its own question. That is the exact shape the
 * product exists to argue against.
 *
 * The weight stays at 0.10 rather than being redistributed across the other
 * three factors. Redistribution would silently re-value every score ever
 * published, including the gallery, to fix a defect that had touched one
 * stored row. Holding the weight means the maximum achievable score is 0.90
 * and the 0.30 line keeps the meaning it already had — nothing moves that
 * did not have to.
 *
 * The 0.10 is not retired, it is unearned. It comes back when a check can be
 * verified by someone who did not author the answer (PR #8's spec: the
 * verifier is checked in the scorer at derivation time, so the score is safe
 * even if workflow state is tampered with, and an LLM can never raise a
 * score). Restoring it is a change to this one function.
 *
 * The parameters are kept so that restoration needs no call-site churn, and
 * so the signature keeps stating what a verified implementation would read.
 */
export function scoredAnswerability(_checks: AnswerabilityCheck[], _now: Date): number {
  return 0;
}
