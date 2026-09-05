import type { Engagement } from "../../../lib/demo-data";
import { ageInDays } from "../../../lib/reading-explained";
import { RECENCY_WINDOW_DAYS } from "../../../workers/src/scorer";
import type { ScoredFile } from "./scoring";

/**
 * THE DARK SHARE — the one number a git-only reading knows completely.
 *
 * The CLI used to headline a comprehension-debt share, which it cannot measure.
 * `human_review_depth` carries 0.40 of the score and git records no reviews, so
 * the reading was a RANGE, and the range was supposed to bracket the hosted
 * number. Measured, it does not: hono squash-merges 99% of its pull requests
 * (31 merge commits in 2,137), so those PRs leave nothing in the commit graph
 * for the ceiling to credit, and the CLI's best case lands BELOW the hosted
 * number rather than above it. Two numbers for one repository, in the same
 * units, with the same word beside them, and no rule a reader could apply to
 * reconcile them — on the one surface whose whole argument is "check it
 * yourself".
 *
 * So the CLI stopped competing and started answering the question git can
 * actually close:
 *
 *     dark(f)  ⇔  f.factors.human_author_recency === 0
 *
 * That is the scorer's own factor read at zero, not a second derivation. In a
 * git-only reading `human_author_recency` is `max over events of w(e) ×
 * decay(e)`; `w` is 1 for a human-authored commit, ENGAGEMENT_UNIT for a mixed
 * (prompted) one, and 0 for everything else a `.git` directory can produce; and
 * `decay` clamps to exactly zero at RECENCY_WINDOW_DAYS. So the factor is zero
 * exactly when NO HUMAN WROTE OR PROMPTED THE FILE INSIDE THE WINDOW — a
 * sentence a reader can check against `git log` on the same clone, with no
 * range in it and no factor missing from it.
 *
 * WHAT IT IS NOT, said here because the card has four seconds to say it and
 * this file has as long as it likes: the dark share is not a comprehension-debt
 * estimate and never stands in for one. Measured across the public gallery the
 * two do not even correlate — express reads 71.3% dark at 13% debt while
 * simonw/llm reads 7.3% dark at 17% debt. A file three people rewrote last week
 * and nobody reviewed is lit and in debt; a file five people reviewed carefully
 * two years ago is dark and cheap. Both sentences are true and they are about
 * different things, which is the whole reason there are two products.
 */

/** The window the headline is defined by, in days. Imported, never typed. */
export const DARK_WINDOW_DAYS = RECENCY_WINDOW_DAYS;

/**
 * Why a file is dark — or that it is not.
 *
 * `lit` is a member rather than an absence: the partition has to be total over
 * the scored file set for the ledger's column to add up to the headline, and a
 * "rest" computed as `100 − everything else` is a remainder rather than a
 * group. It is the coda the card closes the sum with.
 */
export type DarkReasonId = "faded-hand" | "faded-prompted" | "never" | "lit";

/**
 * The RULE order — not the print order. Groups print by byte share descending,
 * exactly as `explainReading`'s buckets do, so the biggest finding leads; this
 * is the deterministic tie-break when two of them hold equal bytes, and two
 * equal groups is not a contrived case on a small repository.
 *
 * `faded-hand` first: a file humans once wrote by hand and then left is the
 * finding a reader can act on. `lit` is last because it is the coda, and the
 * ledger lifts it out of this list before printing anyway.
 */
export const DARK_REASON_ORDER: readonly DarkReasonId[] = [
  "faded-hand",
  "faded-prompted",
  "never",
  "lit",
];

/**
 * The predicate, in one place.
 *
 * Read off the factor rather than recomputed from the events. A second
 * derivation ("is the newest human event more than 180 days old?") would agree
 * today and would be free to disagree the moment `engagementWeight` learns a
 * new event kind — and the headline would then be measuring something the
 * scorer does not.
 */
export function isDark(file: ScoredFile): boolean {
  return file.factors.human_author_recency === 0;
}

/** The dark bytes of a file set. The card's numerator. */
export function darkBytesOf(files: readonly ScoredFile[]): number {
  let bytes = 0;
  for (const file of files) if (isDark(file)) bytes += file.bytes;
  return bytes;
}

/**
 * WHICH REASON, by the file's NEWEST human-weighted contact.
 *
 * Newest, not strongest, and the choice is load-bearing twice over. It mirrors
 * the factor: recency is a MAX over events, so the newest contact is the one
 * that would have kept the file lit and did not. And it makes the age the card
 * prints the SMALLEST age that is still true — the same
 * most-favourable-claim-that-is-still-true convention `lib/reading-explained`
 * already applies to a faded bucket's `handAgeDays`, so a file hand-written
 * three years ago and prompted last spring is described by last spring.
 */
export function darkReasonOf(file: ScoredFile): DarkReasonId {
  if (!isDark(file)) return "lit";
  const { last_hand_authored, last_prompted } = file.factors.engagement;
  if (last_hand_authored !== null && last_prompted !== null) {
    return Date.parse(last_hand_authored) >= Date.parse(last_prompted)
      ? "faded-hand"
      : "faded-prompted";
  }
  if (last_hand_authored !== null) return "faded-hand";
  if (last_prompted !== null) return "faded-prompted";
  return "never";
}

/** The contact `darkReasonOf` classified on, or null when there was none. */
export function newestContact(engagement: Engagement): string | null {
  const { last_hand_authored, last_prompted } = engagement;
  if (last_hand_authored === null) return last_prompted;
  if (last_prompted === null) return last_hand_authored;
  return Date.parse(last_hand_authored) >= Date.parse(last_prompted)
    ? last_hand_authored
    : last_prompted;
}

/** One reason, as a group of files. Shares are of the reading's scored bytes. */
export interface DarkGroupSummary {
  readonly id: DarkReasonId;
  readonly fileCount: number;
  readonly bytes: number;
  /** Share of SCORED bytes, 0..1 — the headline's own denominator. */
  readonly share: number;
  /**
   * The group's members, in the order they were handed in. The caller sorts
   * them for display; carrying them here is what keeps "the files under this
   * heading" and "the bytes this heading claims" one computation rather than
   * two that agree.
   */
  readonly files: readonly ScoredFile[];
  /**
   * `faded-*` only: the age in days of the NEWEST contact in the group. The
   * newest, because every other file here is older, so "N+ days ago" is the
   * most favourable claim that is still true and the heading can never
   * overstate the staleness.
   */
  readonly ageDays?: number;
}

/**
 * THE PARTITION — every scored file under exactly one reason.
 *
 * Total and disjoint by construction: `darkReasonOf` is a total function on
 * `ScoredFile` with no null case, so the shares sum to one and the ledger's
 * printed column can sum to the headline. Empty reasons are dropped from the
 * list (a heading over nothing is a truncated screen, not a small bucket) —
 * dropping an EMPTY group is safe in a way dropping a small one is not,
 * because zero bytes take zero units out of the sum.
 *
 * Byte share descending, rule order breaking a tie, so the same files always
 * produce the same list and the biggest finding leads.
 */
export function darkGroups(
  files: readonly ScoredFile[],
  scoredBytes: number,
  now: Date,
): DarkGroupSummary[] {
  const members = new Map<DarkReasonId, ScoredFile[]>();
  for (const file of files) {
    const id = darkReasonOf(file);
    const list = members.get(id);
    if (list === undefined) members.set(id, [file]);
    else list.push(file);
  }

  return DARK_REASON_ORDER.filter((id) => (members.get(id)?.length ?? 0) > 0)
    .map((id) => {
      const group = members.get(id) as ScoredFile[];
      const bytes = group.reduce((sum, file) => sum + file.bytes, 0);
      const summary: DarkGroupSummary = {
        id,
        fileCount: group.length,
        bytes,
        share: scoredBytes > 0 ? bytes / scoredBytes : 0,
        files: group,
      };
      if (id === "faded-hand" || id === "faded-prompted") {
        const days = newestContactAgeDays(group, now);
        if (days !== null) return { ...summary, ageDays: days };
      }
      return summary;
    })
    .sort(
      (a, b) =>
        b.bytes - a.bytes ||
        DARK_REASON_ORDER.indexOf(a.id) - DARK_REASON_ORDER.indexOf(b.id),
    );
}

function newestContactAgeDays(files: readonly ScoredFile[], now: Date): number | null {
  let newest: number | null = null;
  for (const file of files) {
    const iso = newestContact(file.factors.engagement);
    if (iso === null) continue;
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest === null ? null : ageInDays(newest, now);
}

/**
 * THE GROUP HEADING — one reason, as the heading over its files.
 *
 * WHAT IT MAY NOT DO IS INVENT WORDS. `lib/reading-explained` owns this
 * product's vocabulary for engagement and the CLI's briefs are that vocabulary
 * at terminal length; a third phrasing would be three surfaces describing one
 * idea three ways. So "hand-written, but N+ days ago" and "prompted" appear
 * here exactly as they appear there — reordered, never re-coined. What is
 * dropped is every clause about the LINE ("not recently enough to score above
 * the line"), because this partition is not cut on the line and a heading that
 * said so would be describing a number the card no longer prints.
 *
 * THE SHARE IS A PARAMETER for the reason the below-line version states: the
 * ledger allocates its percentages under the PRINTED headline by largest
 * remainder so the column adds up on screen, which is arithmetic no single
 * group can do alone.
 *
 * Exhaustive, no `default`, `lit` included: the coda that closes the ledger is
 * this function too, in lower case, because "what is left" is the last line of
 * the same sum.
 */
export function darkLedgerLine(group: DarkGroupSummary, share: string): string {
  switch (group.id) {
    case "faded-hand":
      return group.ageDays === undefined
        ? `hand-written, but not inside the window — ${share} of the code`
        : `hand-written, but ${group.ageDays}+ days ago — ${share} of the code`;
    case "faded-prompted":
      return group.ageDays === undefined
        ? `prompted, but not inside the window — ${share} of the code`
        : `prompted, but ${group.ageDays}+ days ago — ${share} of the code`;
    // "in git's record", never "never". A `.git` directory carries the commits
    // it was given; a file whose history was rewritten, or which arrived in an
    // import commit, has no human in THIS record and may have had several in
    // the one it came from. The distinction survives being quoted at somebody
    // whose repository was migrated.
    case "never":
      return `no human wrote or prompted it in git's record — ${share} of the code`;
    case "lit": {
      const files = `${group.fileCount} ${group.fileCount === 1 ? "file" : "files"}`;
      return (
        `still lit — ${share} of the code · a human wrote or prompted it inside ` +
        `the last ${DARK_WINDOW_DAYS} days (${files})`
      );
    }
  }
}
