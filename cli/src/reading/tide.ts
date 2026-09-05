import { BLIND_SPOT_THRESHOLD, scoreFromFactors } from "../../../lib/demo-data";
import { deriveFactors } from "../../../workers/src/scorer";
import { codeTree, type CliEvent } from "../repo/events";
import type { TreeEntry } from "../repo/extract";
import { ceilingFactors, fadeDate } from "./fade";
import { DEFAULT_HORIZON_DAYS, groupEventsByPath } from "./scoring";

/**
 * The tide: one strip, three tenses.
 *
 * A single number is a photograph, and comprehension debt is not a photograph —
 * it accrues while nothing happens. The strip is the argument: twelve months of
 * where the repo has been, today's interval, and what the next ninety days do
 * to it if nobody touches anything. It is the screenshot the product grows on,
 * so what it shows had better be derived rather than dramatised.
 *
 * Two honesty rules make it so.
 *
 * **The past moves only the clock.** Every historical point is a full reading —
 * the same `deriveFactors` and the same threshold — with events filtered to
 * that instant and `now` set to it. What is NOT rewound is the tree: today's
 * files, today's bytes, all the way back. That is a real simplification and the
 * renderer states it, because the alternative (a tree per point) is `--at`,
 * which is a different, heavier reading and a different command. Holding the
 * denominator still is what makes the strip a story about comprehension
 * instead of a story about repo growth.
 *
 * **The future adds no events.** A forecast point is the same event set at a
 * later clock: decay is arithmetic fathohm already owns, so "62% by October" is
 * a calculation, not a guess. Nothing here models commits that have not
 * happened, and nothing here is allowed to.
 *
 * Today's point uses the whole event set, unfiltered — byte-identical to what
 * `scoreRepo` produces for the same inputs. The strip and the headline printed
 * above it are the same number by construction, not by coincidence.
 *
 * Which only holds if the caller hands over the SAME events the card was built
 * from. Under `--without` that means the dropped set, so take them from
 * `readingEvents(extract, without).events` — the one seam that turns a
 * `--without` list into events — and never from `mapEvents` directly.
 */

/** Twelve monthly points behind today: a year, at the resolution of a strip. */
export const TIDE_MONTHS = 12;
/** Forecast points every thirty days, plus one at the horizon itself. */
const FORECAST_STEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TidePoint {
  /** The instant this point was read at, ISO 8601 — the point's own `now`. */
  at: string;
  /** Blind bytes ÷ scored bytes at the floor, 0..1. 0 when nothing is scored. */
  floorShare: number;
  /** The same at the ceiling. Never above `floorShare`. */
  ceilingShare: number;
}

/** The largest thing about to go under, and the day it does. */
export interface NextToFade {
  path: string;
  at: string;
}

export interface TideOptions {
  now: Date;
  /** Monthly points behind today. Defaults to {@link TIDE_MONTHS}. */
  months?: number;
  /** How far the forecast runs. Defaults to {@link DEFAULT_HORIZON_DAYS}. */
  forecastDays?: number;
  /** The config's `exclude` globs — the SAME ones the card was scored with, or
   *  the strip would draw a different repository than the number above it. */
  exclude?: readonly string[];
  /** `--scope`'s subtree, for exactly the same reason as `exclude`. */
  scope?: string | null;
}

export interface TideSeries {
  /**
   * Oldest first, at most `months` long — and SHORTER whenever git's record
   * here is younger than that. See {@link recordStartsAt}.
   */
  past: TidePoint[];
  today: TidePoint;
  /** Nearest first: +30d, +60d, …, and the horizon. */
  forecast: TidePoint[];
  nextToFade: NextToFade | null;
  /**
   * How many monthly points were ASKED for. `past.length` is how many the
   * record could supply, and the renderer needs both to tell "a year, drawn"
   * apart from "a year, asked for, and the repository is ten weeks old".
   */
  monthsRequested: number;
  /**
   * The instant of the earliest event in this reading, ISO 8601, or null when
   * the reading has no events at all.
   *
   * THE STRIP MUST NOT DRAW A REPOSITORY THAT DID NOT EXIST YET. Every point
   * is a full reading at a moved clock, so at any instant before the first
   * commit every file scores as unfathomed and the point renders 100%. On a
   * ten-week-old repository that filled ten of the twelve monthly cells with
   * the deep end of the ramp and printed `2025-08-14: 100% -> today: <1%` —
   * a story of a heroic year-long cleanup, told about a year in which nothing
   * existed. It is the most dramatic line the card can print and it was pure
   * artefact.
   *
   * So the past is trimmed to the record, and the renderer says why rather
   * than silently drawing a shorter strip. Bounded readings (`--since`, a
   * shallow clone) make this the start of what was READ rather than the start
   * of the repository, which is the same distinction the provenance block
   * already draws and the reason this is named for the record and not for the
   * repository's age.
   */
  recordStartsAt: string | null;
}

/**
 * One lane per scored file: its whole event history, and the prefix of it that
 * is visible at the point currently being read.
 *
 * `live` is the same array object for every point in the series — it grows as
 * the clock walks forward and is never rebuilt. Sixteen points over a repo with
 * ten thousand files is sixteen thousand readings; sixteen thousand freshly
 * cloned event arrays is how a strip that renders in a blink becomes a strip
 * that renders in a second.
 */
interface Lane {
  path: string;
  bytes: number;
  history: CliEvent[];
  live: CliEvent[];
  cursor: number;
}

export function tideSeries(
  events: readonly CliEvent[],
  tree: readonly TreeEntry[],
  options: TideOptions,
): TideSeries {
  const { now } = options;
  const months = options.months ?? TIDE_MONTHS;
  const forecastDays = options.forecastDays ?? DEFAULT_HORIZON_DAYS;

  // Idempotent: a caller that already filtered gets the same tree back. The
  // filter is here anyway so the strip cannot end up with a denominator the
  // headline above it does not share.
  const scored = codeTree(tree, options.exclude ?? [], options.scope ?? null);
  const byPath = groupEventsByPath(events, scored);
  const lanes: Lane[] = scored.map((entry) => ({
    path: entry.path,
    bytes: entry.bytes,
    history: byPath.get(entry.path) ?? [],
    live: [],
    cursor: 0,
  }));
  const scoredBytes = lanes.reduce((sum, lane) => sum + lane.bytes, 0);

  // Chronological, because the lanes only ever move forward. Past points open
  // the history a month at a time; today and everything after it hold all of
  // it.
  //
  // Trimmed to the record: a point earlier than the first event reads every
  // file as unfathomed, which is 100% about a repository that did not exist.
  // See `recordStartsAt`. Points ON the first event are kept — that instant is
  // inside the record, and `readAt`'s cutoff is inclusive.
  const recordStartsAt = earliestEvent(lanes);
  const floor = recordStartsAt === null ? null : Date.parse(recordStartsAt);
  const past = monthlyPointsBefore(now, months)
    .filter((at) => floor === null || at.getTime() >= floor)
    .map((at) => readAt(lanes, scoredBytes, at, now));
  const today = readAt(lanes, scoredBytes, now, now);
  const forecast = forecastOffsets(forecastDays).map((days) =>
    readAt(lanes, scoredBytes, new Date(now.getTime() + days * DAY_MS), now),
  );

  return {
    past,
    today,
    forecast,
    nextToFade: findNextToFade(lanes, now, forecastDays),
    monthsRequested: Math.max(0, Math.floor(months)),
    recordStartsAt,
  };
}

/**
 * The earliest event in this reading, or null when there are none.
 *
 * Read off the LANES, which are the events already grouped onto the files this
 * reading weighs. An event on an excluded path or on a file no longer in the
 * tree enters no point on the strip, so letting one set the record's start
 * would extend the strip back over months in which every scored point still
 * reads 100% — the exact artefact the trim exists to remove.
 *
 * Compared as instants rather than as strings: `occurredAt` is ISO 8601 but
 * nothing guarantees one offset across a history, and `2026-01-01T00:00+05:30`
 * sorts after `2026-01-01T00:00Z` lexically while preceding it in time.
 */
function earliestEvent(lanes: readonly Lane[]): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    for (const event of lane.history) {
      const ms = Date.parse(event.occurredAt);
      if (!Number.isFinite(ms) || ms >= earliestMs) continue;
      earliestMs = ms;
      earliest = event.occurredAt;
    }
  }
  return earliest;
}

/**
 * The reading at one instant.
 *
 * The cutoff is the point itself while it is in the past, and unbounded from
 * today onward. That is not a shortcut: a forecast point is defined as the same
 * events at a later clock, and today must agree with `scoreRepo` exactly — and
 * `scoreRepo` applies no time filter at all, so a future-dated event (clock
 * skew, a rebase with a bad `--date`) is inside today's reading. Filtering it
 * out here and letting it back in at +30d would make the strip disagree with
 * the number printed above it.
 */
function readAt(
  lanes: Lane[],
  scoredBytes: number,
  at: Date,
  now: Date,
): TidePoint {
  const cutoff =
    at.getTime() >= now.getTime() ? Number.POSITIVE_INFINITY : at.getTime();

  let floorBlindBytes = 0;
  let ceilingBlindBytes = 0;
  for (const lane of lanes) {
    while (
      lane.cursor < lane.history.length &&
      Date.parse(lane.history[lane.cursor].occurredAt) <= cutoff
    ) {
      lane.live.push(lane.history[lane.cursor]);
      lane.cursor += 1;
    }

    const factors = deriveFactors(lane.live, at);
    const floor = scoreFromFactors(factors);
    if (floor < BLIND_SPOT_THRESHOLD) floorBlindBytes += lane.bytes;

    const prMediated = lane.live.some((event) => event.prMediated);
    const ceiling = prMediated
      ? scoreFromFactors(ceilingFactors(factors))
      : floor;
    if (ceiling < BLIND_SPOT_THRESHOLD) ceilingBlindBytes += lane.bytes;
  }

  return {
    at: at.toISOString(),
    floorShare: share(floorBlindBytes, scoredBytes),
    ceilingShare: share(ceilingBlindBytes, scoredBytes),
  };
}

/**
 * The next file to go under, and when.
 *
 * "Next" is a date question first — this is the thing the reader should look at
 * before it happens — and bytes break the ties, largest first, because two
 * files crossing on the same day are not equally worth naming. Path breaks a
 * tie between equal sizes so two runs of the same repo name the same file.
 *
 * Files already below the line are not candidates: they have faded, and a strip
 * that keeps pointing at them never points at the one still worth saving.
 */
function findNextToFade(
  lanes: readonly Lane[],
  now: Date,
  forecastDays: number,
): NextToFade | null {
  let best: { path: string; at: string; bytes: number } | null = null;
  for (const lane of lanes) {
    const at = fadeDate(
      lane.history,
      deriveFactors(lane.history, now),
      now,
      forecastDays,
    );
    if (at === null) continue;
    if (best === null || beats({ path: lane.path, at, bytes: lane.bytes }, best)) {
      best = { path: lane.path, at, bytes: lane.bytes };
    }
  }
  return best === null ? null : { path: best.path, at: best.at };
}

/** ISO dates compare lexicographically exactly as they compare chronologically. */
function beats(
  candidate: { path: string; at: string; bytes: number },
  best: { path: string; at: string; bytes: number },
): boolean {
  if (candidate.at !== best.at) return candidate.at < best.at;
  if (candidate.bytes !== best.bytes) return candidate.bytes > best.bytes;
  return candidate.path < best.path;
}

function share(blindBytes: number, scoredBytes: number): number {
  return scoredBytes > 0 ? blindBytes / scoredBytes : 0;
}

/** Oldest first: `now` minus `months` months, … , `now` minus one month. */
function monthlyPointsBefore(now: Date, months: number): Date[] {
  const points: Date[] = [];
  for (let back = Math.max(0, Math.floor(months)); back >= 1; back -= 1) {
    points.push(shiftMonths(now, -back));
  }
  return points;
}

/**
 * Calendar-month arithmetic in UTC, clamping the day to the target month's
 * length. Without the clamp, "one month before the 31st of March" is the 3rd of
 * March, and a strip of monthly points quietly stops being monthly.
 */
function shiftMonths(from: Date, delta: number): Date {
  const first = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth() + delta,
    1,
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  );
  const target = new Date(first);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return target;
}

/** +30d, +60d, … strictly inside the horizon, then the horizon itself. */
function forecastOffsets(forecastDays: number): number[] {
  const horizon = Math.floor(forecastDays);
  if (!Number.isFinite(horizon) || horizon <= 0) return [];
  const offsets: number[] = [];
  for (let day = FORECAST_STEP_DAYS; day < horizon; day += FORECAST_STEP_DAYS) {
    offsets.push(day);
  }
  offsets.push(horizon);
  return offsets;
}
