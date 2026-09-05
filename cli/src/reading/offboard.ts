import { exactBlindShare } from "../../../lib/blind-share-format";
import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import type { DerivedFactors } from "../../../workers/src/scorer";
import { dropAuthor, type CliEvent } from "../repo/events";
import type { RepoExtract } from "../repo/extract";
import { daysBetween } from "./days";
import { humanKeysByPath, humansOf } from "./people";
import { byDisplayOrder } from "./kind";
import {
  readingEvents,
  scoreRepo,
  type RepoReading,
  type ScoreOpts,
  type ScoredFile,
} from "./scoring";

/**
 * `fathohm offboard <author>` — the reading the day somebody leaves.
 *
 * THERE IS NO SCORING IN THIS FILE, and that is the whole design. The
 * simulation is `scoreRepo` run twice: once on the history as it stands, once
 * on the same history with one more name in `--without`. Every number the card
 * prints is the difference between two readings the product already knows how
 * to defend, which means the answer to "how did you get 87%" is "we ran the
 * scorer, here is the other run" rather than a model of departure that nobody
 * can check.
 *
 * WHAT IS BEING SIMULATED, EXACTLY. Their commits stay in git's record — the
 * repository is not rewritten and nothing is deleted. What the second reading
 * removes is their ENGAGEMENT: the events they authored stop counting, so
 * recency re-maxes over whoever is left, `bus_factor` loses their weight, and
 * the buckets re-derive. That is the only version of "what happens when they
 * leave" a deterministic scorer can answer honestly, and it is a lower bound on
 * the real loss rather than a forecast of it.
 *
 * WHAT IT REFUSES TO SAY. Nothing here scores a person. The subject of every
 * sentence this produces is a FILE or a REPOSITORY: how much code would sit
 * below the line, which paths cross, how many names are in their history. A
 * per-person score would be a claim about somebody's competence that git
 * metadata could not support even if the product wanted to make it — and the
 * inverse leaderboard it would invite is the fastest way to make a team stop
 * trusting the tool on their own repository.
 *
 * MONOTONICITY IS A THEOREM, NOT A HOPE. Removing events can only lower every
 * factor's maximum, so no file's score can rise when somebody is taken out.
 * The card prints that as a sentence because it is provable, and
 * `offboard.test.ts` proves it over generated readings rather than trusting the
 * argument.
 */

/** One file that is above the line today and below it without the named person. */
export interface OffboardCrossing {
  readonly path: string;
  readonly bytes: number;
  /** The floor score today. */
  readonly before: number;
  /** The floor score with them removed. */
  readonly after: number;
  /** WHICH factor moved, read off the two factor sets. Never an adjective. */
  readonly clause: string;
}

export interface OffboardReading {
  /** The query as typed — what the card calls them. */
  readonly name: string;
  /** Whether it named anybody at all. A simulation that removed nobody looks
   *  exactly like a repository that is fine without them. */
  readonly matched: boolean;
  /** The reading as it stands (already carrying any `--without` baseline). */
  readonly before: RepoReading;
  /** The same reading with this person's engagement removed as well. */
  readonly after: RepoReading;
  /**
   * Code whose history carries their identity keys and nobody else's. Share is
   * 0–100. PERSON-LEVEL and computed from git's full record: a query that
   * covers two of their addresses counts a file carrying both, and a
   * `--without` baseline never leaks into it — this is a sentence about the
   * repository, not about the simulation.
   */
  readonly soleKeeper: {
    readonly files: number;
    readonly bytes: number;
    readonly share: number;
  };
  /** True when they are the only human anywhere on git's record — the full
   *  history, regardless of any `--without` baseline. */
  readonly onlyHuman: boolean;
  /** Every crossing, in the card's print order — uncapped; the card defers. */
  readonly crossings: OffboardCrossing[];
}

/**
 * The reading with one more person removed — the ONE way this simulation is
 * ever computed.
 *
 * `fathohm team` prints a leave column for every person it lists, and a second
 * implementation of "the reading without them" would eventually disagree with
 * the card `offboard` prints for the same person, on the same repository, in
 * the same terminal.
 */
export function readingWithout(
  extract: RepoExtract<CliEvent>,
  opts: ScoreOpts,
  query: string,
): RepoReading {
  return scoreRepo(extract, { ...opts, without: [...opts.without, query] });
}

/**
 * The same simulation, keyed on an IDENTITY rather than a query.
 *
 * The team card's leave column already holds the key the scorer counts, and a
 * key must not go back through `dropAuthor`'s reader-friendly match: a person
 * with no commit email has their NAME as their key, and the broad matcher
 * would also remove a different person who shares it. One row, one identity.
 * (`offboard <query>` stays broad on purpose — a reader types whatever they
 * know, and a query can honestly cover several identities of one person.)
 */
export function readingWithoutKey(
  extract: RepoExtract<CliEvent>,
  opts: ScoreOpts,
  key: string,
): RepoReading {
  return scoreRepo(extract, {
    ...opts,
    withoutKeys: [...(opts.withoutKeys ?? []), key],
  });
}

/** A reading's floor share as a percent, 0–100 — the headline both cards move. */
export function floorShare(reading: RepoReading): number {
  return exactBlindShare(reading.floorBlindBytes, reading.scoredBytes);
}

/** The same for the other end of the interval. */
export function ceilingShare(reading: RepoReading): number {
  return exactBlindShare(reading.ceilingBlindBytes, reading.scoredBytes);
}

/**
 * The whole simulation. `before` is injectable only so the caller can hand over
 * the reading it has already computed — the default is the same expression.
 */
export function offboardReading(
  extract: RepoExtract<CliEvent>,
  opts: ScoreOpts,
  query: string,
  before: RepoReading = scoreRepo(extract, opts),
): OffboardReading {
  const after = readingWithout(extract, opts, query);
  // The LAST match is this query's: `readingWithout` appended it, and naming
  // somebody already in `--without` must report an honest second match rather
  // than a phantom miss.
  const matched = after.withoutMatches[after.withoutMatches.length - 1]?.matched === true;

  // CLAIMS ABOUT GIT'S RECORD COME FROM GIT'S RECORD. "Only human in its
  // history" and the sole-keeper count are sentences about the repository, so
  // they are computed from the FULL history — never from the baseline that a
  // pre-existing `--without` already stripped. `offboard priya --without sam`
  // must not call priya "the only human in this history" of a repo whose
  // record shows three, and must not count files she shared with sam as hers
  // alone. Only the two SCORE readings (`before`/`after`) compose with the
  // baseline, because they are the simulation; these sentences are not.
  const record = readingEvents(extract, []).events;
  const removed = removedKeys(record, query);
  const keysByPath = humanKeysByPath(record, extract.tree, opts.exclude ?? [], opts.scope ?? null);

  // PERSON-LEVEL, not key-level: one person can be several identities (the
  // same name over two commit addresses is the everyday case), and the query
  // matched all of them. A file is theirs alone exactly when every human key
  // in its history belongs to the removed set — summing per-key sole tallies
  // would send a file carrying two of their own addresses to `shared` and
  // contradict the HANDOVER clause two sections down.
  let files = 0;
  let bytes = 0;
  for (const file of before.files) {
    const keys = keysByPath.get(file.path) ?? [];
    if (keys.length > 0 && keys.every((key) => removed.has(key))) {
      files += 1;
      bytes += file.bytes;
    }
  }

  const everyHuman = humansOf(record);
  return {
    name: query,
    matched,
    before,
    after,
    soleKeeper: {
      files,
      bytes,
      share: exactBlindShare(bytes, before.scoredBytes),
    },
    onlyHuman: everyHuman.length > 0 && everyHuman.every((person) => removed.has(person.key)),
    crossings: crossingsBetween(
      before,
      after,
      before.withoutMatches.some((match) => match.matched),
    ),
  };
}

/**
 * The identity keys a `--without` query names, found by running the matcher
 * rather than by reimplementing it.
 *
 * `dropAuthor` only ever removes, so the events it did not return ARE the
 * matched ones. One matcher, so the person the card describes is exactly the
 * person the second reading removed.
 */
function removedKeys(events: readonly CliEvent[], query: string): Set<string> {
  const kept = new Set(dropAuthor([...events], query));
  const keys = new Set<string>();
  for (const event of events) {
    if (!kept.has(event)) keys.add(event.actorId);
  }
  return keys;
}

/**
 * Above the line today, below it without them — in the card's own print order.
 *
 * `byDisplayOrder` rather than "biggest first", because it is the order the
 * ledger, the ordinal argument and the picker already use: application code
 * ahead of scaffolding, tests and styles last, bytes descending inside a tier.
 * A handover list that led with a schema dump would be the same failure the
 * kind tiers exist to fix, one command over.
 */
function crossingsBetween(
  before: RepoReading,
  after: RepoReading,
  baselined: boolean,
): OffboardCrossing[] {
  const afterByPath = new Map(after.files.map((file) => [file.path, file]));
  const crossings: Array<{ file: ScoredFile; after: ScoredFile }> = [];
  for (const file of before.files) {
    if (file.floor < BLIND_SPOT_THRESHOLD) continue;
    const later = afterByPath.get(file.path);
    if (later === undefined || later.floor >= BLIND_SPOT_THRESHOLD) continue;
    crossings.push({ file, after: later });
  }
  return crossings
    .sort((a, b) => byDisplayOrder(a.file, b.file))
    .map(({ file, after: later }) => ({
      path: file.path,
      bytes: file.bytes,
      before: file.floor,
      after: later.floor,
      clause: crossingClause(file.factors, later.factors, after.now, baselined),
    }));
}

/**
 * WHY THIS FILE CROSSED — one clause, read off the two factor sets.
 *
 * The lexicon is closed and it lives here alone, because this is the sentence a
 * reader will quote in a handover document and it has to be checkable against
 * the same clone. Each clause names the factor that moved and nothing else: no
 * adjectives, no "critical", no claim about what anybody understands.
 *
 * THE ORDER IS THE DAMAGE. Losing the last human in a file's history outranks
 * losing its most recent contact, which outranks losing one of several names —
 * a file that answers more than one of them is described by the worst.
 *
 * The counts come from `contributors`, which is `bus_factor`'s own decomposition
 * (people with a non-zero engagement weight), so "1 of 2 humans" is the same 2
 * the card prints beside the file today.
 *
 * UNDER A `--without` BASELINE THE CLAUSES SAY "REMAINING". The factor sets
 * this reads are the baseline-composed reading's, so with sam already removed
 * a priya-and-sam file counts one human — and "only human in its history"
 * would be false against git's record, which still shows sam. "Remaining"
 * scopes each claim to the reading the card is actually about, and it only
 * appears when a baseline matched: on a plain `offboard` the reading IS the
 * record and the shorter sentence is the checkable one.
 */
export function crossingClause(
  before: DerivedFactors,
  after: DerivedFactors,
  now: Date,
  baselined = false,
): string {
  const humansBefore = humanCount(before);
  const humansAfter = humanCount(after);
  const remaining = baselined ? "remaining " : "";

  if (humansBefore > 0 && humansAfter === 0) return `only ${remaining}human in its history`;

  const contactAfter = newestContact(after);
  if (newestContact(before) !== contactAfter && contactAfter !== null) {
    return (
      `newest ${remaining}human commit falls to ` +
      `${daysBetween(new Date(contactAfter), now)}d ago`
    );
  }

  if (humansAfter === humansBefore - 1) {
    return `1 of ${humansBefore} ${remaining}humans in its history`;
  }

  // Nothing named above moved, and the file crossed anyway. Says what is
  // certainly true and refuses to guess which factor did it.
  return "their engagement leaves its history";
}

function humanCount(factors: DerivedFactors): number {
  const { full, prompted } = factors.engagement.contributors;
  return full + prompted;
}

/** The newest human contact of any kind — hand-written or prompted. */
function newestContact(factors: DerivedFactors): string | null {
  const { last_hand_authored, last_prompted } = factors.engagement;
  if (last_hand_authored === null) return last_prompted;
  if (last_prompted === null) return last_hand_authored;
  return Date.parse(last_prompted) > Date.parse(last_hand_authored)
    ? last_prompted
    : last_hand_authored;
}
