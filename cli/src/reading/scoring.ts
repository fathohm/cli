import { BLIND_SPOT_THRESHOLD, scoreFromFactors } from "../../../lib/demo-data";
import { deriveFactors, type DerivedFactors } from "../../../workers/src/scorer";
import { isDark } from "./dark";
import { codeTree, dropActorKey, dropAuthor, mapEvents, type CliEvent } from "../repo/events";
import type { Provenance, RepoExtract, TreeEntry } from "../repo/extract";
import { ceilingFactors, fadeDate } from "./fade";
import { signatureBytes, type SignatureBytes } from "./signatures";

/**
 * The scoring adapter: a repository's git history in, a reading out.
 *
 * There is no scoring in this file. `deriveFactors` and `scoreFromFactors` are
 * imported from the pipeline the dashboard runs, and every number below is one
 * of them applied to events this repo's own git produced. What this module
 * contributes is the three things a git-only reading needs that a hosted one
 * does not:
 *
 * **The interval.** Git records no reviews. Scoring `human_review_depth: 0` and
 * printing one number would report "not measured" as "measured, and it was
 * nothing" — the single most dishonest thing this tool could do, because it
 * would make every reviewed repo look like an unreviewed one. So a reading is a
 * FLOOR (the evidence as it stands) and a CEILING (the same evidence with the
 * missing review record at its best), and the spread between them is the size
 * of what the CLI cannot see. Installing the App is what collapses it.
 *
 * **Who the ceiling applies to.** Full review credit everywhere would put every
 * file above the line and pin the ceiling near 0% — a number that cannot be
 * wrong and therefore says nothing. A file only earns the ceiling if it was
 * ever PR-mediated (a merge, or a squash subject), because a file that never
 * went through a pull request cannot have pull-request reviews. Files outside
 * that set have ceiling = floor: for them the reading is already exact.
 *
 * **One denominator.** The tree, filtered by the hosted `isCodeFile` choke
 * point, weighted by the bytes git reported. The headline, the buckets, the
 * mini-map, the tide and the per-file table all divide by the same number, so
 * two surfaces of the same reading can never disagree.
 */

/** `fade --horizon`'s default, and the window `fadesAt` looks ahead by. */
export const DEFAULT_HORIZON_DAYS = 90;

export interface ScoreOpts {
  /**
   * The clock, always injected. Nothing in this module or its neighbours calls
   * `Date.now()`: a reading is a function of (repo state, now, flags), and a
   * scorer that reads the wall clock on its own cannot be replayed, diffed, or
   * golden-tested. `--now` and `--at` are the only two things that set it.
   */
  now: Date;
  /** `--without <author>`, in the order given. */
  without: readonly string[];
  /**
   * Identity KEYS to remove, matched on `actorId` alone — never through
   * `dropAuthor`'s reader-friendly three-way match. The team card's leave
   * column removes people by the key the scorer counts, and a name-shaped key
   * (the no-email fallback) going through the broad matcher would take a
   * second person who shares the name. See `dropActorKey`.
   */
  withoutKeys?: readonly string[];
  /** Defaults to {@link DEFAULT_HORIZON_DAYS}. Only bounds `fadesAt`. */
  horizonDays?: number;
  /**
   * `.fathohm.toml`'s `exclude` globs. Applied at the code-file seam, so an
   * excluded path is not in the tree, not in an event, and not in any
   * denominator — the reading behaves as though the file were not code.
   */
  exclude?: readonly string[];
  /**
   * `--scope <dir>`: read one subtree, with its own denominator.
   *
   * The same seam as `exclude`, deliberately — the tree is filtered at
   * `codeTree`, so the headline, the ledger, the mini-map, the tide and the
   * JSON all divide by the subtree or none of them do. What it does NOT do is
   * relabel the result: a scoped reading is a reading of a directory and every
   * surface that prints it says so, because a subtree's share quoted as the
   * repository's is a number about a codebase nobody measured.
   */
  scope?: string | null;
}

export interface ScoredFile {
  path: string;
  bytes: number;
  /** Score with the review record at its worst: what the evidence proves. */
  floor: number;
  /** Score with the review record at its best; equals `floor` unless PR-mediated. */
  ceiling: number;
  /** The FLOOR factors, engagement decomposition included. Buckets read these. */
  factors: DerivedFactors;
  /** Touched by at least one merge or squash-subject commit. Gates the ceiling. */
  prMediated: boolean;
  /** ISO date the floor crosses the line, or null: already below, or holds
   *  past the horizon. Which of the two is answered by `floor`. */
  fadesAt: string | null;
}

/**
 * Whether a `--without` value named anybody in this history.
 *
 * A bus-factor simulation that silently removes nobody is worse than one that
 * does not exist: the reader asks "what happens when Ada leaves", gets the
 * unchanged reading back, and concludes the repo is fine without her. So the
 * match is reported rather than inferred, and the renderers warn on a miss.
 */
export interface WithoutMatch {
  query: string;
  matched: boolean;
}

/**
 * What a configured `exclude` took out of the reading.
 *
 * Counted rather than assumed, and printed in the provenance block: a
 * denominator that shrank because of a config file is still a bounded reading,
 * and a bounded reading that does not say so is the same failure as a `--since`
 * window nobody mentions. "77% gone dark" means something different when a
 * third of the repository was excluded on the way in.
 */
export interface ExcludedFiles {
  patterns: readonly string[];
  fileCount: number;
  bytes: number;
}

export interface RepoReading {
  files: ScoredFile[];
  scoredBytes: number;
  floorBlindBytes: number;
  ceilingBlindBytes: number;
  /**
   * THE HEADLINE'S NUMERATOR: bytes with `human_author_recency` at zero — no
   * human wrote or prompted them inside the scorer's recency window.
   *
   * Summed in the same pass as the blind bytes, over the same file array, so
   * the card's headline and its demoted comprehension-debt block divide by one
   * denominator. See `./dark` for why this, rather than the floor share, is
   * what a git-only reading is entitled to print at headline size.
   */
  darkBytes: number;
  provenance: Provenance;
  /** Code files the config's globs removed from the denominator. */
  excluded: ExcludedFiles;
  /** The subtree this reading was bounded to, or null for the repository. */
  scope: string | null;
  /** Bytes by the declaration that made them agent-authored. `--json` only. */
  signatures: SignatureBytes;
  /**
   * PR mediation was detected from squash subjects alone — this history has
   * `(#N)` commits and not one two-parent merge. Worth saying out loud, because
   * it means the ceiling rests on a naming convention rather than on the commit
   * graph, and a repo that writes `(#N)` by hand would read the same.
   */
  squashOnly: boolean;
  now: Date;
  withoutMatches: WithoutMatch[];
}

/**
 * Nothing to fathom: an empty repository, a tree with no code in it, or a tree
 * whose code files are all empty.
 *
 * These read honestly (exit 0), they are not an error — but they must never
 * print a share. "0% gone dark" on an empty repo is a screenshot claiming a
 * fully-tended codebase, and "100%" on one config file is a screenshot claiming
 * a catastrophe. Both would be this product's own headline lying in its first
 * five seconds with a new user, which is the whole of the brand risk.
 *
 * IT LIVES BESIDE THE READING IT ASKS ABOUT rather than beside the card that
 * used to own it, because every surface that must not print a share consults it
 * — `check` decides an exit code by it, the Map and the team table each refuse
 * a headline by it — and a predicate that four printers and one exit code agree
 * on is a fact about the reading, not a fact about the card.
 */
export function isDegenerate(reading: RepoReading): boolean {
  return reading.provenance.emptyRepo || reading.files.length === 0 || reading.scoredBytes === 0;
}

/**
 * The event set a reading is built from: the history, less everyone the caller
 * asked to remove, plus a note on whether each name found anybody.
 *
 * Exported because the tide takes events rather than an extract, and a strip
 * drawn from the full history under a card computed without somebody would be
 * two different repositories on one screen. This is the one seam that turns a
 * `--without` list into events, and both surfaces go through it.
 */
export function readingEvents(
  extract: RepoExtract<CliEvent>,
  without: readonly string[],
  withoutKeys: readonly string[] = [],
): { events: CliEvent[]; withoutMatches: WithoutMatch[] } {
  // Already mapped, and mapped exactly once — the events were built as the
  // history streamed past, with `exclude` applied there. This used to re-map
  // from the retained commits on EVERY call, which `offboard` and `team` make
  // repeatedly; the cost of that was a second full-history array each time,
  // and its only saving grace was that nothing outlived the call.
  const history = extract.history;

  // Each `--without` is matched against the WHOLE history, then applied to
  // what is left. Naming the same person twice reports two honest matches
  // rather than a match and a phantom miss, and the removals still compose.
  const withoutMatches: WithoutMatch[] = [];
  let events = history;
  for (const query of without) {
    withoutMatches.push({
      query,
      // `dropAuthor` only ever removes, so a shorter result IS a match. No
      // second matcher to drift away from the one that does the dropping.
      matched: dropAuthor(history, query).length < history.length,
    });
    events = dropAuthor(events, query);
  }

  // Key removals are programmatic (the team card's leave column), so they get
  // the exact matcher and no match entry: the keys come out of this same event
  // set, and a provenance line about a removal no reader typed would be noise.
  for (const key of withoutKeys) {
    events = dropActorKey(events, key);
  }

  return { events, withoutMatches };
}

export function scoreRepo(extract: RepoExtract<CliEvent>, opts: ScoreOpts): RepoReading {
  const exclude = opts.exclude ?? [];
  const scope = opts.scope ?? null;
  const { events, withoutMatches } = readingEvents(
    extract,
    opts.without,
    opts.withoutKeys ?? [],
  );

  const tree = codeTree(extract.tree, exclude, scope);
  const byPath = groupEventsByPath(events, tree);
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;

  const files = tree
    .map((entry) =>
      scoreFile(entry, byPath.get(entry.path) ?? [], opts.now, horizonDays),
    )
    .sort(byPathAscending);

  let scoredBytes = 0;
  let floorBlindBytes = 0;
  let ceilingBlindBytes = 0;
  let darkBytes = 0;
  for (const file of files) {
    scoredBytes += file.bytes;
    if (file.floor < BLIND_SPOT_THRESHOLD) floorBlindBytes += file.bytes;
    if (file.ceiling < BLIND_SPOT_THRESHOLD) ceilingBlindBytes += file.bytes;
    if (isDark(file)) darkBytes += file.bytes;
  }

  return {
    files,
    scoredBytes,
    floorBlindBytes,
    ceilingBlindBytes,
    darkBytes,
    provenance: extract.provenance,
    excluded: countExcluded(extract.tree, exclude, scope),
    scope,
    signatures: signatureBytes(tree, byPath),
    squashOnly: detectSquashOnly(events),
    now: opts.now,
    withoutMatches,
  };
}

/**
 * What the globs took: the code files that would have been in the denominator
 * and are not.
 *
 * Measured by running the filter twice rather than by counting matches, so the
 * number is the difference between the two denominators themselves. A count of
 * "paths a glob matched" would include files that were never code and would
 * report an exclusion the reading never had.
 */
function countExcluded(
  tree: readonly TreeEntry[],
  exclude: readonly string[],
  scope: string | null,
): ExcludedFiles {
  if (exclude.length === 0) return { patterns: [], fileCount: 0, bytes: 0 };
  const kept = new Set(codeTree(tree, exclude, scope).map((entry) => entry.path));
  let fileCount = 0;
  let bytes = 0;
  // BOTH SIDES CARRY THE SCOPE. The question this answers is "what did the
  // config take out of the reading you are looking at", and a subtree reading
  // that counted the whole repository's excluded files would report an
  // exclusion it never made.
  for (const entry of codeTree(tree, [], scope)) {
    if (kept.has(entry.path)) continue;
    fileCount += 1;
    bytes += entry.bytes;
  }
  return { patterns: [...exclude], fileCount, bytes };
}

/**
 * `--at <ref>`'s clock: the author date of the ref's own commit, or null for a
 * history with nothing in it.
 *
 * The reading as of a ref has to move the clock as well as the history —
 * scoring last year's tree against today's date would report a year of decay
 * that had not happened yet, and the retroactivity claim ("improve the scorer,
 * re-value all history") is exactly the claim that the past reads as the past
 * read. `git log <ref>` always emits the ref's own commit first: it is the only
 * commit in the traversal with no descendant, and git never shows a parent
 * before its child.
 *
 * Author date, matching what `mapEvents` stamps every event with. Under a
 * `--since` bound tight enough to exclude the tip commit itself, this is the
 * newest commit that survived the bound — which is the honest clock for a
 * reading that was told not to look at anything more recent.
 */
export function refClock(extract: RepoExtract<CliEvent>): Date | null {
  const tip = extract.tip;
  return tip === null ? null : new Date(tip.authoredAt);
}

function scoreFile(
  entry: TreeEntry,
  events: CliEvent[],
  now: Date,
  horizonDays: number,
): ScoredFile {
  // Straight in, unchanged: a `CliEvent` IS a `FactorEvent`. Nothing here
  // re-derives a factor, reweights an event, or corrects the pipeline's
  // arithmetic — the CLI's claim is that it runs the same scorer, and the only
  // way to keep that claim true is to have nowhere else to compute it.
  const factors = deriveFactors(events, now);
  const floor = scoreFromFactors(factors);
  const prMediated = events.some((event) => event.prMediated);

  return {
    path: entry.path,
    bytes: entry.bytes,
    floor,
    // A file that never went through a pull request cannot have PR reviews, so
    // there is no missing record to give it the benefit of. Its interval is a
    // point, and saying so is the whole reason the ceiling is believable.
    ceiling: prMediated ? scoreFromFactors(ceilingFactors(factors)) : floor,
    factors,
    prMediated,
    fadesAt: fadeDate(events, factors, now, horizonDays),
  };
}

/**
 * Every event that touched a scored path, indexed by that path — built ONCE per
 * reading and handed to whoever needs it.
 *
 * The tide asks for the same reading at sixteen different clocks. Re-walking
 * the history sixteen times would make the strip cost more than the card it
 * sits under, on exactly the large repositories where the strip is worth
 * having. So the grouping is the shared work, and a tide point is a walk over
 * the groups with a different `now`.
 *
 * Restricted to paths in the tree: an event that touched a file which no longer
 * exists has nothing to score, and carrying it would build a map whose size is
 * the repo's whole history of filenames rather than its current shape.
 *
 * Each group is sorted OLDEST FIRST. `deriveFactors` reads maxima and does not
 * care, but the tide walks its cutoff forward through these arrays, and git
 * hands back commits ordered by committer date while events are stamped with
 * the AUTHOR date — a rebase is enough to make those two disagree.
 */
export function groupEventsByPath(
  events: readonly CliEvent[],
  tree: readonly TreeEntry[],
): Map<string, CliEvent[]> {
  const byPath = new Map<string, CliEvent[]>();
  for (const entry of tree) byPath.set(entry.path, []);
  for (const event of events) {
    for (const path of event.paths) {
      const group = byPath.get(path);
      if (group !== undefined) group.push(event);
    }
  }
  for (const group of byPath.values()) {
    group.sort(byOccurredAtAscending);
  }
  return byPath;
}

function byOccurredAtAscending(a: CliEvent, b: CliEvent): number {
  return Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
}

/** Codepoint order, not locale order: the same bytes must sort the same way in
 *  every environment fathohm runs in. */
function byPathAscending(a: ScoredFile, b: ScoredFile): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/**
 * Squash-only detection, computed here so renderers only read it.
 *
 * A merge is `kind: "approval"` (that is what `mapEvents` makes of a
 * two-parent commit) and is also PR-mediated; a PR-mediated COMMIT is therefore
 * a squash subject and nothing else. Which makes this two booleans and no
 * access to the commit records at all.
 *
 * Computed over the reading's events rather than the raw history, because what
 * it explains is THIS reading's ceiling. Under `--without`, if the only person
 * who ever pressed merge is gone, the ceiling really is resting on subject
 * lines, and the note should say so.
 */
function detectSquashOnly(events: readonly CliEvent[]): boolean {
  let sawMerge = false;
  let sawSquash = false;
  for (const event of events) {
    if (event.kind === "approval") sawMerge = true;
    else if (event.prMediated) sawSquash = true;
  }
  return sawSquash && !sawMerge;
}
