import { describe, expect, it } from "vitest";

import {
  BLIND_SPOT_THRESHOLD,
  scoreFromFactors,
  WEIGHTS,
} from "../../../lib/demo-data";
import { deriveFactors } from "../../../workers/src/scorer";
import type { CliEvent } from "../repo/events";
import { ceilingFactors, fadeDate, holdsAtCeiling, recencyAt } from "./fade";

/**
 * The fade curve, pinned against arithmetic done by hand.
 *
 * A fade date is a claim fathohm makes about a day nobody has lived through
 * yet, so the only acceptable evidence for it is the closed-form solution of
 * the scorer's own equation. Every assertion here either solves
 * `0.25·(1 − (t/180)²) + 0.25·bus = 0.30` for `t` independently and checks the
 * bisection found the same day, or pins a number the founder's live readings
 * already produced.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_WINDOW_DAYS = 180;

function at(iso: string): Date {
  return new Date(iso);
}

function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

let serial = 0;

function commit(options: {
  occurredAt: string;
  actorId?: string;
  authorship?: CliEvent["authorship"];
  prMediated?: boolean;
}): CliEvent {
  serial += 1;
  const actorId = options.actorId ?? "ada@example.dev";
  return {
    kind: "commit",
    actorId,
    authorship: options.authorship ?? "human",
    occurredAt: options.occurredAt,
    reviewCommentCount: 0,
    paths: [`src/f${serial}.ts`],
    prMediated: options.prMediated ?? false,
    agentSignature: null,
    actorName: actorId,
    actorEmail: actorId,
  };
}

/**
 * The exact instant a solo file crosses the line, solved rather than searched.
 *
 * score(t) = 0.25·(1 − (t/180)²) + 0.25·bus, and the crossing is where that
 * equals 0.30 — so t = 180·√(1 − (0.30 − 0.25·bus) / 0.25). Note the shape of
 * the answer: it depends only on the bus factor, which is why one hand-written
 * author working alone always gets the same 65.73 days, in every repo, forever.
 */
function closedFormCrossing(busFactor: number): number {
  const staticTerms = WEIGHTS.bus_factor * busFactor;
  const recencyNeeded =
    (BLIND_SPOT_THRESHOLD - staticTerms) / WEIGHTS.human_author_recency;
  return RECENCY_WINDOW_DAYS * Math.sqrt(1 - recencyNeeded);
}

describe("the cliff — where a solo hand-written file crosses", () => {
  const SOLO_HAND_WRITTEN_CROSSING_DAYS = 65.7267;

  it("is 65.73 days in closed form, for one hand-writing author alone", () => {
    // bus = min(1, 1/3): one person, full weight. The number the v2 decay note
    // in workers/src/scorer.ts states as "between day 65 and day 66".
    expect(closedFormCrossing(1 / 3)).toBeCloseTo(
      SOLO_HAND_WRITTEN_CROSSING_DAYS,
      3,
    );
  });

  it("holds at day 65 and has gone under by day 66", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const events = [commit({ occurredAt: authored.toISOString() })];

    const day65 = scoreFromFactors(
      deriveFactors(events, daysAfter(authored, 65)),
    );
    const day66 = scoreFromFactors(
      deriveFactors(events, daysAfter(authored, 66)),
    );

    expect(day65).toBeCloseTo(0.300733, 6);
    expect(day65).toBeGreaterThanOrEqual(BLIND_SPOT_THRESHOLD);
    expect(day66).toBeCloseTo(0.299722, 6);
    expect(day66).toBeLessThan(BLIND_SPOT_THRESHOLD);
  });
});

describe("fadeDate — the day, by bisection", () => {
  /**
   * The day convention, stated once and pinned everywhere below: a file fades
   * on the UTC calendar day CONTAINING the crossing instant — equivalently, the
   * first day whose END (midnight opening the next day) is below the line while
   * the previous day's end still held.
   */
  function expectedFadeDay(from: Date, crossingDays: number): string {
    return new Date(from.getTime() + crossingDays * DAY_MS)
      .toISOString()
      .slice(0, 10);
  }

  it("lands on the day the closed-form crossing falls inside", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const now = authored;
    const events = [commit({ occurredAt: authored.toISOString() })];
    const factors = deriveFactors(events, now);

    // 2026-01-01 + 65.7267d = 2026-03-07T17:26Z. End of 2026-03-06 is t = 65
    // (above); end of 2026-03-07 is t = 66 (below). So: 2026-03-07.
    expect(fadeDate(events, factors, now, 90)).toBe("2026-03-07");
    expect(fadeDate(events, factors, now, 90)).toBe(
      expectedFadeDay(authored, closedFormCrossing(1 / 3)),
    );
  });

  it("agrees with the closed form from any starting clock", () => {
    const authored = at("2026-01-01T09:41:17Z");
    const crossing = closedFormCrossing(1 / 3);
    const events = [commit({ occurredAt: authored.toISOString() })];

    // Walk `now` forward day by day while the file is still above the line.
    // The answer is the same calendar day every time — the crossing does not
    // move because somebody read the repo on a different morning.
    for (let offset = 0; offset < 65; offset += 1) {
      const now = daysAfter(authored, offset);
      const factors = deriveFactors(events, now);
      expect(fadeDate(events, factors, now, 90)).toBe(
        expectedFadeDay(authored, crossing),
      );
    }
  });

  it("agrees with the closed form across bus factors", () => {
    const authored = at("2026-02-14T00:00:00Z");
    // One, two and three hand-writing authors: bus 1/3, 2/3, 1. All commit on
    // the same day, so recency is identical and only the static term moves.
    for (const people of [1, 2, 3]) {
      const events = Array.from({ length: people }, (_, index) =>
        commit({
          occurredAt: authored.toISOString(),
          actorId: `dev${index}@example.dev`,
        }),
      );
      const factors = deriveFactors(events, authored);
      const crossing = closedFormCrossing(Math.min(1, people / 3));

      expect(fadeDate(events, factors, authored, 200)).toBe(
        expectedFadeDay(authored, crossing),
      );
    }
  });

  it("is null when the file is already below the line", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const now = daysAfter(authored, 101);
    const events = [commit({ occurredAt: authored.toISOString() })];
    const factors = deriveFactors(events, now);

    expect(scoreFromFactors(factors)).toBeLessThan(BLIND_SPOT_THRESHOLD);
    expect(fadeDate(events, factors, now, 90)).toBeNull();
  });

  it("is null when the crossing is past the horizon", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const events = [commit({ occurredAt: authored.toISOString() })];
    const factors = deriveFactors(events, authored);

    // It crosses on day 65 — inside 90, outside 30 and outside 65.
    expect(fadeDate(events, factors, authored, 30)).toBeNull();
    expect(fadeDate(events, factors, authored, 64)).toBeNull();
    expect(fadeDate(events, factors, authored, 65)).toBe("2026-03-07");
  });

  it("fades today when the crossing lands inside today", () => {
    const authored = at("2026-01-01T00:00:00Z");
    // 65.7267 days in: past the crossing instant is impossible (the file would
    // already be below), so read it at the top of the crossing day.
    const now = at("2026-03-07T00:00:00Z");
    const events = [commit({ occurredAt: authored.toISOString() })];
    const factors = deriveFactors(events, now);

    expect(scoreFromFactors(factors)).toBeGreaterThanOrEqual(
      BLIND_SPOT_THRESHOLD,
    );
    expect(fadeDate(events, factors, now, 90)).toBe("2026-03-07");
  });

  it("follows the most recent engagement, not the first", () => {
    const old = at("2026-01-01T00:00:00Z");
    const fresh = at("2026-02-01T00:00:00Z");
    const events = [
      commit({ occurredAt: old.toISOString(), actorId: "ada@example.dev" }),
      commit({ occurredAt: fresh.toISOString(), actorId: "grace@example.dev" }),
    ];
    const factors = deriveFactors(events, fresh);

    // Two people, so bus is 2/3 and the crossing moves out with it — measured
    // off the FRESH commit, which is what recency maxes to.
    expect(fadeDate(events, factors, fresh, 200)).toBe(
      new Date(fresh.getTime() + closedFormCrossing(2 / 3) * DAY_MS)
        .toISOString()
        .slice(0, 10),
    );
    // And not off the old one: that day is a month earlier and already past.
    expect(
      new Date(old.getTime() + closedFormCrossing(2 / 3) * DAY_MS)
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-05-03");
  });

  it("refuses a nonsense horizon rather than inventing a date", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const events = [commit({ occurredAt: authored.toISOString() })];
    const factors = deriveFactors(events, authored);

    expect(fadeDate(events, factors, authored, -1)).toBeNull();
    expect(fadeDate(events, factors, authored, Number.NaN)).toBeNull();
  });

  it("never touches the events it is handed", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const events = [commit({ occurredAt: authored.toISOString() })];
    const before = JSON.stringify(events);

    fadeDate(events, deriveFactors(events, authored), authored, 90);

    expect(JSON.stringify(events)).toBe(before);
  });
});

describe("recencyAt — the scorer's own curve, walked forward", () => {
  it("reproduces deriveFactors at any clock", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const events = [
      commit({ occurredAt: authored.toISOString() }),
      commit({
        occurredAt: daysAfter(authored, 20).toISOString(),
        authorship: "mixed",
      }),
    ];

    for (const offset of [0, 1, 30, 65, 66, 179, 180, 400]) {
      const clock = daysAfter(authored, offset);
      expect(recencyAt(events, clock)).toBe(
        deriveFactors(events, clock).human_author_recency,
      );
    }
  });

  it("only ever falls as the clock moves forward", () => {
    const authored = at("2026-01-01T00:00:00Z");
    const events = [commit({ occurredAt: authored.toISOString() })];

    let previous = Number.POSITIVE_INFINITY;
    for (let day = 0; day <= 200; day += 1) {
      const value = recencyAt(events, daysAfter(authored, day));
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBe(0);
  });
});

describe("holdsAtCeiling — computed, not asserted", () => {
  const authored = at("2026-01-01T00:00:00Z");
  const events = [commit({ occurredAt: authored.toISOString() })];
  const factors = deriveFactors(events, authored);

  it("holds forever for a PR-mediated file", () => {
    expect(holdsAtCeiling({ factors, prMediated: true })).toBe(true);
  });

  it("does not hold for a file that never went through a pull request", () => {
    expect(holdsAtCeiling({ factors, prMediated: false })).toBe(false);
  });

  it("is the arithmetic, not a constant: review credit alone clears the line", () => {
    // Why it holds: 0.4 × 1 = 0.40 > 0.30, with everything that decays at zero.
    // Asserted as the relationship rather than as `true`, so moving the line or
    // the weight changes the answer instead of silently keeping it.
    expect(WEIGHTS.human_review_depth).toBeGreaterThanOrEqual(
      BLIND_SPOT_THRESHOLD,
    );

    const settled = {
      ...ceilingFactors(factors),
      human_author_recency: 0,
      question_answerability: 0,
    };
    expect(scoreFromFactors(settled)).toBeCloseTo(
      WEIGHTS.human_review_depth + WEIGHTS.bus_factor * factors.bus_factor,
      12,
    );
  });

  it("survives a file whose only contact has fully decayed", () => {
    const ancient = deriveFactors(events, daysAfter(authored, 900));
    expect(ancient.human_author_recency).toBe(0);
    expect(holdsAtCeiling({ factors: ancient, prMediated: true })).toBe(true);
    expect(holdsAtCeiling({ factors: ancient, prMediated: false })).toBe(false);
  });
});
