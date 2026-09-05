import { exactBlindShare } from "../../../lib/blind-share-format";
import type { CliEvent } from "../repo/events";
import type { RepoExtract } from "../repo/extract";
import { floorShare, readingWithoutKey } from "./offboard";
import {
  depthOf,
  humanKeysByPath,
  humansOf,
  keeperTally,
  pathsWithCommits,
  tallyFor,
  type ByteTally,
  type Person,
} from "./people";
import { allocateUnits } from "./allocate";
import { readingEvents, type RepoReading, type ScoreOpts } from "./scoring";

/**
 * `fathohm team` — the humans in this history, and the code that has one name
 * on it.
 *
 * WHAT IS RANKED IS CODE. Every row is a quantity of bytes; no row carries a
 * score, a grade or a position for a person. That is not squeamishness, it is
 * the only reading this evidence supports: git shows who committed, and a
 * league table built on that would rank people by how much they were the only
 * one around — which is a fact about how work was allocated, not about how well
 * anybody does it. "212 KB has one name on it" is actionable and true; the
 * inverse leaderboard is neither, and it is the fastest way to make a team stop
 * running this on their own repository.
 *
 * THE SECTION IS A PARTITION, and that is what makes it quotable. Every scored
 * file carries exactly one, two-or-more, or no human names, so the rows are
 * total and disjoint over the same bytes the headline divides by — the keeper
 * loads plus `shared` plus `no human` IS the repository. The printed integers
 * are allocated to a hundred by the ledger's own largest-remainder rule, for the
 * same reason the ledger has one: a column that does not add up in a screenshot
 * refutes the product.
 *
 * THE LEAVE COLUMN IS `offboard`, RUN PER IDENTITY. Not an approximation of it
 * and not a cheaper model — `readingWithoutKey`, the same scorer the offboard
 * card's headline comes out of, keyed on exactly the identity each row names.
 * `fathohm offboard <their email>` prints the same number; `offboard <name>`
 * can print a different one only when the name honestly covers more than one
 * identity, which is the query doing what a query says.
 */

/**
 * One row of the keeper table.
 *
 * `more` is the coda: the humans whose sole-keeper load rounds below a printed
 * unit, folded into a row that still carries their bytes. It is a ROW rather
 * than a footnote precisely so the partition survives the cap — a fold that
 * dropped its bytes out of the column would leave the printed shares summing to
 * something less than the repository.
 */
export type KeeperKind = "keeper" | "more" | "shared" | "no-human";

export interface KeeperRow {
  readonly kind: KeeperKind;
  /** The identity `--without` matches on. Empty on every non-`keeper` row. */
  readonly key: string;
  /** What the row is called: a person's name, or the coda's own label. */
  readonly name: string;
  readonly files: number;
  readonly bytes: number;
  /** Share of the reading's scored bytes, 0–100, exact. */
  readonly share: number;
  /** The share as a PRINTED integer — allocated across the rows to a hundred. */
  readonly units: number;
  /** The byte-weighted mean floor score of the row's own files, 0–1. The bar's
   *  colour and block, on the same scale as the mini-map's. */
  readonly depth: number;
  /** How many humans a `more` row stands for. Zero on every other kind. */
  readonly people: number;
  /** The largest sole-keeper load among them, in bytes. Zero on every other kind. */
  readonly largest: number;
}

/** The whole reading, recomputed without one person. Shares are 0–100. */
export interface LeaveRow {
  readonly name: string;
  readonly key: string;
  readonly before: number;
  readonly after: number;
}

export interface TeamReading {
  readonly reading: RepoReading;
  /** Everybody with demonstrated engagement anywhere in the history. */
  readonly humans: readonly Person[];
  /** The keeper table, in print order: keepers by weight, coda, shared, no human. */
  readonly rows: readonly KeeperRow[];
  /** One per keeper row, in the same order. Empty when nobody is listed. */
  readonly leave: readonly LeaveRow[];
  /**
   * Whether the `no human` row may honestly be called "agent-authored, by
   * declared signals": true only when every no-human file shows at least one
   * commit (all of them agent-declared by construction) AND the reading is the
   * whole history — no `--since` window, no shallow or grafted clone. A file
   * with no visible commits, or a history the reading cannot see all of,
   * supports no authorship claim, and the row says the weaker true thing.
   */
  readonly noHumanAgentAuthored: boolean;
}

export function teamReading(
  extract: RepoExtract<CliEvent>,
  opts: ScoreOpts,
  reading: RepoReading,
  options: { readonly full: boolean } = { full: false },
): TeamReading {
  const events = readingEvents(extract, opts.without).events;
  const humans = humansOf(events);
  const keysByPath = humanKeysByPath(events, extract.tree, opts.exclude ?? [], opts.scope ?? null);
  const tally = keeperTally(reading.files, keysByPath);
  const scoredBytes = reading.scoredBytes;

  // The "agent-authored" label is a claim about authorship, so it is only made
  // where it is checkable: every no-human file carries a commit (necessarily
  // agent-declared — a human or prompted commit would have keyed the path) and
  // the reading saw the whole history. A `--since` window or a truncated clone
  // hides commits that could refute it, and a claim the reader cannot check
  // against their own clone is the one thing no row here is allowed to make.
  const { provenance } = reading;
  const wholeHistory =
    provenance.sinceBound === null && !provenance.shallow && !provenance.grafted;
  const committed = pathsWithCommits(events, extract.tree, opts.exclude ?? [], opts.scope ?? null);
  const noHumanAgentAuthored =
    wholeHistory &&
    reading.files.every(
      (file) => (keysByPath.get(file.path) ?? []).length > 0 || committed.has(file.path),
    );

  // Heaviest first, then name, then key: the row order is the answer to "where
  // is the handover risk", and a table that reordered itself between two runs
  // of the same reading would make every screenshot of it unquotable. Codepoint
  // comparisons, never locale ones — the same bytes must sort the same way in
  // every environment fathohm runs in.
  const keepers = humans
    .map((person) => ({ person, load: tallyFor(tally, person.key) }))
    .sort(
      (a, b) =>
        b.load.bytes - a.load.bytes ||
        compare(a.person.name, b.person.name) ||
        compare(a.person.key, b.person.key),
    );

  // TWO PASSES, because the cap and the allocation depend on each other. The
  // first decides who rounds to a printed unit; the second allocates a hundred
  // across the rows that survived, so the column the reader actually sees is
  // the one that adds up.
  const provisional = allocateUnits(
    [
      ...keepers.map((entry) => exactBlindShare(entry.load.bytes, scoredBytes)),
      exactBlindShare(tally.shared.bytes, scoredBytes),
      exactBlindShare(tally.noHuman.bytes, scoredBytes),
    ],
    UNITS,
  );

  const listed = options.full
    ? keepers
    : keepers.filter((_entry, index) => provisional[index] >= 1);
  const folded = options.full
    ? []
    : keepers.filter((_entry, index) => provisional[index] < 1);

  const draft: Array<Omit<KeeperRow, "units">> = listed.map((entry) => ({
    kind: "keeper" as const,
    key: entry.person.key,
    name: entry.person.name,
    files: entry.load.files,
    bytes: entry.load.bytes,
    share: exactBlindShare(entry.load.bytes, scoredBytes),
    depth: depthOf(entry.load),
    people: 0,
    largest: 0,
  }));

  if (folded.length > 0) {
    // Tallies ADD, which is why they carry the weighted numerator rather than
    // an average: a mean of means would draw this row at a depth no file in it
    // has.
    const load = folded.reduce((sum, entry) => join(sum, entry.load), ZERO);
    draft.push({
      kind: "more",
      key: "",
      name: `${folded.length} more`,
      files: load.files,
      bytes: load.bytes,
      share: exactBlindShare(load.bytes, scoredBytes),
      depth: depthOf(load),
      people: folded.length,
      largest: folded.reduce((most, entry) => Math.max(most, entry.load.bytes), 0),
    });
  }

  // A category with nothing in it is not a row. A repository whose every file
  // has two names on it should not print "no human  0 files  0B" under a
  // section whose subject is where the risk is.
  if (tally.shared.files > 0) {
    draft.push({
      kind: "shared",
      key: "",
      name: "shared",
      files: tally.shared.files,
      bytes: tally.shared.bytes,
      share: exactBlindShare(tally.shared.bytes, scoredBytes),
      depth: depthOf(tally.shared),
      people: 0,
      largest: 0,
    });
  }
  if (tally.noHuman.files > 0) {
    draft.push({
      kind: "no-human",
      key: "",
      name: "no human",
      files: tally.noHuman.files,
      bytes: tally.noHuman.bytes,
      share: exactBlindShare(tally.noHuman.bytes, scoredBytes),
      depth: depthOf(tally.noHuman),
      people: 0,
      largest: 0,
    });
  }

  const units = allocateUnits(
    draft.map((row) => row.share),
    UNITS,
  );
  const rows = draft.map((row, index) => ({ ...row, units: units[index] }));

  return {
    reading,
    humans,
    rows,
    leave: listed.map((entry) => ({
      name: entry.person.name,
      key: entry.person.key,
      before: floorShare(reading),
      // The key, never the display name — and through the KEY-EXACT matcher,
      // never `dropAuthor`'s broad one: two people can share a name, and when
      // one of them has no commit email their key IS that name, so the broad
      // matcher would quietly remove both and print a number about nobody.
      // `readingWithoutKey` removes exactly the identity the scorer counts.
      after: floorShare(readingWithoutKey(extract, opts, entry.person.key)),
    })),
    noHumanAgentAuthored,
  };
}

/** A whole, in printed units. The column adds to this or the table is wrong. */
const UNITS = 100;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const ZERO: ByteTally = { files: 0, bytes: 0, weighted: 0 };

function join(a: ByteTally, b: ByteTally): ByteTally {
  return {
    files: a.files + b.files,
    bytes: a.bytes + b.bytes,
    weighted: a.weighted + b.weighted,
  };
}
