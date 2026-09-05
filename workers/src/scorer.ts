import { scoredAnswerability, type AnswerabilityCheck } from "../../lib/answerability-core";
import type { Engagement, Factors } from "../../lib/demo-data";
import type { Authorship, EventKind } from "./types";

/**
 * The scorer methodology version. Bump this whenever the DERIVATION of a score
 * from the spine changes (a new factor, a weight change, a read-time override).
 * Every comprehension_scores row is stamped with it, so history is always
 * attributable to the lens that produced it — the load-bearing prerequisite for
 * proving "re-value all history", for the k-anon benchmark (cohorts must share a
 * scorer lens), and for the Score Receipt. Not the code version — the SCORING
 * version. Kept a string ("v0", "v1", …) so it reads the same in the UI.
 *
 * v1 = engagement weights: "a human appears in the event metadata" stopped
 * meaning "a human engaged with the code" (see engagementWeight below).
 * v2 = eased recency decay: memory of your own code stopped fading in a
 * straight line (see decay below).
 * v3 = question_answerability stopped being self-reportable: the factor is
 * derived as 0 until a check can be verified by someone other than its author
 * (see scoredAnswerability). The weight stays at 0.10, unearned, so the
 * maximum achievable score is 0.90 and no already-published number moves.
 * v4 = review depth stopped counting typing events and started measuring what
 * was written (see reviewDepthUnits). Counting made "lgtm" worth as much as a
 * paragraph, and pinned the heaviest factor near its floor on 99.6% of real
 * review events.
 */
export const SCORER_VERSION = "v4";

export interface FactorEvent {
  kind: EventKind;
  actorId: string;
  /** 0 for non-review events; substantive comment count for review/approval/comment. */
  reviewCommentCount: number;
  occurredAt: string;
  /** REQUIRED: the event's authorship label drives its engagement weight, so an
   *  event without one cannot be scored at all. */
  authorship: Authorship;
  /**
   * Characters in the trimmed review summary body, from the v4 sweep
   * (`review_depth_signals`). THREE-STATE, and the distinction is load-bearing:
   *
   *   number  — swept, and this is what was written. 0 means a real empty body.
   *   null/absent — NOT swept. We do not know, and must not guess.
   *
   * A repository the sweep has never visited must not be scored as though every
   * review on it were empty; that would crater the score of every repo the
   * moment v4 shipped, for a reason that is about our ingestion rather than
   * their review culture. Absence therefore falls back to the pre-v4 ramp — see
   * `reviewDepthUnits`. Same discipline as `StoredFactors.engagement`, which
   * pre-v1 rows simply lack: "not recorded" is a different fact from "recorded,
   * and it was zero".
   */
  reviewBodyChars?: number | null;
  /** Inline thread comments from the same sweep. Paired with `reviewBodyChars`:
   *  both present or both absent, so the scorer never mixes regimes. */
  reviewInlineComments?: number | null;
  /**
   * Did this review BLOCK the pull request (GitHub CHANGES_REQUESTED)?
   *
   * The one review signal that is evidence rather than proxy: a reviewer who
   * stops a merge found something specific enough to stop it over. It is also
   * the case a length-priced body scores worst — the expert who writes one
   * sharp sentence and requests changes. Unlike `reviewBodyChars` this is a
   * plain boolean rather than three-state: absent means "not blocking", which
   * is the correct reading for both an unswept event and a real approval.
   */
  reviewChangesRequested?: boolean;
}

/**
 * The recency window, in days: how long a human touch holds a file up before
 * `decay` has run all the way out. Exported because the CLI's headline is
 * defined AS this window ("no human wrote or prompted it in the last 180 days")
 * and a second literal would be a second window — the one number on that card
 * measuring something the scorer does not.
 *
 * `cli/test/scoring-constants.test.ts` forbids scoring literals inside
 * `cli/src` for exactly this reason; importing keeps that guard whole.
 */
export const RECENCY_WINDOW_DAYS = 180;

const RECENCY_WINDOW_MS = RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
// Normalizes the summed per-person engagement to 0..1; three fully-engaged
// contributors is treated as a healthy bus factor. Tune against design-partner
// data.
const BUS_FACTOR_CAP = 3;
const REVIEW_KINDS: EventKind[] = ["review", "approval", "comment"];

/**
 * One substantive review comment — the smallest observable unit of demonstrated
 * engagement the scorer has ever priced (`human_review_depth` ramps
 * `min(1, comments × 0.25)`). A `mixed` commit proves at most one such unit: the
 * human formed the intent and committed the result. Reusing the SAME constant is
 * the point — 0.25 is an exchange rate the scorer already owned, not a knob
 * tuned to make one repo come out right.
 */
export const ENGAGEMENT_UNIT = 0.25;

/**
 * Characters of review summary that constitute ONE unit of demonstrated
 * engagement — a paragraph.
 *
 * This is the one new constant v4 introduces, so it is worth saying exactly
 * what it claims and what it does not. It is not a quality judgement and not a
 * threshold anyone passes or fails: it is the answer to "how much writing is
 * the same amount of evidence as one inline review comment?" A paragraph is
 * the smallest body that can carry a specific observation about the code
 * rather than a verdict on it. "lgtm" is a verdict. "this retries on 5xx but
 * the caller already retries, so a timeout here double-counts" is an
 * observation, and it is about this long.
 *
 * v4 deliberately does NOT invent a second scale. The scorer already owned one
 * exchange rate — ENGAGEMENT_UNIT, "the smallest observable unit of
 * demonstrated engagement" — and v4 changes only what earns a unit, not what a
 * unit is worth. A review that would have scored 0.25 for its one-bit body
 * still scores 0.25 if that body was a paragraph.
 *
 * A FIXED SPEC CONSTANT, deliberately — not repo-relative and not derived from
 * our corpus. Repo-relative would price the same review differently in two
 * repositories and make the public gallery incoherent. Corpus-derived sounds
 * more rigorous but is worse: our corpus is ~17 self-selected repositories, so
 * a constant fitted to it inherits that bias and invites a sharper objection
 * ("calibrated on your own repos") than a definitional choice does. The
 * authority here comes from being disclosed, uniform, and semantically
 * motivated — the same standing BLIND_SPOT_THRESHOLD (0.30) already has.
 * SCORER_VERSION is the freeze mechanism; changing this number is a version
 * bump with a visible changelog line, never a quiet edit.
 *
 * THE PRE-COMMITTED CALIBRATION RULE, written down BEFORE the sweep ran so
 * that checking it against reality is a sanity check rather than curve-fitting:
 *
 *     Keep 240 unless the corpus median NON-EMPTY review body falls outside
 *     [120, 480] — i.e. unless 240 is wrong by more than 2x in either
 *     direction. If it falls outside, snap to that median rounded to the
 *     nearest 50, bump the version, and update the fixtures.
 *
 * The corpus is a sanity check on the constant, never its source.
 *
 * ── RETRACTION, 2026-08-11: the rule above FIRED, and was VOID. ─────────────
 *
 * The rule is left standing verbatim rather than edited away, for the same
 * reason the launch-readiness spec keeps its own wrong finding: a product whose
 * promise is "every number decomposes into visible factors" should keep the
 * trail on its own methodology too.
 *
 * What happened. The dry-run sweep measured the corpus:
 *
 *     repo         reviews   non-empty   empty   median non-empty body_chars
 *     hono           1,817         804   1,013                             5
 *     express        1,138         322     816                            44
 *     quickjs           29           5      24                            88
 *     simonw/llm        45           2      43                    664 (n=2)
 *
 * ~63% of real reviews have a COMPLETELY EMPTY body, and the pooled median
 * non-empty body is roughly 10-40 characters — far outside [120, 480]. So the
 * rule fired and prescribed snapping the constant to the median.
 *
 * That prescription is wrong twice over. Mechanically it is undefined: a median
 * of 5 rounded to the nearest 50 is 0, and the ramp divides by this number.
 * Substantively it is self-defeating: a unit of demonstrated engagement would
 * be redefined as ~10 characters, making "lgtm" worth a full unit — reinstating
 * the exact v3 defect v4 exists to remove.
 *
 * The diagnosis is that the rule's INSTRUMENT was mis-specified, not that the
 * constant is wrong. SUBSTANTIVE_BODY_CHARS is defined two paragraphs above as
 * a THRESHOLD — "the smallest body that can carry a specific observation rather
 * than a verdict". The rule then checked that threshold against the median of a
 * population the sweep proved is dominated by verdicts. Checking a threshold
 * against the centre of the sub-threshold population is a category error, and
 * the arithmetic said so by going undefined.
 *
 * Note what the data DID confirm: most real-world review demonstrates almost no
 * engagement. That is v4's founding premise. The sweep is evidence FOR the
 * model, delivered through a rule that pointed at the wrong statistic.
 *
 * 240 therefore stands unchanged, and this is not a version bump.
 *
 * ── CORRECTION to the paragraph above, same day, after measuring inline ─────
 *
 * "Most real-world review demonstrates almost no engagement" is FALSE, and the
 * empty-body counts in the table above do not support it. Counting inline
 * thread comments — which the sweep records and this ramp already prices at one
 * unit each — shows where the substance actually lives:
 *
 *     repo         empty-body reviews   of those, carrying ≥1 inline thread
 *     hono                      1,013                          937  (92%)
 *     express                     816                          321  (39%)
 *     llm.c                       271                          271 (100%)
 *     simonw/llm                   43                           43 (100%)
 *     nanochat                     25                           21  (84%)
 *     quickjs                      24                           18  (75%)
 *
 * Only 76 of hono's 1,817 reviews (4%) are silent in both channels. These
 * reviewers are not rubber-stamping; they write line-anchored, and leave the
 * summary box blank. The body-length median never saw them, which is a second,
 * independent way the retracted rule was pointed at the wrong statistic — it
 * measured one of two channels and read the other channel's absence as apathy.
 *
 * Two things follow. The verdict is unchanged (240 stands, do not snap), and it
 * is now better supported: the population the rule measured is not "reviews",
 * it is "reviews that chose the summary box", which is neither the threshold
 * nor a census. But v4's founding premise needs restating honestly. It is not
 * "review is mostly worthless"; it is "review depth was being scored by
 * COUNTING events rather than reading what they contain" — and a corpus that
 * reviews inline is exactly the corpus the pre-v4 one-bit count mis-priced, in
 * BOTH directions.
 *
 * ── THE REPLACEMENT PRE-COMMITMENT, band inherited before computing ────────
 *
 * Same [120, 480] band, correct population: the median `body_chars` of
 * CHANGES_REQUESTED reviews. A review that blocked a merge is substantive
 * almost by definition, so it estimates the threshold rather than the rubber
 * stamp. Recorded either way — see `docs/review-signals.md`.
 */
export const SUBSTANTIVE_BODY_CHARS = 240;

/**
 * Units of demonstrated review engagement in one event, pre-`ENGAGEMENT_UNIT`.
 *
 * v4 (swept): body length / SUBSTANTIVE_BODY_CHARS, plus one unit per inline
 * thread comment. Continuous in both directions on purpose — the defect being
 * fixed ran BOTH ways. "lgtm" was one whole unit (0.25 depth) and is now 0.017
 * units, i.e. 0.004 depth;
 * a four-paragraph review scored the same 0.25 as "lgtm" and now reaches full
 * depth. Counting typing events flattened the two into one number.
 *
 * Pre-v4 (not swept): the legacy count ramp, unchanged, so an unswept
 * repository scores exactly what it scored under v3 rather than collapsing.
 */
export function reviewDepthUnits(event: FactorEvent): number {
  // Blocking a merge is worth at least one unit on its own, whatever was
  // typed. This is a FLOOR rather than a bonus: a reviewer who both blocks and
  // writes four paragraphs earns the paragraphs, not the paragraphs plus a
  // prize. The floor applies in both regimes — a blocking review is evidence
  // whether or not the sweep has reached it.
  const blocking = event.reviewChangesRequested === true ? 1 : 0;
  const chars = event.reviewBodyChars;
  if (chars === null || chars === undefined) {
    return Math.max(event.reviewCommentCount, blocking);
  }
  return Math.max(chars / SUBSTANTIVE_BODY_CHARS + (event.reviewInlineComments ?? 0), blocking);
}

/**
 * How much human comprehension one event demonstrates, 0..1.
 *
 * Scoring v0 asked a binary question — "was a human in this event's metadata?" —
 * and three mechanisms answered yes without any human having engaged with the
 * code: an agent co-authored commit (`mixed`) earned the same credit as a
 * hand-written one, a merge-button press stamped human authorship across every
 * file in the PR, and a bare approval refreshed recency. The discriminator this
 * replaces it with: a solo developer who HAND-WRITES every line understands
 * their repo; a solo founder who PROMPTS 95% of it does not. The only signal
 * that separates them is the authorship label, so authorship KIND carries the
 * weight.
 *
 * | commit, `human`                              | 1.0  | the human produced the content        |
 * | commit, `mixed`                              | 0.25 | one demonstrated unit of engagement   |
 * | commit, `agent` / `bot` / `unknown`          | 0    | no human engagement shown             |
 * | review-kind, `human`, ≥ 1 substantive comment| 1.0  | demonstrated engagement with content  |
 * | review-kind with 0 comments (every merge)    | 0    | a button press — already at floor     |
 * | review-kind whose authorship is not `human`  | 0    | a bot review credits nobody           |
 *
 * `pr_opened` earns nothing: opening a PR is neither content nor demonstrated
 * engagement with content. It is also pathless (parse-events records no paths
 * for it), so it never reaches a per-file score in the first place.
 *
 * Within `mixed`, the "but I hand-typed 80% of it" case is answered by the
 * correction UI — correct the label to `human` and the event earns full credit,
 * as a first-class correction event — never by a diff-size heuristic and never
 * by an LLM.
 */
export function engagementWeight(e: FactorEvent): number {
  if (e.kind === "commit") {
    if (e.authorship === "human") return 1;
    if (e.authorship === "mixed") return ENGAGEMENT_UNIT;
    return 0;
  }
  if (REVIEW_KINDS.includes(e.kind)) {
    return e.authorship === "human" && e.reviewCommentCount >= 1 ? 1 : 0;
  }
  return 0;
}

/**
 * Decomposition data emitted alongside the four scored factors, so a caption
 * can say WHICH kind of contact a file last had without re-reading the spine.
 * Additive jsonb keys: rows written before v1 simply lack them, and every
 * consumer of `factors` must tolerate their absence.
 *
 * The shape itself now lives in lib/demo-data.ts beside `Factors` — the
 * dashboard reads these keys to explain the reading (lib/reading-explained.ts),
 * and one declaration is what keeps producer and consumer honest. Re-exported
 * here because this module is where the worker side names it.
 */
export type { Engagement };

/** What `deriveFactors` emits: the four scored factors plus the additive
 *  `engagement` decomposition — REQUIRED here, where it is produced, though
 *  optional on `Factors`, where it may be absent on a pre-v1 row. Structurally
 *  a `Factors`, so `scoreFromFactors` and every existing factors consumer take
 *  it unchanged. */
export interface DerivedFactors extends Factors {
  engagement: Engagement;
}

/**
 * Quadratic-eased 180-day decay, clamped to [0, 1]: `1 − (t / 180d)²`.
 *
 * v1 decayed LINEARLY, which priced comprehension of your own code as halving
 * in three weeks: solo and unreviewed, a hand-written file fell below the 0.30
 * line just 24 days after its last touch, so a repo whose best code its only
 * author hand-wrote 44 days earlier read 100% unfathomed on the founder's
 * first feels-true reading (2026-07-31). Nobody believes that. Memory of code
 * you wrote yourself fades slowly at first and steeply later, so the SAME
 * 180-day window is now walked on an eased curve: solo, unreviewed,
 * hand-written code stays above the line for about two months (it crosses
 * between day 65 and day 66), then fades. Prompted-only code barely moves —
 * its 0.25 weight dominates, so easing rescues nobody who never engaged.
 *
 * ONE curve for every engagement kind, exactly as the v1 ruling requires: the
 * weight, never the curve, is what separates a hand-written commit from a
 * prompt. Age is clamped BEFORE it is squared, so a future-dated event (clock
 * skew, rebase) reads as "now" rather than as more-recent-than-now.
 *
 * Exported because the CLI's fade projection (cli/src/reading/fade.ts) walks this exact
 * curve forward to find the day a file crosses the line. A fade date is not a
 * prediction — it is the same decay this scorer already applies, evaluated at a
 * later clock — so it has to be the SAME function. A second copy of `1 − t²`
 * living in the CLI would make every fade date a claim about a curve nobody
 * re-values history with.
 */
export function decay(occurredAt: string, now: Date): number {
  const age = (now.getTime() - new Date(occurredAt).getTime()) / RECENCY_WINDOW_MS;
  const t = Math.min(1, Math.max(0, age));
  return 1 - t * t;
}

function later(a: string | null, b: string): string {
  return a === null || new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

/**
 * Derives scoring v2 Factors from a file's real code_events. The formula itself
 * (scoreFromFactors, in lib/demo-data.ts) and the weights are unchanged — the
 * weights were never the bug, the inputs were lying. What changed is that every
 * event now enters the factors through `engagementWeight` instead of a binary
 * "was a human involved" filter.
 *
 * - `human_review_depth` — max of `min(1, units × 0.25)` over human review-kind
 *   events, where v4 measures units from what was WRITTEN rather than counting
 *   typing events (see `reviewDepthUnits`). Unswept events keep the pre-v4
 *   count ramp, so this is a strict superset of v3's behaviour.
 * - `human_author_recency` — max over events of w(e) × decay(occurredAt). ONE
 *   eased decay curve for every kind of engagement: a hand-written commit 36
 *   days ago (1.0 × 0.96) beats yesterday's prompt (0.25 × 1.0).
 * - `bus_factor` — min(1, Σ per-person max w(e) / 3). A prompt-only contributor
 *   is a quarter of a person; three of them are not a healthy bus.
 * - `question_answerability` — 0 for every path since v3. Checks are still
 *   ingested and still shown back to the team, but a self-assessment is a
 *   survey and this number is promised to be measured from the record. See
 *   `scoredAnswerability` for what earns the weight back.
 */
export function deriveFactors(events: FactorEvent[], now: Date, checks: AnswerabilityCheck[] = []): DerivedFactors {
  const reviewDepths = events
    .filter((e) => REVIEW_KINDS.includes(e.kind) && e.authorship === "human")
    .map((e) => Math.min(1, reviewDepthUnits(e) * ENGAGEMENT_UNIT));
  const human_review_depth = reviewDepths.length > 0 ? Math.max(...reviewDepths) : 0;

  // One pass: recency, per-person weights and the engagement decomposition all
  // read the same w(e), so they can never disagree about what an event proved.
  let human_author_recency = 0;
  const maxWeightByPerson = new Map<string, number>();
  let last_hand_authored: string | null = null;
  let last_prompted: string | null = null;
  for (const e of events) {
    const w = engagementWeight(e);
    if (w > 0) {
      human_author_recency = Math.max(human_author_recency, w * decay(e.occurredAt, now));
      maxWeightByPerson.set(e.actorId, Math.max(maxWeightByPerson.get(e.actorId) ?? 0, w));
    }
    if (e.kind !== "commit") continue;
    if (e.authorship === "human") last_hand_authored = later(last_hand_authored, e.occurredAt);
    if (e.authorship === "mixed") last_prompted = later(last_prompted, e.occurredAt);
  }

  let engagedTotal = 0;
  let full = 0;
  let prompted = 0;
  for (const weight of maxWeightByPerson.values()) {
    engagedTotal += weight;
    if (weight >= 1) full += 1;
    else prompted += 1;
  }
  const bus_factor = Math.min(1, engagedTotal / BUS_FACTOR_CAP);

  return {
    human_review_depth,
    human_author_recency,
    bus_factor,
    question_answerability: scoredAnswerability(checks, now),
    engagement: { last_hand_authored, last_prompted, contributors: { full, prompted } },
  };
}
