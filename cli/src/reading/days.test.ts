import { describe, expect, it } from "vitest";

import { daysBetween } from "./days";

/**
 * The two properties the ages on every card rest on.
 *
 * `daysBetween` had no test of its own for as long as it lived among the
 * padding helpers in `render/text.ts` — it was covered only through whatever
 * card happened to print an age. These assert the rule rather than a printed
 * string, so a card that stops showing an age cannot quietly take the coverage
 * with it.
 */

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-08-19T12:00:00Z");

function plus(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

describe("daysBetween", () => {
  it("floors rather than rounds — a day is whole or it has not happened", () => {
    // The property that matters: a reader checking "300d ago" against `git log`
    // must never find the commit a day off because 23h59m rounded up.
    for (const fraction of [0.01, 0.5, 0.9, 0.99]) {
      expect(daysBetween(T0, plus(DAY * (5 + fraction)))).toBe(5);
    }
    expect(daysBetween(T0, plus(DAY * 6))).toBe(6);
  });

  it("clamps at zero, so a commit dated in the future never prints -4d ago", () => {
    // Wrong clocks, rebases and signed backdates all put commits ahead of the
    // reading's `now`. A negative age is a sentence about nothing.
    for (const ahead of [1, DAY, DAY * 400]) {
      expect(daysBetween(plus(ahead), T0)).toBe(0);
    }
    expect(daysBetween(T0, T0)).toBe(0);
  });

  it("is the difference, not the calendar: no timezone or DST term", () => {
    // Whole DAY_MS units. Two instants exactly N×24h apart are N days apart
    // wherever on the globe they were recorded — which is what a git-only
    // reading is entitled to say, since it never learns a local timezone.
    for (const days of [1, 7, 90, 180, 3650]) {
      expect(daysBetween(T0, plus(DAY * days))).toBe(days);
    }
  });
});
