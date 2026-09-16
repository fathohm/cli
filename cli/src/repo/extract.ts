import { existsSync } from "node:fs";
import path from "node:path";

import * as z from "zod/mini";

import { CliError, EXIT } from "../cmd/errors";
import { gitCommandLine, runGit, runGitOutcome, streamGit } from "./git";

/**
 * Extraction: everything fathohm knows about a repository, read in at most
 * three git spawns and never once opening a file in the working tree.
 *
 * What is read: commit shas, parent counts, author/committer identities,
 * author dates, subjects, message bodies (for co-author trailers), the paths
 * each commit touched, and the byte size of every blob in the tree. What is
 * never read: the contents of any of those blobs. The distinction is the whole
 * product — a reading is about *who has been near which code*, and nothing in
 * this module can see the code itself.
 */

export interface CommitRecord {
  sha: string;
  parentCount: number;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  body: string;
  committerName: string;
  committerEmail: string;
  paths: string[];
}

export interface TreeEntry {
  path: string;
  bytes: number;
}

export interface Provenance {
  shallow: boolean;
  grafted: boolean;
  emptyRepo: boolean;
  sinceBound: string | null;
  atRef: string | null;
  /**
   * Gitlinks (mode 160000) passed over. A submodule's history lives in another
   * repository, so its files are not in this reading's denominator at all —
   * counting them here is how the card can say so instead of silently
   * under-reporting.
   */
  submodulesSkipped: number;
}

export interface RepoExtract<E = never> {
  /**
   * The ref's own commit, and the ONLY commit this reading retains.
   *
   * It was `commits: CommitRecord[]` — the whole history, each record still
   * carrying the commit's full subject and body long after the trailers had
   * been read from them. At torvalds/linux (1,464,925 commits) that aborted V8
   * against node's default heap, and the only consumer of the array beyond
   * `mapEvents` was `commits[0]`, right here.
   *
   * `git log <ref>` always emits the ref's own commit first: it is the only
   * commit in the traversal with no descendant, and git never shows a parent
   * before its child.
   */
  tip: CommitRecord | null;
  /**
   * Whatever the caller's sink kept, in the order git listed it (newest
   * first). Empty when no sink was supplied.
   *
   * Generic so this module never has to know what a scoring event is —
   * `events.ts` already imports from here, and naming `CliEvent` in this file
   * would close the cycle.
   */
  history: E[];
  tree: TreeEntry[];
  provenance: Provenance;
  /**
   * The repository root — the directory git resolved to, NOT the directory the
   * caller pointed at.
   *
   * Every spawn below runs with the caller's directory as cwd and git walks up
   * from there on its own, so the history and the tree are ALWAYS the whole
   * repository's. Anything derived from the pointed-at directory instead
   * therefore diverges the moment somebody runs fathohm from a subdirectory:
   * the card would name `cli` while counting the repository's files, and a
   * `.fathohm.toml` at the root would be looked for in `cli/` and silently not
   * found — which is a CI gate quietly losing the team's threshold and its
   * exclusions. One reading has one subject, and this is it.
   *
   * It is on the extract rather than in {@link Provenance} on purpose:
   * provenance is serialised into `--json`, and an absolute local path is a
   * fact about the machine that took the reading, not about the repository.
   */
  root: string;
}

/**
 * Receives commits as they stream and keeps whatever the caller actually needs.
 *
 * The reason this is a FACTORY taking the root, rather than a plain callback:
 * the caller's consumer depends on `.fathohm.toml`, which is found from the
 * repository ROOT, which is discovered by the probe that opens this very read.
 * So the ordering is genuinely probe → config → walk, and the factory is where
 * that ordering lives. It is called exactly once, after the root is known and
 * before any commit exists — including for an empty repository, so a caller can
 * rely on having been asked.
 */
export interface CommitSink<E> {
  push(commit: CommitRecord): void;
  /** Everything the caller kept. Called once, after the last commit. */
  done(): E[];
}

/**
 * A sink that keeps the commits themselves.
 *
 * This is the old behaviour, available on request instead of by default — which
 * is the whole change. A caller that genuinely wants the history (a test
 * asserting what git produced, a tool inspecting commits) asks for it and pays
 * for it; the CLI's own read path does not, because it only ever needed the
 * events.
 */
export function commitCollector(): CommitSink<CommitRecord> {
  const commits: CommitRecord[] = [];
  return {
    push(commit: CommitRecord): void {
      commits.push(commit);
    },
    done(): CommitRecord[] {
      return commits;
    },
  };
}

export interface ExtractOptions<E> {
  /** `--at <ref>`: read the repo as it stood at a ref. Defaults to HEAD. */
  readonly atRef?: string | null;
  /** `--since <iso>`: history before this instant is not read at all. */
  readonly since?: string | null;
  /**
   * Where the history goes. Without one, the history is walked and DISCARDED —
   * which is the right default for a caller that only wants the tree or the
   * provenance, and is why nothing here retains commits on its own.
   */
  readonly sink?: (root: string) => CommitSink<E>;
}

/**
 * The commit frame. Nine fields, unit-separated, and the body is LAST for a
 * reason: a commit message may contain every byte except NUL — including the
 * unit separator itself — so only the final field can afford to be
 * unescapable. Everything before it is split off by counting exactly eight
 * separators; whatever remains is the body, verbatim.
 *
 * The trailing `%x00` is what makes the frame closable. Under `-z`, git also
 * NUL-separates commits and NUL-terminates each `--name-only` path, so NUL is
 * already the one byte that cannot occur inside any field — this explicit one
 * ends the header so the file list that follows can never be mistaken for the
 * tail of a multi-line body.
 */
export const LOG_FORMAT =
  "%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%s%x1f%b%x00";

/** ASCII US (0x1f). Written as an escape so the byte is visible in source. */
const UNIT_SEPARATOR = "\u001f";
const FIELD_COUNT_BEFORE_BODY = 8;
const NUL = 0;
const TAB = 0x09;
const LINE_FEED = 0x0a;

/** sha1 (40) or sha256 (64) object names. */
const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** `%aI` is strict ISO 8601; git writes `Z` or a `±HH:MM` offset. */
const STRICT_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

const commitSchema = z.object({
  sha: z.string().check(z.regex(SHA_PATTERN)),
  parentCount: z.int().check(z.gte(0)),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.string().check(z.regex(STRICT_ISO_PATTERN)),
  subject: z.string(),
  body: z.string(),
  committerName: z.string(),
  committerEmail: z.string(),
  paths: z.array(z.string()),
});

const treeEntrySchema = z.object({
  path: z.string().check(z.minLength(1)),
  bytes: z.int().check(z.gte(0)),
});

/**
 * Raised when a frame does not have the shape the format guarantees. It is a
 * `CliError(3)` and not a crash on purpose: a repository fathohm cannot parse
 * is a repository fathohm cannot read *honestly*, which is a different answer
 * from "your repo is fine" and from "you invoked this wrong".
 *
 * It names the command whose output it was reading. "The commit log was
 * malformed" is an accusation with nothing the reader can do about it; the
 * exact argv is something they can paste into their own shell and see for
 * themselves, which is the difference between an error and a dead end.
 */
function malformedFrame(command: string, detail: string): CliError {
  return new CliError(
    EXIT.cannotRead,
    `\`${command}\` did not produce the shape fathohm asked git for — expected ${detail}.`,
    `run \`${command}\` yourself and look at the output; a truncated or corrupt object store reads as garbage here, and --debug prints where the parse gave up.`,
  );
}

/**
 * Incremental parser for `git log -z --name-only --pretty=format:<LOG_FORMAT>`.
 *
 * The byte stream, verified against git 2.50 and pinned by the tests:
 *
 *   HEADER NUL [ LF path NUL path NUL ... ] NUL HEADER NUL [ ... ] ...
 *            ^ our %x00                    ^ git's -z commit separator
 *
 * so once the stream is cut on NUL the tokens read as: one header, then zero
 * or more path tokens (the first carries the leading LF git puts between a
 * commit and its diff), then an empty token that closes the commit. A commit
 * that changed nothing against the parent being diffed emits no paths at all,
 * so its header is followed immediately by the closing empty token. That is
 * the whole grammar.
 *
 * Feeding it is chunk-agnostic: a NUL may land on any byte boundary, so
 * partial tokens are held and joined rather than assumed.
 */
export class LogFrameParser {
  readonly #onCommit: (commit: CommitRecord) => void;
  readonly #command: string;
  readonly #pending: Buffer[] = [];
  #pendingLength = 0;
  #header: HeaderFields | null = null;
  #paths: string[] = [];
  #sawFirstPath = false;

  /**
   * `command` is the argv whose output is being read, carried only so a parse
   * failure can name it. It defaults to the canonical `HEAD` invocation, which
   * is what a caller feeding the parser directly (a test, the perf gate) is
   * standing in for.
   */
  constructor(onCommit: (commit: CommitRecord) => void, command?: string) {
    this.#onCommit = onCommit;
    this.#command = command ?? gitCommandLine(logArgs("HEAD", null));
  }

  push(chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const index = chunk.indexOf(NUL, start);
      if (index === -1) {
        if (start < chunk.length) {
          this.#pending.push(chunk.subarray(start));
          this.#pendingLength += chunk.length - start;
        }
        return;
      }
      this.#token(chunk.subarray(start, index));
      start = index + 1;
    }
  }

  /**
   * Closes the stream. The final commit of a log has no separator after it, so
   * whatever is still held is a real token and an open commit is a real
   * commit — dropping either would silently shorten the history.
   */
  end(): void {
    if (this.#pendingLength > 0) this.#token(Buffer.alloc(0));
    if (this.#header !== null) this.#emit();
  }

  #token(tail: Buffer): void {
    let token = tail;
    if (this.#pendingLength > 0) {
      this.#pending.push(tail);
      token = Buffer.concat(this.#pending);
      this.#pending.length = 0;
      this.#pendingLength = 0;
    }

    if (this.#header === null) {
      this.#header = parseHeader(token.toString("utf8"), this.#command);
      this.#paths = [];
      this.#sawFirstPath = false;
      return;
    }

    if (token.length === 0) {
      this.#emit();
      return;
    }

    // git writes a line feed between the commit header and its diff; under -z
    // that byte is glued to the front of the first path token. Exactly one is
    // stripped — a path may itself begin with a newline, and git does not
    // quote it away.
    const body =
      !this.#sawFirstPath && token[0] === LINE_FEED ? token.subarray(1) : token;
    this.#sawFirstPath = true;
    this.#paths.push(body.toString("utf8"));
  }

  #emit(): void {
    const header = this.#header;
    if (header === null) return;
    const record: CommitRecord = z.parse(commitSchema, {
      sha: header.sha,
      parentCount: header.parentCount,
      authorName: header.authorName,
      authorEmail: header.authorEmail,
      authoredAt: header.authoredAt,
      subject: header.subject,
      body: header.body,
      committerName: header.committerName,
      committerEmail: header.committerEmail,
      paths: this.#paths,
    });
    this.#header = null;
    this.#paths = [];
    this.#sawFirstPath = false;
    this.#onCommit(record);
  }
}

interface HeaderFields {
  readonly sha: string;
  readonly parentCount: number;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAt: string;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly subject: string;
  readonly body: string;
}

function parseHeader(text: string, command: string): HeaderFields {
  const cuts: number[] = [];
  let at = -1;
  for (let i = 0; i < FIELD_COUNT_BEFORE_BODY; i += 1) {
    at = text.indexOf(UNIT_SEPARATOR, at + 1);
    if (at === -1) {
      throw malformedFrame(
        command,
        `${FIELD_COUNT_BEFORE_BODY} field separators in every commit header, and one carried ${cuts.length}`,
      );
    }
    cuts.push(at);
  }
  const field = (index: number): string =>
    text.slice(index === 0 ? 0 : cuts[index - 1] + 1, cuts[index]);

  const parents = field(1).trim();
  return {
    sha: field(0),
    // A root commit has no parents at all; a merge has two or more. This count
    // is the only thing downstream needs to tell an approval from a commit.
    parentCount: parents === "" ? 0 : parents.split(" ").length,
    authorName: field(2),
    authorEmail: field(3),
    authoredAt: field(4),
    committerName: field(5),
    committerEmail: field(6),
    subject: field(7),
    body: text.slice(cuts[FIELD_COUNT_BEFORE_BODY - 1] + 1),
  };
}

/**
 * Drives the frame parser without a subprocess. The perf gate and the framing
 * tests both need to feed the parser bytes they chose — including chunk
 * boundaries git would never produce — so the parser is a pure function of its
 * input and spawning is somebody else's job.
 */
export function parseLogStream(
  chunks: Iterable<Buffer | string>,
  command?: string,
): CommitRecord[] {
  const commits: CommitRecord[] = [];
  const parser = new LogFrameParser((commit) => {
    commits.push(commit);
  }, command);
  for (const chunk of chunks) {
    parser.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }
  parser.end();
  return commits;
}

export interface TreeReading {
  entries: TreeEntry[];
  submodulesSkipped: number;
}

const LS_TREE_META = /^(\d{6}) ([a-z]+) ([0-9a-f]+) +(-|\d+)$/;

/**
 * Parses `git ls-tree --full-tree -r -l -z <ref>`:
 *
 *   <mode> SP <type> SP <object> SP-padded <size> TAB <path> NUL
 *
 * Only blobs carry a byte size, and only blobs are files. Trees never appear
 * under `-r`; gitlinks do, with `-` where the size would be, and they are
 * counted rather than guessed at.
 */
export function parseLsTree(output: Buffer, command?: string): TreeReading {
  const named = command ?? gitCommandLine(treeArgs("HEAD"));
  const entries: TreeEntry[] = [];
  let submodulesSkipped = 0;

  let start = 0;
  while (start < output.length) {
    let end = output.indexOf(NUL, start);
    if (end === -1) end = output.length;
    const record = output.subarray(start, end);
    start = end + 1;
    if (record.length === 0) continue;

    // The path is raw bytes and may contain a tab of its own; the metadata
    // before the first tab never can.
    const tab = record.indexOf(TAB);
    if (tab === -1) {
      throw malformedFrame(
        named,
        "a tab between each record's metadata and its path, and one record had none",
      );
    }
    const meta = LS_TREE_META.exec(record.subarray(0, tab).toString("utf8"));
    if (meta === null) {
      throw malformedFrame(
        named,
        "mode, type, object and size before the tab, and one record carried something else",
      );
    }
    const [, mode, type, , size] = meta;
    if (mode === "160000" || type === "commit") {
      submodulesSkipped += 1;
      continue;
    }
    if (type !== "blob") continue;

    entries.push(
      z.parse(treeEntrySchema, {
        path: record.subarray(tab + 1).toString("utf8"),
        bytes: Number(size),
      }),
    );
  }

  return { entries, submodulesSkipped };
}

/**
 * Reads a repository. Three spawns, whatever the size of the history:
 *
 *   1. `rev-parse` — shallow flag, bare flag, git directory, the way up to the
 *      repository root, and whether the ref resolves at all (one call; the
 *      flags compose)
 *   2. `log` — the history, streamed
 *   3. `ls-tree` — the tree, with byte sizes
 *
 * An empty repository is not an error. "No commits yet" is a true and useful
 * answer, and the renderer owns saying it; a tool that exits non-zero on a
 * fresh `git init` would be lying about what went wrong.
 */
/**
 * WITHOUT a sink there is no `history` field at all, and that is load-bearing.
 *
 * `history: never[]` would have been the natural shape, and it is a trap: `E`
 * defaults to `never`, `never[]` is assignable to `CliEvent[]`, so a caller who
 * simply forgot the sink would type-check, score an empty history, and print
 * 0% blind for a repository with a decade of commits. Silently. Omitting the
 * field instead turns that mistake into a compile error at the first `scoreRepo`.
 */
export async function extractRepo(
  cwd: string,
  options?: Omit<ExtractOptions<never>, "sink">,
): Promise<Omit<RepoExtract<never>, "history">>;
export async function extractRepo<E>(
  cwd: string,
  options: Omit<ExtractOptions<E>, "sink"> & {
    readonly sink: (root: string) => CommitSink<E>;
  },
): Promise<RepoExtract<E>>;
export async function extractRepo<E = never>(
  cwd: string,
  options: ExtractOptions<E> = {},
): Promise<RepoExtract<E>> {
  const atRef = options.atRef ?? null;
  const since = options.since ?? null;
  const ref = atRef ?? "HEAD";

  const probeArgs = [
    "rev-parse",
    "--is-shallow-repository",
    "--is-bare-repository",
    "--git-dir",
    "--git-common-dir",
    "--show-cdup",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ];
  const probe = await runGitOutcome(cwd, probeArgs);
  // Status 1 means only that the ref did not resolve — the lines before it were
  // still printed. Anything else is the repository itself refusing.
  if (probe.code !== 0 && probe.code !== 1) {
    throw notAReadableRepo(cwd, probeArgs, probe.code, probe.stderr);
  }
  const probeLines = probeOutput(probe.stdout.toString("utf8"));
  // Four lines are what EVERY repository owes: shallow, bare, git dir, common
  // dir. Fewer than that and git did not answer the question it was asked.
  if (probeLines.length < 4) {
    throw notAReadableRepo(cwd, probeArgs, probe.code, probe.stderr);
  }

  const shallow = probeLines[0] === "true";
  const bare = probeLines[1] === "true";
  // The common dir: a linked worktree's own git dir has no `info/grafts`.
  const commonDir = path.resolve(cwd, probeLines[3]);
  const grafted = await detectGrafts(cwd, commonDir);
  // The ref line comes LAST — `--verify` holds its answer back until every
  // other flag has printed — so its absence is read from the exit status
  // rather than from a line count. Status 1 is `--quiet`'s way of saying the
  // ref named nothing, and it is the only other status that got this far.
  const refResolved = probe.code === 0;

  // `--show-cdup` is the way back UP to the repository root, relative to the
  // directory git was run in: empty at the root itself, `../../` two levels
  // down. It is preferred over `--show-toplevel` for two reasons, and both are
  // measured rather than assumed. `--show-toplevel` is FATAL in a bare
  // repository ("this operation must be run in a work tree", status 128), which
  // would make every bare repo unreadable and take the ref line down with it;
  // `--show-cdup` simply prints nothing there and the probe still exits clean.
  // And resolving a relative hop against the caller's own cwd keeps the path
  // spelled the way the caller spelled it, where `--show-toplevel` would swap
  // in git's resolved-through-symlinks version of the same directory.
  //
  // A BARE REPOSITORY HAS NO WORKING TREE, so it has no root to name and git
  // emits no line at all — not an empty one. The fallback is the directory the
  // caller pointed at: it is the only name that repository has here, it is what
  // the reader typed, and it is where a `.fathohm.toml` beside a bare clone
  // would sit. Non-bare, git ALWAYS emits the line even when it is empty, so a
  // missing one there is a probe that did not answer.
  if (!bare && probeLines.length < 5) {
    throw notAReadableRepo(cwd, probeArgs, probe.code, probe.stderr);
  }
  const root = bare ? path.resolve(cwd) : path.resolve(cwd, probeLines[4]);

  // The root is known and nothing has been walked yet: the one moment where a
  // caller can read `.fathohm.toml` and build a consumer that depends on it.
  // Asked unconditionally, so an empty repository is a sink that receives
  // nothing rather than a sink that was never offered — a caller loading its
  // config here would otherwise silently skip it on a fresh `git init`.
  const sink = options.sink?.(root) ?? null;

  if (!refResolved) {
    if (atRef !== null) {
      throw new CliError(
        EXIT.usage,
        `\`git rev-parse --verify ${ref}^{commit}\` resolved nothing in ${cwd} — expected --at ${atRef} to name a commit.`,
        `list what there is to read with \`git log --oneline -5\`, then re-run with an --at value from that list.`,
      );
    }
    return {
      tip: null,
      history: sink?.done() ?? [],
      tree: [],
      provenance: {
        shallow,
        grafted,
        emptyRepo: true,
        sinceBound: since,
        atRef: null,
        submodulesSkipped: 0,
      },
      root,
    };
  }

  const tip = await readLog(cwd, ref, since, sink);
  const tree = await readTree(cwd, ref);

  return {
    tip,
    history: sink?.done() ?? [],
    tree: tree.entries,
    provenance: {
      shallow,
      grafted,
      emptyRepo: false,
      sinceBound: since,
      atRef,
      submodulesSkipped: tree.submodulesSkipped,
    },
    root,
  };
}

/**
 * The probe's stdout, cut into lines WITHOUT dropping the empty ones.
 *
 * `--show-cdup` prints an empty line when the caller is already standing at the
 * repository root, and that empty line is a real answer in a positional read —
 * `git rev-parse` emits its results in ARGUMENT ORDER, so filtering blanks out
 * would shift every line after it and hand the git directory's slot to the wrong
 * string. Only the newline that terminates the last line is removed.
 */
function probeOutput(text: string): string[] {
  if (text === "") return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

/**
 * The flag that gives a merge its file list.
 *
 * Plain `--name-only` prints NOTHING for a merge commit, so without this every
 * merge arrived pathless and the acceptance it represents attached to no file
 * at all — the approval was recorded against nobody's code. A merge's honest
 * file set is its diff against the FIRST parent: the net change the branch
 * brought onto the trunk, which is exactly the pull request's file list.
 *
 * That is also hosted parity, not a convenience. The ingest pipeline reads a
 * merge's paths from GitHub's REST commit endpoint, which reports a merge's
 * files against its first parent; `--diff-merges=first-parent` is the local
 * name for the same set (workers/src/commit-history.ts → commit-files.ts).
 *
 * Requires git 2.31, where `first-parent` joined the `--diff-merges` values.
 */
const DIFF_MERGES = "--diff-merges=first-parent";
/** git's own words when it does not understand the flag above. */
const DIFF_MERGES_UNSUPPORTED = /diff-merges/i;

/**
 * The next step for a `git log` that failed, chosen by what git said. Exported
 * so the one failure fathohm cannot reproduce on a modern machine — a git too
 * old for `--diff-merges=first-parent` — is still covered by a test.
 */
export function logFailureHint(
  stderr: string,
  ref: string,
  cwd: string,
): string {
  if (DIFF_MERGES_UNSUPPORTED.test(stderr)) {
    return `this git does not understand \`${DIFF_MERGES}\` — upgrade to git 2.31 or newer, which is where that value was added. fathohm needs it to see which files each merge brought in; without it a merge is recorded against no file at all.`;
  }
  return `run \`git log --oneline -5 ${ref}\` in ${cwd} — fathohm can only read a history git can walk.`;
}

/**
 * The two argv builders, exported so nothing has to *describe* the command
 * fathohm ran. Every error about a git failure quotes one of these back
 * verbatim, and a quoted command that is not the command is worse than none —
 * the reader pastes it, it works, and they conclude the tool is confused.
 */
export function logArgs(ref: string, since: string | null): string[] {
  return [
    "log",
    "--no-renames",
    "--name-only",
    DIFF_MERGES,
    "-z",
    `--pretty=format:${LOG_FORMAT}`,
    ...(since === null ? [] : [`--since=${since}`]),
    ref,
    "--",
  ];
}

export function treeArgs(ref: string): string[] {
  return ["ls-tree", "--full-tree", "-r", "-l", "-z", ref];
}

/**
 * Walks the history and retains NOTHING but the tip.
 *
 * `LogFrameParser` was always incremental — chunk-agnostic, NUL-framed, holding
 * only a partial token. This function used to undo that in three lines by
 * pushing every record into an array, so the streaming parser fed a buffer of
 * the entire history. Each retained record kept the commit's full subject and
 * body, which exist only so `toEvent` can read co-author trailers and test for
 * the squash marker; both are read the moment the commit arrives, and nothing
 * needs the text afterwards.
 *
 * What the caller keeps is now the caller's decision, which is the only way the
 * cost can be proportional to what it wants rather than to the repository's age.
 */
async function readLog<E>(
  cwd: string,
  ref: string,
  since: string | null,
  sink: CommitSink<E> | null,
): Promise<CommitRecord | null> {
  const args = logArgs(ref, since);
  let tip: CommitRecord | null = null;
  const parser = new LogFrameParser((commit) => {
    if (tip === null) tip = commit;
    sink?.push(commit);
  }, gitCommandLine(args));
  await streamGit(cwd, args, {
    onStdout: (chunk) => {
      parser.push(chunk);
    },
    expected: "the commit history, with the paths each commit touched",
    hint: (stderr) => logFailureHint(stderr, ref, cwd),
  });
  parser.end();
  return tip;
}

async function readTree(cwd: string, ref: string): Promise<TreeReading> {
  const args = treeArgs(ref);
  const output = await runGit(cwd, args, {
    expected: "every file in the tree, with its size in bytes",
    hint: `run \`${gitCommandLine(args)}\` in ${cwd} to see what git can list; fathohm weighs files by the sizes git reports.`,
  });
  return parseLsTree(output, gitCommandLine(args));
}

/**
 * Grafts and replacements rewrite ancestry, which means the history fathohm
 * walked is not the history that happened. Detection is by *existence* only —
 * fathohm does not read these files, it just notes that the repo has them.
 */
async function detectGrafts(cwd: string, commonDir: string): Promise<boolean> {
  if (existsSync(path.join(commonDir, "info", "grafts"))) return true;
  // Asked of git, not listed: `git gc` packs `refs/replace/` into `packed-refs`.
  const replace = await runGitOutcome(cwd, [
    "for-each-ref",
    "--count=1",
    "--format=%(refname)",
    "refs/replace/",
  ]);
  return replace.code === 0 && replace.stdout.length > 0;
}

function notAReadableRepo(
  cwd: string,
  args: readonly string[],
  code: number,
  stderr: string,
): CliError {
  const said = stderr
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return new CliError(
    EXIT.cannotRead,
    `\`git ${args.join(" ")}\` exited ${code} in ${cwd} — expected a git repository to read.` +
      (said === undefined ? "" : ` git said: ${said}`),
    `run \`git status\` in ${cwd}; fathohm reads a git repository and can say nothing about a directory that is not one.`,
  );
}
