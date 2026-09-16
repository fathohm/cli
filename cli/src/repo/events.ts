import { isCodeFile } from "../../../lib/code-files";
import {
  detectAuthorship,
  effectiveAuthorship,
  extractCoAuthors,
} from "../../../workers/src/authorship";
import { authorKeyFor, IDENTITY_ID, identityId } from "../../../workers/src/identity-map";
import type { FactorEvent } from "../../../workers/src/scorer";
import { MERGE_PARENT_COUNT, type AgentSignature } from "../../../workers/src/types";
import type { CommitRecord, CommitSink, TreeEntry } from "./extract";
import { excludeMatcher } from "./glob";

/**
 * Commits in, scoring events out — and every judgement along the way made by
 * the SAME code the hosted pipeline runs.
 *
 * That is the whole point of this module. `npx fathohm` in a repo and the
 * GitHub App watching the same repo must not disagree about who authored what,
 * because the CLI's job is to hand you a lower bound on the hosted reading, and
 * a bound computed by a second implementation of the heuristics would be a
 * bound on nothing. So there is no classification logic here: the trailer
 * reader, the agent signatures, the bot allowlist, the identity key and the
 * read-time override are all imported from `workers/src`, and what this file
 * contributes is the translation from a git commit to the event shape they
 * expect.
 *
 * The three things git alone knows, which the hosted pipeline learns from
 * GitHub instead:
 *
 *   - a merge is `parentCount >= 2` (the same structural test ingest applies
 *     to the parent count it reads off the REST commit),
 *   - a merge's file set is its first-parent diff (`--diff-merges=first-parent`
 *     in extract.ts — the same set GitHub's commit endpoint reports),
 *   - PR mediation is a merge, or a subject ending `(#N)` (GitHub's squash
 *     convention), which is the CLI's own concept: it is what the interval
 *     headline's ceiling is allowed to apply to.
 *
 * And the one thing git CANNOT know: review depth. There are no review events
 * in a git repository, so every event here carries `reviewCommentCount: 0` and
 * the reading built on them is a floor. Collapsing that is what installing the
 * App is for.
 */

/**
 * One scoring event, structurally a `FactorEvent` (scorer.ts takes it
 * unchanged) plus what a git-only reading needs on top.
 *
 * `reviewCommentCount` is typed as the literal `0`, not `number`: it is not a
 * value this module happens to compute, it is a statement about what git can
 * see. A future change that wants to put a non-zero count here has to argue
 * with the type first.
 */
export interface CliEvent {
  kind: "commit" | "approval";
  actorId: string;
  authorship: FactorEvent["authorship"];
  occurredAt: string;
  /** Structurally zero: git records no reviews. See the module note. */
  reviewCommentCount: 0;
  /** Code paths only — the filter is applied here so there is one denominator. */
  paths: string[];
  /** A merge, or a squash subject ending `(#N)`. Gates the ceiling reading. */
  prMediated: boolean;
  /**
   * WHICH declaration made this event agent-authored: `claude_code`,
   * `copilot`, `cursor` — or null for everything else, which includes an
   * agent-labelled commit whose only evidence was a trailer this vocabulary
   * does not recognise.
   *
   * Carried, never scored. `authorship` is what the scorer reads and this is
   * the evidence behind it, kept because `--json` reports the byte split by
   * signature and a split re-derived from the messages a second time would be
   * a second detector. Composed exactly as `authorship` is: a merge produced
   * no content, so it declares nothing.
   */
  agentSignature: AgentSignature;
  /**
   * The raw git identity, carried for `--without <author>` and for nothing
   * else. It is NOT a scoring input — `actorId` is the identity the scorer
   * counts — but `authorKeyFor` collapses a person to their lowercased email,
   * so without these two fields `--without "Ada Lovelace"` could not find a
   * person who commits from an address, and would silently simulate removing
   * nobody. A bus-factor simulation that quietly does nothing is worse than
   * one that does not exist.
   */
  actorName: string;
  actorEmail: string;
}

/** A subject ending in GitHub's squash-merge marker: `… (#1234)`. */
const SQUASH_SUBJECT = /\(#\d+\)$/;

/**
 * Every commit becomes exactly one event, in the order git listed them
 * (newest first). Nothing is dropped: `deriveFactors` reads maxima and
 * per-person weights, so order is not an input, and an event whose paths all
 * filtered away still costs nothing to carry while remaining visible to
 * whoever asks a question about the history rather than about a file.
 */
export function mapEvents(
  commits: readonly CommitRecord[],
  exclude: readonly string[] = [],
): CliEvent[] {
  const excluded = excludeMatcher(exclude);
  return commits.map((commit) => toEvent(commit, excluded));
}

/**
 * The streaming form: the same mapping, applied as each commit arrives.
 *
 * This is what lets a reading cost what its EVENTS cost rather than what the
 * repository's whole history costs. `mapEvents` needs the commits to already
 * exist, which is exactly the array that could not be afforded — a collector
 * converts and drops each record in turn, so a commit's subject and body live
 * only as long as it takes to read the trailers out of them.
 *
 * The `exclude` list is fixed for the life of a reading, which is why this can
 * be built once, before the walk, from a config found at the repository root.
 * Nothing here is order-dependent: `deriveFactors` reads maxima and per-person
 * weights, so events accumulate in whatever order git emits them.
 */
export function eventCollector(exclude: readonly string[] = []): CommitSink<CliEvent> {
  const excluded = excludeMatcher(exclude);
  const events: CliEvent[] = [];
  return {
    push(commit: CommitRecord): void {
      events.push(toEvent(commit, excluded));
    },
    done(): CliEvent[] {
      return events;
    },
  };
}

function toEvent(commit: CommitRecord, excluded: (path: string) => boolean): CliEvent {
  const isMerge = commit.parentCount >= MERGE_PARENT_COUNT;
  const { authorship, agentSignature } = detectAuthorship({
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    coAuthors: extractCoAuthors(fullMessage(commit)),
  });
  const actorId = authorKeyFor(commit.authorName, commit.authorEmail);

  return {
    // A merge is an ACCEPTANCE, not authorship: somebody pressed a button and
    // a branch's worth of files landed. Recorded as ingest records it — an
    // approval with zero comments, which `engagementWeight` prices at nothing.
    kind: isMerge ? "approval" : "commit",
    actorId,
    // The label the hosted pipeline would end up scoring, composed the way it
    // composes it: ingest writes the detected label but stores NO signature for
    // a merge (the merge produced no content, so nothing about it is
    // agent-authored), and the read path re-derives from what was stored. For
    // an allowlisted committer that composition is the difference between
    // "agent" and "bot" — both weightless here, and both true statements.
    authorship: effectiveAuthorship(
      actorId,
      authorship,
      isMerge ? null : agentSignature,
    ),
    // The AUTHOR date, matching the timestamp ingest records. A rebase moves
    // the committer date and would otherwise make old work look fresh.
    occurredAt: commit.authoredAt,
    reviewCommentCount: 0,
    paths: commit.paths.filter((path) => isCodeFile(path) && !excluded(path)),
    prMediated: isMerge || SQUASH_SUBJECT.test(commit.subject),
    // The same composition the label above gets, for the same reason: a merge
    // wrote nothing, so it declares nothing.
    agentSignature: isMerge ? null : agentSignature,
    actorName: commit.authorName,
    actorEmail: commit.authorEmail,
  };
}

/**
 * The commit message as one string, the way the hosted parsers see it.
 * `git log` hands the subject and the body over separately (`%s` and `%b`),
 * and a webhook payload carries them joined — so they are rejoined here before
 * the trailer reader runs, rather than the trailer reader being taught about
 * git's field split.
 */
function fullMessage(commit: CommitRecord): string {
  return commit.body === ""
    ? commit.subject
    : `${commit.subject}\n\n${commit.body}`;
}

/**
 * The code-file filter, mirroring the hosted choke point — and the ONE place
 * `.fathohm.toml`'s `exclude` is applied.
 *
 * Comprehension debt is a property of code, and `lib/code-files.ts` is the one
 * predicate that decides what code is. Hosted applies it in `joinRows`
 * (lib/map-tree.ts), where the tree is joined to the score rows: non-code tree
 * rows are dropped, and a score row for a path that is not in the filtered tree
 * can never surface. The CLI reaches the same place from the other side —
 * filter the tree with `codeTree`, filter event paths here — so the headline,
 * the buckets, the mini-map and the per-file table all divide by the same
 * bytes. One denominator is not a nicety: two surfaces disagreeing about what
 * counts is how a reading stops being evidence.
 *
 * Which is exactly why `exclude` lands HERE rather than in a filter of its own
 * somewhere above. A configured exclusion is a statement about what the
 * codebase IS, and it has to reach the headline, the buckets, the mini-map, the
 * tide, the JSON and the HTML map by the same route the code-file filter takes,
 * or one of those six ends up dividing by a number the others do not have.
 */
export function filterCodePaths(paths: readonly string[], exclude: readonly string[] = []): string[] {
  const excluded = excludeMatcher(exclude);
  return paths.filter((path) => isCodeFile(path) && !excluded(path));
}

/**
 * The tree, less everything that is not code and everything the config
 * excluded — the reading's denominator.
 *
 * Sizes are left exactly as git reported them. `joinRows` clamps a zero-byte
 * file to 1, but that is a treemap-layout concern (squarify drops non-positive
 * areas) and belongs where a `FileEntry` is built, not in a fact about the
 * repository.
 */
export function codeTree(
  tree: readonly TreeEntry[],
  exclude: readonly string[] = [],
  scope: string | null = null,
): TreeEntry[] {
  const excluded = excludeMatcher(exclude);
  return tree.filter(
    (entry) => isCodeFile(entry.path) && !excluded(entry.path) && inScope(entry.path, scope),
  );
}

/**
 * `--scope <dir>`: is this path inside the subtree being read?
 *
 * It travels the SAME route `exclude` does — through `codeTree`, at the
 * code-file seam — and for the same reason. A scope that filtered somewhere
 * else would leave the headline dividing by the subtree while some other
 * surface divided by the repository, which is the one failure mode this seam
 * exists to make impossible.
 *
 * Directory containment, not a prefix match: `lib` must not take `library/`.
 * A null scope is the whole repository, which is what every reading is unless
 * somebody asked otherwise.
 */
export function inScope(path: string, scope: string | null): boolean {
  return scope === null || path === scope || path.startsWith(`${scope}/`);
}

/**
 * `--without <author>`: the reading with one person's engagement removed.
 *
 * The events go away entirely rather than being reweighted, because that is
 * the question being asked — "what does this repo look like the day they
 * leave?" — and it is the only version of the question the pure scorer can
 * answer honestly: bus factor loses a contributor, recency re-maxes over
 * whoever is left, and the buckets re-derive. Nothing is re-weighted by hand.
 *
 * Matching is case-insensitive against the actor's key, email, or name, so
 * every way a reader might name a person works: the key is the lowercased
 * email for a human and the name for a bot, and neither is what a colleague is
 * called out loud. An empty string matches nobody — an omitted `--without`
 * must not delete the events of a commit that carries no identity at all.
 *
 * A FOURTH SPELLING, for machines: `fh_<12 hex>`, the id `team --json` carries
 * in place of the email it used to print. A pipeline that reads a key out of
 * that document and hands it back to `--without` has always worked and still
 * does. It is recognised by SHAPE first, so the hash is computed only for an
 * argument that could be one — a name or an address never pays for it.
 */
export function dropAuthor(events: CliEvent[], author: string): CliEvent[] {
  const wanted = normalize(author);
  if (wanted === "") return events;
  return events.filter((event) => !isAuthor(event, wanted));
}

function isAuthor(event: CliEvent, wanted: string): boolean {
  if (IDENTITY_ID.test(wanted)) return identityId(event.actorId) === wanted;
  return (
    normalize(event.actorId) === wanted ||
    normalize(event.actorEmail) === wanted ||
    normalize(event.actorName) === wanted
  );
}

/**
 * Removal by identity KEY alone — the matcher for programmatic removals.
 *
 * `dropAuthor`'s three-way match is for what a READER types: name, email, or
 * key, whichever they know. A key the code already holds must not go back
 * through it, because a person whose commits carry no email has their NAME as
 * their key (`authorKeyFor`'s fallback), and the broad matcher would take a
 * second, distinct person who happens to share that name with them — the leave
 * row would print a number about nobody. Exact `actorId` equality is the same
 * identity test the scorer counts by, so this removes one identity, always.
 */
export function dropActorKey(events: CliEvent[], key: string): CliEvent[] {
  const wanted = normalize(key);
  if (wanted === "") return events;
  return events.filter((event) => normalize(event.actorId) !== wanted);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
