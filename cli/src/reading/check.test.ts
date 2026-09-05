import { describe, expect, it } from "vitest";

import {
  EMPTY,
  MIXED,
  NON_CODE,
  PROMPTED_ONLY,
  SHALLOW,
  readingOf,
} from "../../test-helpers/reading-fixtures";
import { checkExit, evaluateCheck, requireThreshold } from "./check";
import { EXIT, isCliError } from "../cmd/errors";
import type { RepoReading } from "./scoring";

/**
 * THE GATE.
 *
 * What is being tested here is not arithmetic — it is a promise about which
 * builds this product is willing to break. Three properties carry it:
 *
 *   1. the default bound is the CEILING, so a failure survives the best case
 *      the evidence allows;
 *   2. a truncated history is neither a pass nor a failure;
 *   3. the comparison is on bytes, so the verdict never turns on a rounding
 *      rule the printed sentence does not show.
 */

function reading(): RepoReading {
  return readingOf(MIXED).reading;
}

function shareOf(reading: RepoReading, bound: "floor" | "ceiling"): number {
  const blind = bound === "floor" ? reading.floorBlindBytes : reading.ceilingBlindBytes;
  return (blind / reading.scoredBytes) * 100;
}

describe("which bound is gated", () => {
  it("gates the ceiling by default — only incontestable failures", () => {
    const verdict = evaluateCheck(reading(), { maxBlind: 100, pessimistic: false });
    expect(verdict.bound).toBe("ceiling");
    expect(verdict.blindBytes).toBe(reading().ceilingBlindBytes);
  });

  it("--pessimistic gates the floor instead", () => {
    const verdict = evaluateCheck(reading(), { maxBlind: 100, pessimistic: true });
    expect(verdict.bound).toBe("floor");
    expect(verdict.blindBytes).toBe(reading().floorBlindBytes);
  });

  /**
   * The flip, on one repository and one threshold. This is the whole reason
   * the interval exists: the same reading passes on the best case and fails on
   * the evidence, and the CLI refuses to pick one and call it the number.
   */
  it("the same limit can pass the ceiling and fail the floor", () => {
    const subject = reading();
    const between =
      (shareOf(subject, "ceiling") + shareOf(subject, "floor")) / 2;
    expect(shareOf(subject, "ceiling")).toBeLessThan(shareOf(subject, "floor"));

    const optimistic = evaluateCheck(subject, { maxBlind: between, pessimistic: false });
    const pessimistic = evaluateCheck(subject, { maxBlind: between, pessimistic: true });
    expect(optimistic.passed).toBe(true);
    expect(pessimistic.passed).toBe(false);
    expect(checkExit(optimistic)).toBe(EXIT.ok);
    expect(checkExit(pessimistic)).toBe(EXIT.checkFailed);
  });
});

describe("the comparison", () => {
  it("passes a repository exactly at its stated limit", () => {
    const subject = reading();
    const exact = shareOf(subject, "ceiling");
    expect(evaluateCheck(subject, { maxBlind: exact, pessimistic: false }).passed).toBe(true);
  });

  it("fails a hair over it", () => {
    const subject = reading();
    const under = shareOf(subject, "ceiling") - 0.0001;
    expect(evaluateCheck(subject, { maxBlind: under, pessimistic: false }).passed).toBe(false);
  });

  /**
   * The rounding trap: a reading a third of a point under its limit rounds to
   * the limit when printed, and still passes. The verdict is decided on bytes,
   * and the sentence carries the byte counts so the reader can see why.
   */
  it("does not decide on the printed number", () => {
    const subject = reading();
    const exact = shareOf(subject, "floor");
    const verdict = evaluateCheck(subject, { maxBlind: exact - 0.3, pessimistic: true });
    expect(Math.round(verdict.share)).toBe(Math.round(verdict.threshold));
    expect(verdict.passed).toBe(false);
  });

  it("reports the exact share it did not compare on", () => {
    const subject = reading();
    const verdict = evaluateCheck(subject, { maxBlind: 50, pessimistic: true });
    expect(verdict.share).toBeCloseTo(shareOf(subject, "floor"), 10);
    expect(verdict.scoredBytes).toBe(subject.scoredBytes);
  });
});

describe("indeterminate and degenerate readings", () => {
  it("a shallow clone is neither a pass nor a failure", () => {
    const verdict = evaluateCheck(readingOf(SHALLOW).reading, {
      maxBlind: 0,
      pessimistic: false,
    });
    expect(verdict.indeterminate).toBe(true);
    expect(checkExit(verdict)).toBe(EXIT.cannotRead);
  });

  it("a grafted history is the same answer", () => {
    const grafted = readingOf({ ...MIXED, provenance: { grafted: true } }).reading;
    expect(checkExit(evaluateCheck(grafted, { maxBlind: 90, pessimistic: false }))).toBe(
      EXIT.cannotRead,
    );
  });

  it("exit 3 outranks a failure — a fragment cannot fail either", () => {
    const verdict = evaluateCheck(readingOf(SHALLOW).reading, {
      maxBlind: 0,
      pessimistic: true,
    });
    expect(verdict.passed).toBe(false);
    expect(checkExit(verdict)).toBe(EXIT.cannotRead);
  });

  it("a repository with nothing to fathom passes, with nothing to report", () => {
    for (const fixture of [EMPTY, NON_CODE]) {
      const verdict = evaluateCheck(readingOf(fixture).reading, {
        maxBlind: 0,
        pessimistic: true,
      });
      expect(verdict.nothingToGate).toBe(true);
      expect(verdict.passed).toBe(true);
      expect(checkExit(verdict)).toBe(EXIT.ok);
    }
  });

  it("a reading with no spread gates the same number either way", () => {
    // Nothing PR-mediated: ceiling = floor, so `--pessimistic` changes nothing
    // and the gate is exact rather than generous.
    const subject = readingOf(PROMPTED_ONLY).reading;
    const optimistic = evaluateCheck(subject, { maxBlind: 10, pessimistic: false });
    const pessimistic = evaluateCheck(subject, { maxBlind: 10, pessimistic: true });
    expect(optimistic.blindBytes).toBe(pessimistic.blindBytes);
    expect(optimistic.passed).toBe(pessimistic.passed);
  });
});

describe("the threshold has no default", () => {
  it("takes the flag over the config", () => {
    expect(requireThreshold(20, 80)).toBe(20);
    expect(requireThreshold(null, 80)).toBe(80);
    expect(requireThreshold(0, 80)).toBe(0);
  });

  it("refuses to invent one, and names both places it could come from", () => {
    try {
      requireThreshold(null, null);
      throw new Error("expected a usage error");
    } catch (error) {
      if (!isCliError(error)) throw error;
      expect(error.exitCode).toBe(EXIT.usage);
      expect(error.hint).toContain("--max-blind");
      expect(error.hint).toContain(".fathohm.toml");
    }
  });
});
