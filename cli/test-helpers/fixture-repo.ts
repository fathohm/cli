import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Real git repositories, built on disk, for the tests to read.
 *
 * Fathohm's whole input is git's own output, so a fixture that stubs git would
 * only test fathohm's opinion of git. These are the actual thing — `git init`,
 * real commits, real merges, real shallow clones — with every source of
 * variation nailed down so two runs on two machines produce byte-identical
 * repositories: pinned author *and* committer dates, `TZ=UTC`, no global or
 * system config, identities passed per-invocation rather than read from the
 * developer's `~/.gitconfig`, and no signing.
 */

export interface Identity {
  readonly name: string;
  readonly email: string;
}

export const ADA: Identity = { name: "Ada Lovelace", email: "ada@example.dev" };
export const GRACE: Identity = {
  name: "Grace Hopper",
  email: "grace@example.dev",
};
/** The co-author trailer the agent-authorship heuristics look for. */
export const CLAUDE_TRAILER = "Claude <noreply@anthropic.com>";

export interface CommitSpec {
  /** The subject line. Written verbatim — no cleanup, no reflowing. */
  readonly message: string;
  /** Everything after the blank line. Any bytes except NUL are legal here. */
  readonly body?: string;
  /** ISO 8601. Pins both the author date and the committer date. */
  readonly date: string;
  readonly author?: Identity;
  /** Defaults to the author — set it to make the two disagree. */
  readonly committer?: Identity;
  /** path (repo-relative, `/`-separated) → file contents. */
  readonly files?: Readonly<Record<string, string>>;
  readonly deletes?: readonly string[];
  /** Each becomes a `Co-Authored-By:` trailer, in order. */
  readonly coAuthors?: readonly string[];
  readonly allowEmpty?: boolean;
}

export interface MergeSpec {
  readonly date: string;
  readonly message?: string;
  readonly author?: Identity;
  readonly committer?: Identity;
}

const registry = new Set<FixtureRepo>();

/** Removes every repository any test built. Call from `afterAll`. */
export function cleanupFixtureRepos(): void {
  for (const repo of registry) repo.destroy();
  registry.clear();
}

export interface FixtureRepoOptions {
  readonly prefix?: string;
  readonly defaultBranch?: string;
}

export function createFixtureRepo(
  options: FixtureRepoOptions = {},
): FixtureRepo {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), `fathohm-${options.prefix ?? "fixture"}-`),
  );
  const repo = new FixtureRepo(dir, options.defaultBranch ?? "main");
  repo.init();
  registry.add(repo);
  return repo;
}

/**
 * Wraps an existing directory (a clone, a submodule's origin) without running
 * `git init` in it.
 */
function adoptFixtureRepo(dir: string, defaultBranch: string): FixtureRepo {
  const repo = new FixtureRepo(dir, defaultBranch);
  registry.add(repo);
  return repo;
}

export class FixtureRepo {
  readonly dir: string;
  readonly defaultBranch: string;

  constructor(dir: string, defaultBranch: string) {
    this.dir = dir;
    this.defaultBranch = defaultBranch;
  }

  init(): void {
    this.git(["init", "--quiet", "--initial-branch", this.defaultBranch]);
  }

  /**
   * The one place a git process is started. Identity arrives as `-c` flags and
   * dates as environment, so nothing about the machine running the test can
   * leak into the repository.
   */
  git(args: readonly string[], env: Readonly<Record<string, string>> = {}): string {
    return execFileSync("git", [...configArgs(ADA), ...args], {
      cwd: this.dir,
      encoding: "utf8",
      env: { ...baseEnv(this.dir), ...env },
    });
  }

  gitBuffer(args: readonly string[]): Buffer {
    return execFileSync("git", [...configArgs(ADA), ...args], {
      cwd: this.dir,
      env: baseEnv(this.dir),
      maxBuffer: 256 * 1024 * 1024,
    });
  }

  write(relativePath: string, contents: string): void {
    const full = path.join(this.dir, relativePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }

  symlink(target: string, relativePath: string): void {
    const full = path.join(this.dir, relativePath);
    mkdirSync(path.dirname(full), { recursive: true });
    symlinkSync(target, full);
  }

  /** Stages everything and commits it. Returns the new sha. */
  commit(spec: CommitSpec): string {
    for (const [file, contents] of Object.entries(spec.files ?? {})) {
      this.write(file, contents);
    }
    for (const file of spec.deletes ?? []) {
      this.git(["rm", "--quiet", "-f", "--", file]);
    }
    this.git(["add", "--all", "."]);

    const author = spec.author ?? ADA;
    const committer = spec.committer ?? author;
    this.git(
      [
        ...identityArgs(author),
        "commit",
        "--quiet",
        "--cleanup=verbatim",
        ...(spec.allowEmpty === true ? ["--allow-empty"] : []),
        "-m",
        composeMessage(spec),
      ],
      dateEnv(spec.date, author, committer),
    );
    return this.head();
  }

  /**
   * A squash-merge as GitHub writes it: one ordinary single-parent commit
   * whose subject carries the pull request number. There is no merge commit to
   * find, which is exactly why `prMediated` cannot be inferred from the graph
   * alone.
   */
  squashSubjectCommit(spec: CommitSpec & { readonly pr: number }): string {
    return this.commit({ ...spec, message: `${spec.message} (#${spec.pr})` });
  }

  createBranch(name: string): void {
    this.git(["checkout", "--quiet", "-b", name]);
  }

  checkout(name: string): void {
    this.git(["checkout", "--quiet", name]);
  }

  /** A real two-parent merge commit. Never fast-forwarded. */
  merge(branch: string, spec: MergeSpec): string {
    const author = spec.author ?? ADA;
    const committer = spec.committer ?? author;
    this.git(
      [
        ...identityArgs(author),
        "merge",
        "--quiet",
        "--no-ff",
        "--cleanup=verbatim",
        "-m",
        spec.message ?? `Merge branch '${branch}'`,
        branch,
      ],
      dateEnv(spec.date, author, committer),
    );
    return this.head();
  }

  tag(name: string): void {
    this.git(["tag", name]);
  }

  head(): string {
    return this.git(["rev-parse", "HEAD"]).trim();
  }

  /**
   * Adds `other` as a submodule and commits the gitlink. `file://` (not a bare
   * path) because git refuses the file protocol for submodules unless it is
   * asked in as many words.
   */
  addSubmodule(other: FixtureRepo, at: string, spec: MergeSpec): void {
    this.git(["submodule", "add", "--quiet", fileUrl(other.dir), at]);
    const author = spec.author ?? ADA;
    const committer = spec.committer ?? author;
    this.git(["add", "--all", "."]);
    this.git(
      [
        ...identityArgs(author),
        "commit",
        "--quiet",
        "--cleanup=verbatim",
        "-m",
        spec.message ?? `Add ${at}`,
      ],
      dateEnv(spec.date, author, committer),
    );
  }

  /**
   * A depth-limited clone — the one way to produce a genuinely truncated
   * history. A local *path* clone silently ignores `--depth`, so this goes
   * through a `file://` URL and the result really is shallow.
   */
  shallowClone(depth = 1): FixtureRepo {
    const target = mkdtempSync(path.join(os.tmpdir(), "fathohm-shallow-"));
    const dest = path.join(target, "clone");
    execFileSync(
      "git",
      [
        ...configArgs(ADA),
        "clone",
        "--quiet",
        "--depth",
        String(depth),
        fileUrl(this.dir),
        dest,
      ],
      { cwd: target, env: baseEnv(target), encoding: "utf8" },
    );
    return adoptFixtureRepo(dest, this.defaultBranch);
  }

  /**
   * A bare clone — every object and ref of this repository, and no working tree
   * at all.
   *
   * It is the shape that breaks positional parsing of a `git rev-parse` probe:
   * with no work tree there is no repository root to report, so git answers the
   * root question with NO LINE rather than an empty one, and `--show-toplevel`
   * would refuse outright. Reading one is not an exotic case either — a CI
   * runner or a mirror host is often standing in exactly this directory.
   */
  bareClone(): FixtureRepo {
    const target = mkdtempSync(path.join(os.tmpdir(), "fathohm-bare-"));
    const dest = path.join(target, "bare.git");
    execFileSync(
      "git",
      [...configArgs(ADA), "clone", "--quiet", "--bare", fileUrl(this.dir), dest],
      { cwd: target, env: baseEnv(target), encoding: "utf8" },
    );
    return adoptFixtureRepo(dest, this.defaultBranch);
  }

  /**
   * Writes a history in one `git fast-import`, for fixtures too large to build
   * a commit at a time.
   *
   * The result is an ordinary repository — real objects, real parent edges,
   * real merges — and `git log` cannot tell it from one built by two thousand
   * `git commit` invocations. What it is not is a *worktree*: fast-import
   * writes refs and objects and leaves the index alone, which is fine here
   * because fathohm reads `log` and `ls-tree` and never opens a working file.
   *
   * It exists for one reason: the perf gate needs a repository with a thousand
   * merges in it, and a thousand `git merge` spawns is a minute of wall clock
   * before the thing being measured has started.
   */
  fastImport(stream: string): void {
    execFileSync("git", [...configArgs(ADA), "fast-import", "--quiet"], {
      cwd: this.dir,
      env: baseEnv(this.dir),
      input: stream,
      maxBuffer: 256 * 1024 * 1024,
    });
  }

  destroy(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export interface MergeHeavyOptions {
  /** Feature/merge pairs. The history is twice this many commits. */
  readonly pairs: number;
  /** Distinct files in the tree. */
  readonly files: number;
  /** Paths each feature branch touches. */
  readonly filesPerBranch?: number;
  /** The newest commit's date; the history runs backwards from it. */
  readonly endDate: string;
  readonly spanDays?: number;
}

/**
 * A merge-heavy repository, built in one fast-import pass.
 *
 * Merge-heavy on purpose, and this is the whole point of the fixture:
 * `extract.ts` reads the log with `--diff-merges=first-parent`, which makes git
 * compute a real diff for every merge commit it walks. On an ordinary history
 * that cost is invisible; on a trunk that takes a thousand branches it is where
 * the entire extraction budget goes. A perf fixture of two thousand linear
 * commits would pass while telling you nothing about the repositories this
 * command is actually pointed at.
 *
 * Shape, per pair: one commit on a feature branch off the trunk tip, then a
 * two-parent merge of it back onto the trunk carrying the same file changes —
 * so the merge's first-parent diff is the branch's file list, exactly as a pull
 * request's would be.
 */
export function createMergeHeavyRepo(options: MergeHeavyOptions): FixtureRepo {
  const repo = createFixtureRepo({ prefix: "merge-heavy" });
  repo.fastImport(mergeHeavyStream(repo.defaultBranch, options));
  return repo;
}

/** The fast-import stream. Split out so it is readable, and so a test can
 *  assert the shape without importing a repository. */
export function mergeHeavyStream(branch: string, options: MergeHeavyOptions): string {
  const pairs = Math.max(1, Math.floor(options.pairs));
  const fileCount = Math.max(1, Math.floor(options.files));
  const perBranch = Math.max(1, Math.floor(options.filesPerBranch ?? 3));
  const spanDays = Math.max(1, Math.floor(options.spanDays ?? 540));
  const endSeconds = Math.floor(Date.parse(options.endDate) / 1000);
  const stepSeconds = Math.max(1, Math.floor((spanDays * 86_400) / (pairs * 2)));

  const out: string[] = [`reset refs/heads/${branch}\n`];
  let mark = 0;
  let trunk = 0;

  for (let pair = 0; pair < pairs; pair += 1) {
    // Oldest first: fast-import builds the history forwards.
    const age = pairs - pair;
    const featureAt = endSeconds - (age * 2) * stepSeconds;
    const mergeAt = endSeconds - (age * 2 - 1) * stepSeconds;
    const author = pair % 3 === 0 ? GRACE : ADA;
    const touched: string[] = [];
    for (let slot = 0; slot < perBranch; slot += 1) {
      touched.push(pathAt((pair * perBranch + slot) % fileCount));
    }
    const changes = touched
      .map((file) => blobLines(file, `// ${file}\nexport const pair${pair} = ${pair};\n`))
      .join("");

    mark += 1;
    const featureMark = mark;
    out.push(
      `commit refs/heads/feature\n`,
      `mark :${featureMark}\n`,
      ...identityLines(author, featureAt),
      dataBlock(
        `work on pair ${pair}\n\n` +
          (pair % 4 === 0 ? `Co-Authored-By: ${CLAUDE_TRAILER}\n` : ""),
      ),
      trunk === 0 ? "" : `from :${trunk}\n`,
      changes,
      "\n",
    );

    mark += 1;
    const mergeMark = mark;
    out.push(
      `commit refs/heads/${branch}\n`,
      `mark :${mergeMark}\n`,
      ...identityLines(ADA, mergeAt),
      dataBlock(`Merge pull request #${pair} from feature/pair-${pair}\n`),
      trunk === 0 ? `from :${featureMark}\n` : `from :${trunk}\nmerge :${featureMark}\n`,
      changes,
      "\n",
    );
    trunk = mergeMark;
  }

  out.push(`done\n`);
  return out.join("");
}

function pathAt(index: number): string {
  return `src/pkg${index % 16}/mod${Math.floor(index / 16) % 16}/unit${index}.ts`;
}

function identityLines(identity: Identity, atSeconds: number): string[] {
  const stamp = `${identity.name} <${identity.email}> ${atSeconds} +0000`;
  return [`author ${stamp}\n`, `committer ${stamp}\n`];
}

/** `data <byte count>` + exactly that many bytes. Counted in BYTES, not
 *  characters — a non-ASCII message would otherwise desynchronise the stream. */
function dataBlock(text: string): string {
  return `data ${Buffer.byteLength(text, "utf8")}\n${text}`;
}

function blobLines(file: string, contents: string): string {
  return `M 100644 inline ${file}\n${dataBlock(contents)}`;
}

function fileUrl(dir: string): string {
  return `file://${dir}`;
}

function composeMessage(spec: CommitSpec): string {
  const trailers = (spec.coAuthors ?? []).map(
    (identity) => `Co-Authored-By: ${identity}`,
  );
  const paragraphs: string[] = [spec.message];
  if (spec.body !== undefined && spec.body !== "") paragraphs.push(spec.body);
  if (trailers.length > 0) paragraphs.push(trailers.join("\n"));
  return `${paragraphs.join("\n\n")}\n`;
}

function identityArgs(identity: Identity): string[] {
  return [
    "-c",
    `user.name=${identity.name}`,
    "-c",
    `user.email=${identity.email}`,
  ];
}

function configArgs(identity: Identity): string[] {
  return [
    ...identityArgs(identity),
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.safecrlf=false",
    "-c",
    "advice.detachedHead=false",
    "-c",
    "protocol.file.allow=always",
    "-c",
    "gc.auto=0",
  ];
}

/**
 * `NodeJS.ProcessEnv`, not `Record<string, string>`: the root tsconfig pulls in
 * `next-env.d.ts`, which augments `ProcessEnv` with a REQUIRED `NODE_ENV`, so a
 * plain string record is not assignable to `execFileSync`'s `env` option there.
 * Spreading `process.env` directly carries that property through instead of
 * rebuilding the object and losing it.
 */
function baseEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    TZ: "UTC",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "true",
  };
}

function dateEnv(
  date: string,
  author: Identity,
  committer: Identity,
): Record<string, string> {
  return {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
  };
}
