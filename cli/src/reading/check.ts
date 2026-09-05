import { exactBlindShare } from "../../../lib/blind-share-format";
import { CliError, EXIT, type ExitCode } from "../cmd/errors";
import { isDegenerate, type RepoReading } from "./scoring";

/**
 * `fathohm check` — the gate, and the one command whose output is an argument
 * somebody will lose.
 *
 * A build that fails on a comprehension number is a build somebody has to
 * justify to a colleague at five o'clock, so the design rule for this whole
 * file is: EVERY FAILURE MUST BE INCONTESTABLE.
 *
 * **It gates the CEILING.** The ceiling is the reading with the missing review
 * record at its most generous — full credit for every file that ever went
 * through a pull request. A repository that fails the ceiling has failed the
 * best case the evidence allows: no review log, no CI integration, no argument
 * about what git could not see would move it back over the line. `--pessimistic`
 * gates the floor instead, for teams who want the tighter bound and know what
 * they are asking for.
 *
 * **A truncated history never fails, and never passes.** A shallow or grafted
 * clone is a fragment, and a verdict on a fragment is a verdict on nothing —
 * so it exits 3 (cannot read honestly), which is neither of the two answers a
 * CI gate is allowed to take an action on.
 *
 * **A repository with nothing to fathom passes without a percentage.** No code
 * files, or no bytes in them: there is no debt, and printing "0% blind" for a
 * repository the tool cannot see into would be this product's own headline
 * lying in its first five seconds.
 *
 * **The comparison is on bytes, not on the printed number.** `blindBytes × 100
 * ≤ threshold × scoredBytes` — integer arithmetic against the limit, so the
 * verdict never depends on a rounding rule. The sentence prints the byte
 * counts beside the share for exactly this reason: at 39.6% against a limit of
 * 40 the share rounds to "40%", and the bytes are what settle it.
 */

export type CheckBound = "ceiling" | "floor";

export interface CheckOptions {
  /** The limit, 0–100, from `--max-blind` or the config. */
  readonly maxBlind: number;
  /** `--pessimistic`: gate the floor (what the evidence proves) instead. */
  readonly pessimistic: boolean;
}

export interface CheckVerdict {
  readonly bound: CheckBound;
  readonly blindBytes: number;
  readonly scoredBytes: number;
  /** The exact share as a percent, 0–100 — reported, never compared. */
  readonly share: number;
  readonly threshold: number;
  /** Meaningless when `indeterminate`; a gate must not read it then. */
  readonly passed: boolean;
  /** Truncated history: neither a pass nor a failure. */
  readonly indeterminate: boolean;
  /** Nothing to fathom — no code, or no bytes. Passes, without a percentage. */
  readonly nothingToGate: boolean;
}

/**
 * The limit, from the flag or the config, or a usage error naming both.
 *
 * There is deliberately no default. A gate whose threshold fathohm chose would
 * fail builds on this product's opinion rather than on the team's, and the
 * first thing anybody would do is find the number and change it — so the
 * command asks for it up front, once, in the place they will keep it.
 */
export function requireThreshold(fromFlag: number | null, fromConfig: number | null): number {
  const threshold = fromFlag ?? fromConfig;
  if (threshold === null) {
    throw new CliError(
      EXIT.usage,
      "check needs a limit: how much of this repository may sit below the line",
      "pass `--max-blind 40`, or put `max-blind = 40` in .fathohm.toml at the " +
        "repository root. The flag wins when both are set.",
    );
  }
  return threshold;
}

/**
 * THE COMPARISON — the one expression that decides whether a build goes red.
 *
 * `blindBytes × 100 ≤ maxBlind × scoredBytes`: integer arithmetic against the
 * limit, so the verdict never depends on a rounding rule. `<=` because a limit
 * reads as "at most this much", and a repository sitting exactly at its stated
 * tolerance has not exceeded it.
 *
 * Exported because `paydown` prints the rung a reader's own gate would pass at,
 * and a second spelling of the comparison is how a card comes to promise a pass
 * that the gate then refuses — at 39.6% against a limit of 40, where the
 * printed share and the verdict already look like they disagree.
 */
export function withinLimit(
  blindBytes: number,
  scoredBytes: number,
  maxBlind: number,
): boolean {
  return blindBytes * 100 <= maxBlind * scoredBytes;
}

export function evaluateCheck(reading: RepoReading, options: CheckOptions): CheckVerdict {
  const bound: CheckBound = options.pessimistic ? "floor" : "ceiling";
  const blindBytes =
    bound === "floor" ? reading.floorBlindBytes : reading.ceilingBlindBytes;
  const scoredBytes = reading.scoredBytes;
  const indeterminate = reading.provenance.shallow || reading.provenance.grafted;
  const nothingToGate = isDegenerate(reading);

  return {
    bound,
    blindBytes,
    scoredBytes,
    share: exactBlindShare(blindBytes, scoredBytes),
    threshold: options.maxBlind,
    passed: nothingToGate || withinLimit(blindBytes, scoredBytes, options.maxBlind),
    indeterminate,
    nothingToGate,
  };
}

/**
 * The verdict's exit code — the published contract CI reads.
 *
 * 3 outranks everything: a truncated history is not a pass with a warning, it
 * is the absence of an answer, and a pipeline that treated it as a pass would
 * be green on a repository nobody read.
 */
export function checkExit(verdict: CheckVerdict): ExitCode {
  if (verdict.indeterminate) return EXIT.cannotRead;
  return verdict.passed ? EXIT.ok : EXIT.checkFailed;
}
