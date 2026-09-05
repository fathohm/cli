import { engagementWeight } from "../../../workers/src/scorer";
import { codeTree, type CliEvent } from "../repo/events";
import type { TreeEntry } from "../repo/extract";
import { groupEventsByPath, type ScoredFile } from "./scoring";

/**
 * WHO GIT SAYS IS IN THIS HISTORY — the identities behind `--without`, and the
 * one place a file's human names are counted.
 *
 * There is no new judgement in this file. A person "is in a file's history"
 * exactly when the SCORER says so: `engagementWeight` prices what an event
 * demonstrated, and a weight above zero is the same test `bus_factor` sums and
 * the same one the card's "1 human in its history" clause reads off
 * `contributors`. An agent-authored commit is weightless there, so it is
 * weightless here — otherwise `fathohm team` would print a keeper the card had
 * just said does not exist.
 *
 * WHAT THIS IS NOT. It is not a measurement of a person. Nothing in this module
 * or anything downstream of it attaches a score, a grade or a rank to a human
 * being: what is ranked is BYTES OF CODE, by how few names appear in their
 * history. "212 KB has one name on it" is a fact about a repository and a thing
 * a team can act on; "priya is a 3.2" is a claim about somebody's competence
 * that this evidence could not support even if the product wanted to make it.
 *
 * The identity is `authorKeyFor`'s — the lowercased email — because that is
 * what the scorer counts. One human writing as two spellings of their name from
 * one address is one keeper, not two, and the CLI must agree with the dashboard
 * about that or the two products disagree about how many people a file has.
 */

/** One human in the history: the identity that scores, and what to call them. */
export interface Person {
  /** `authorKeyFor`'s key — the identity `bus_factor` counts. */
  readonly key: string;
  /**
   * The display name, and the ONLY thing here that is a choice: the name on
   * their newest commit, so somebody who changed how they spell it is called
   * what they call themselves now. Ties break lexicographically, because a name
   * that moved between two runs would make the card untestable.
   */
  readonly name: string;
}

/** A count of files, the bytes they carry, and how deep those bytes are. */
export interface ByteTally {
  readonly files: number;
  readonly bytes: number;
  /**
   * Σ (floor score × bytes) — the byte-weighted depth before it is divided.
   *
   * Carried as the numerator rather than as an average so that two tallies can
   * be ADDED: the keeper coda folds several people into one row, and a mean of
   * means weighted by nothing would draw that row at a depth no file has. The
   * same quantity the mini-map's rows and the ledger's headings are drawn from,
   * so one colour means one thing across the whole product.
   */
  readonly weighted: number;
}

/**
 * Everybody with demonstrated engagement anywhere in these events, by key.
 *
 * The WHOLE history, not just the files still in the tree: "3 humans in its
 * history" is a statement about the history, and a person whose every file was
 * deleted last year was still here. They simply carry no bytes, which the
 * keeper table then says out loud.
 *
 * Sorted by key, so the order is the same on every machine before anybody sorts
 * it by weight.
 */
export function humansOf(events: readonly CliEvent[]): Person[] {
  const newest = new Map<string, { at: number; name: string }>();
  for (const event of events) {
    if (engagementWeight(event) <= 0) continue;
    const at = Date.parse(event.occurredAt);
    const held = newest.get(event.actorId);
    if (held === undefined || at > held.at || (at === held.at && event.actorName < held.name)) {
      newest.set(event.actorId, { at, name: event.actorName });
    }
  }
  return [...newest.entries()]
    .map(([key, held]) => ({ key, name: held.name }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The human keys on each scored path, in key order.
 *
 * Restricted to the tree (through `groupEventsByPath`), because the question is
 * about code that exists: a file deleted two releases ago has no bytes in the
 * denominator and cannot be handed over.
 */
export function humanKeysByPath(
  events: readonly CliEvent[],
  tree: readonly TreeEntry[],
  exclude: readonly string[] = [],
  scope: string | null = null,
): Map<string, string[]> {
  const grouped = groupEventsByPath(events, codeTree(tree, exclude, scope));
  const keys = new Map<string, string[]>();
  for (const [path, group] of grouped) {
    const found = new Set<string>();
    for (const event of group) {
      if (engagementWeight(event) > 0) found.add(event.actorId);
    }
    keys.set(path, [...found].sort());
  }
  return keys;
}

/**
 * The scored paths whose reading carries at least one COMMIT.
 *
 * The team card's `no human` row may only say "agent-authored" when the label
 * is checkable: on a no-human path, every commit the reading can see is
 * agent-declared BY CONSTRUCTION (a human or prompted commit would have put a
 * key on the path), so one commit is enough to ground the claim. A path with
 * no commits at all — outside a `--since` window, or carrying nothing but
 * weightless approvals — supports no authorship claim in either direction,
 * and the row has to say the weaker true thing instead.
 */
export function pathsWithCommits(
  events: readonly CliEvent[],
  tree: readonly TreeEntry[],
  exclude: readonly string[] = [],
  scope: string | null = null,
): Set<string> {
  const grouped = groupEventsByPath(events, codeTree(tree, exclude, scope));
  const found = new Set<string>();
  for (const [path, group] of grouped) {
    if (group.some((event) => event.kind === "commit")) found.add(path);
  }
  return found;
}

/**
 * THE PARTITION every keeper table is drawn from: each scored file falls in
 * exactly one place, by how many human names its history carries.
 *
 * One name → that person's tally. Two or more → `shared`. None → `noHuman`,
 * which on a repository with agents in it is the largest row on the card and
 * the reason the product exists.
 *
 * Total and disjoint BY CONSTRUCTION — every file is visited once and lands in
 * exactly one bucket — which is what lets the renderer claim its rows partition
 * the scored bytes rather than merely hoping they do.
 */
export interface KeeperTally {
  /** Files whose history carries exactly one human name, by that person's key. */
  readonly sole: Map<string, ByteTally>;
  /** Two or more names. */
  readonly shared: ByteTally;
  /** No name at all — no human engagement anywhere in the reading. Usually
   *  agent-authored code, but the RENDERER decides whether that stronger label
   *  is checkable (see `pathsWithCommits`); this tally only counts names. */
  readonly noHuman: ByteTally;
  readonly scoredBytes: number;
}

export function keeperTally(
  files: readonly ScoredFile[],
  keysByPath: ReadonlyMap<string, readonly string[]>,
): KeeperTally {
  const sole = new Map<string, ByteTally>();
  let shared = EMPTY;
  let noHuman = EMPTY;
  let scoredBytes = 0;

  for (const file of files) {
    scoredBytes += file.bytes;
    const keys = keysByPath.get(file.path) ?? [];
    if (keys.length === 0) noHuman = add(noHuman, file);
    else if (keys.length > 1) shared = add(shared, file);
    else sole.set(keys[0], add(sole.get(keys[0]) ?? EMPTY, file));
  }

  return { sole, shared, noHuman, scoredBytes };
}

const EMPTY: ByteTally = { files: 0, bytes: 0, weighted: 0 };

function add(tally: ByteTally, file: ScoredFile): ByteTally {
  return {
    files: tally.files + 1,
    bytes: tally.bytes + file.bytes,
    weighted: tally.weighted + file.floor * file.bytes,
  };
}

/** A tally's depth, 0..1 — the byte-weighted mean floor of the files in it.
 *  Empty reads as zero: a row with no bytes has no depth to draw. */
export function depthOf(tally: ByteTally): number {
  return tally.bytes > 0 ? tally.weighted / tally.bytes : 0;
}

/** A tally that is not there, so a caller never has to test for absence. */
export function tallyFor(tally: KeeperTally, key: string): ByteTally {
  return tally.sole.get(key) ?? EMPTY;
}
