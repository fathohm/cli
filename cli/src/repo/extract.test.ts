import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT, isCliError } from "../cmd/errors";
import {
  LOG_FORMAT,
  LogFrameParser,
  commitCollector, extractRepo,
  logArgs,
  logFailureHint,
  parseLogStream,
  parseLsTree,
  type CommitRecord,
} from "./extract";
import {
  ADA,
  CLAUDE_TRAILER,
  GRACE,
  cleanupFixtureRepos,
  createFixtureRepo,
  type FixtureRepo,
} from "../../test-helpers/fixture-repo";

afterAll(() => {
  cleanupFixtureRepos();
});

const US = "\u001f";
const NUL = "\u0000";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

interface FrameSpec {
  readonly sha: string;
  readonly parents?: readonly string[];
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly authoredAt?: string;
  readonly committerName?: string;
  readonly committerEmail?: string;
  readonly subject?: string;
  readonly body?: string;
  readonly paths?: readonly string[];
}

/**
 * Builds one `git log` entry by hand. This is the grammar the parser claims
 * git speaks; a separate test feeds real git output through the same expected
 * bytes, so if git ever changes its mind, this synthesiser is caught with it.
 */
function frame(spec: FrameSpec): string {
  const header = [
    spec.sha,
    (spec.parents ?? []).join(" "),
    spec.authorName ?? "Ada Lovelace",
    spec.authorEmail ?? "ada@example.dev",
    spec.authoredAt ?? "2026-01-01T00:00:00Z",
    spec.committerName ?? "Ada Lovelace",
    spec.committerEmail ?? "ada@example.dev",
    spec.subject ?? "subject",
    spec.body ?? "",
  ].join(US);
  const paths = spec.paths ?? [];
  const diff = paths.length === 0 ? "" : `\n${paths.join(NUL)}${NUL}`;
  return `${header}${NUL}${diff}`;
}

/** Entries are separated — not terminated — by NUL, exactly as `format:` does. */
function logStream(specs: readonly FrameSpec[]): Buffer {
  return Buffer.from(specs.map(frame).join(NUL), "utf8");
}

describe("the log frame grammar", () => {
  it("reads a commit's fields, paths, and parent count", () => {
    const commits = parseLogStream([
      logStream([
        {
          sha: SHA_A,
          parents: [SHA_B],
          subject: "teach the reader to count",
          paths: ["src/a.ts", "src/b.ts"],
        },
      ]),
    ]);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe(SHA_A);
    expect(commits[0].parentCount).toBe(1);
    expect(commits[0].paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("counts a root commit as parentless and a merge by its parents", () => {
    const commits = parseLogStream([
      logStream([
        { sha: SHA_A, parents: [SHA_B, SHA_C], subject: "Merge" },
        { sha: SHA_B, parents: [], subject: "root", paths: ["a.ts"] },
      ]),
    ]);
    expect(commits.map((commit) => commit.parentCount)).toEqual([2, 0]);
  });

  it("keeps a body that contains the field separator itself", () => {
    // The body is the last field precisely so that it may contain anything.
    const body = `line one${US}still the body\nCo-Authored-By: ${CLAUDE_TRAILER}\n`;
    const commits = parseLogStream([
      logStream([{ sha: SHA_A, parents: [SHA_B], body, paths: ["a.ts"] }]),
    ]);
    expect(commits[0].body).toBe(body);
    expect(commits[0].subject).toBe("subject");
  });

  it("does not resynchronise on a fake commit header hidden in a body", () => {
    // A body that looks exactly like the start of another frame. If framing
    // ever fell back to pattern-matching for shas, this would read as two
    // commits and quietly double somebody's contact with the code.
    const impostor = [
      SHA_C,
      SHA_B,
      "Mallory",
      "mallory@example.dev",
      "2020-01-01T00:00:00Z",
      "Mallory",
      "mallory@example.dev",
      "not a real commit",
      "",
    ].join(US);
    const commits = parseLogStream([
      logStream([
        { sha: SHA_A, parents: [SHA_B], body: impostor, paths: ["a.ts"] },
      ]),
    ]);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe(SHA_A);
    expect(commits[0].body).toBe(impostor);
  });

  it("strips exactly one line feed, so a path may begin with one", () => {
    const commits = parseLogStream([
      logStream([{ sha: SHA_A, parents: [SHA_B], paths: ["\nodd.ts", "b.ts"] }]),
    ]);
    expect(commits[0].paths).toEqual(["\nodd.ts", "b.ts"]);
  });

  it("reads a commit that lists no paths at all", () => {
    // A merge that changed nothing against its first parent, an empty commit:
    // the header is closed immediately, and the record is still a record.
    const commits = parseLogStream([
      logStream([
        { sha: SHA_A, parents: [SHA_B, SHA_C], subject: "Merge", paths: [] },
        { sha: SHA_B, parents: [], subject: "root", paths: ["a.ts"] },
      ]),
    ]);
    expect(commits[0].paths).toEqual([]);
    expect(commits[1].paths).toEqual(["a.ts"]);
  });

  it("gives the same answer for every possible chunk boundary", () => {
    const stream = logStream([
      { sha: SHA_A, parents: [SHA_B, SHA_C], subject: "Merge branch 'x' (#7)" },
      {
        sha: SHA_B,
        parents: [SHA_C],
        subject: "work",
        body: `trailing${US}bytes\n`,
        paths: ["src/файл 🚀.ts", "spa ce/b.ts"],
      },
      { sha: SHA_C, parents: [], subject: "root", paths: ["a.ts"] },
    ]);
    const whole = parseLogStream([stream]);
    expect(whole).toHaveLength(3);

    for (let cut = 0; cut <= stream.length; cut += 1) {
      const split = parseLogStream([
        stream.subarray(0, cut),
        stream.subarray(cut),
      ]);
      expect(split).toEqual(whole);
    }

    const byteByByte = parseLogStream(
      Array.from({ length: stream.length }, (_, i) => stream.subarray(i, i + 1)),
    );
    expect(byteByByte).toEqual(whole);
  });

  it("emits nothing for an empty stream", () => {
    expect(parseLogStream([])).toEqual([]);
    expect(parseLogStream([Buffer.alloc(0)])).toEqual([]);
  });

  it("refuses a truncated header rather than inventing fields", () => {
    const broken = Buffer.from(`${SHA_A}${US}${SHA_B}${US}Ada${NUL}`, "utf8");
    let thrown: unknown = null;
    try {
      parseLogStream([broken]);
    } catch (error) {
      thrown = error;
    }
    expect(isCliError(thrown)).toBe(true);
    if (!isCliError(thrown)) return;
    expect(thrown.exitCode).toBe(EXIT.cannotRead);
    // The argv fathohm ran, verbatim in both halves — a reader can paste it.
    // Not a description of it: a quoted command that is not the command sends
    // them off to reproduce something that works.
    const command = `git ${logArgs("HEAD", null).join(" ")}`;
    expect(thrown.message).toContain(command);
    expect(thrown.hint).toContain(command);
  });

  it("refuses a header whose date is not strict ISO 8601", () => {
    const stream = logStream([
      { sha: SHA_A, parents: [SHA_B], authoredAt: "yesterday", paths: ["a.ts"] },
    ]);
    expect(() => parseLogStream([stream])).toThrow();
  });

  it("stays linear on a history far past anything a person will read", () => {
    const specs: FrameSpec[] = [];
    for (let i = 0; i < 50_000; i += 1) {
      specs.push({
        sha: i.toString(16).padStart(40, "0"),
        parents: [SHA_B],
        subject: `commit ${i}`,
        paths: [`src/mod-${i % 500}/file-${i % 40}.ts`],
      });
    }
    const commits = parseLogStream([logStream(specs)]);
    expect(commits).toHaveLength(50_000);
    expect(commits[49_999].paths).toEqual(["src/mod-499/file-39.ts"]);
  });

  it("drives the same parser incrementally without a subprocess", () => {
    const seen: CommitRecord[] = [];
    const parser = new LogFrameParser((commit) => {
      seen.push(commit);
    });
    const stream = logStream([
      { sha: SHA_A, parents: [SHA_B], paths: ["a.ts"] },
      { sha: SHA_B, parents: [], paths: ["b.ts"] },
    ]);
    parser.push(stream);
    parser.end();
    expect(seen.map((commit) => commit.sha)).toEqual([SHA_A, SHA_B]);
  });
});

describe("ls-tree records", () => {
  it("keeps blobs with their byte sizes and counts gitlinks separately", () => {
    const output = Buffer.from(
      [
        `100644 blob ${"1".repeat(40)}     185\t.gitmodules`,
        `120000 blob ${"2".repeat(40)}       5\tlink.txt`,
        `100644 blob ${"3".repeat(40)}      42\tsrc/файл 🚀.ts`,
        `160000 commit ${"4".repeat(40)}       -\tvendor/sub`,
      ].join(NUL) + NUL,
      "utf8",
    );
    const reading = parseLsTree(output);
    expect(reading.entries).toEqual([
      { path: ".gitmodules", bytes: 185 },
      { path: "link.txt", bytes: 5 },
      { path: "src/файл 🚀.ts", bytes: 42 },
    ]);
    expect(reading.submodulesSkipped).toBe(1);
  });

  it("splits at the first tab, so a path may contain tabs of its own", () => {
    const output = Buffer.from(
      `100644 blob ${"1".repeat(40)}       7\ttab\there.ts${NUL}`,
      "utf8",
    );
    expect(parseLsTree(output).entries).toEqual([
      { path: "tab\there.ts", bytes: 7 },
    ]);
  });

  it("refuses metadata it cannot read rather than guessing a size", () => {
    const output = Buffer.from(`garbage\tsome/path.ts${NUL}`, "utf8");
    expect(() => parseLsTree(output)).toThrow();
  });
});

/**
 * The framing above is a claim about git. This is the claim being checked
 * against the real thing — including the one behaviour worth writing down:
 * `--name-only` alone lists NO paths for a merge commit, so fathohm asks for
 * `--diff-merges=first-parent` and a merge arrives carrying the net file set
 * the branch brought onto the trunk.
 */
describe("what git actually emits", () => {
  interface Grammar {
    readonly repo: FixtureRepo;
    readonly root: string;
    readonly side: string;
    readonly trunk: string;
    readonly merge: string;
  }

  /** root(a.ts) → [feature: side(b.ts)] + trunk(c.ts, d.ts) → merge. */
  function grammarRepo(prefix: string): Grammar {
    const repo = createFixtureRepo({ prefix });
    const root = repo.commit({
      message: "root",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    repo.createBranch("feature");
    const side = repo.commit({
      message: "side",
      body: `body${US}with separators`,
      date: "2026-01-02T00:00:00+00:00",
      files: { "b.ts": "2\n" },
    });
    repo.checkout("main");
    const trunk = repo.commit({
      message: "trunk",
      date: "2026-01-03T00:00:00+00:00",
      files: { "c.ts": "3\n", "d.ts": "4\n" },
    });
    const merge = repo.merge("feature", {
      date: "2026-01-04T00:00:00+00:00",
      message: "Merge branch 'feature' (#42)",
    });
    return { repo, root, side, trunk, merge };
  }

  function logArgs(diffMerges: boolean): string[] {
    return [
      "log",
      "--no-renames",
      "--name-only",
      ...(diffMerges ? ["--diff-merges=first-parent"] : []),
      "-z",
      `--pretty=format:${LOG_FORMAT}`,
      "HEAD",
      "--",
    ];
  }

  it("matches the hand-built grammar byte for byte, merges included", () => {
    const { repo, root, side, trunk, merge } = grammarRepo("grammar");

    const actual = repo.gitBuffer(logArgs(true));

    const expected = Buffer.from(
      [
        frame({
          sha: merge,
          parents: [trunk, side],
          authoredAt: "2026-01-04T00:00:00Z",
          subject: "Merge branch 'feature' (#42)",
          // The first-parent diff: what merging `feature` onto the trunk
          // actually brought in. This is the pull request's file set, and it
          // is what the merge's zero-comment approval is recorded against.
          paths: ["b.ts"],
        }),
        frame({
          sha: trunk,
          parents: [root],
          authoredAt: "2026-01-03T00:00:00Z",
          subject: "trunk",
          paths: ["c.ts", "d.ts"],
        }),
        frame({
          sha: side,
          parents: [root],
          authoredAt: "2026-01-02T00:00:00Z",
          subject: "side",
          // `%b` is the message after the subject's blank line, newline and
          // all — the fixture's trailing one included.
          body: `body${US}with separators\n`,
          paths: ["b.ts"],
        }),
        frame({
          sha: root,
          parents: [],
          authoredAt: "2026-01-01T00:00:00Z",
          subject: "root",
          paths: ["a.ts"],
        }),
      ].join(NUL),
      "utf8",
    );

    expect(actual.toString("utf8")).toBe(expected.toString("utf8"));
    expect(actual.equals(expected)).toBe(true);
  });

  it("names the flag and the version when git is too old to know it", () => {
    // git 2.30 and older: `--diff-merges` exists but not this value; older
    // still: the option itself is unknown. Either way git says the word, and
    // the next step is an upgrade — not a look at the history.
    for (const said of [
      "error: unknown option `diff-merges=first-parent'",
      "fatal: unknown value for --diff-merges: first-parent",
    ]) {
      const hint = logFailureHint(said, "HEAD", "/repo");
      expect(hint).toContain("--diff-merges=first-parent");
      expect(hint).toContain("git 2.31");
    }

    const ordinary = logFailureHint(
      "fatal: bad revision 'HEAD'",
      "HEAD",
      "/repo",
    );
    expect(ordinary).toContain("git log --oneline -5 HEAD");
    expect(ordinary).not.toContain("2.31");
  });

  it("changes the merge and nothing else", () => {
    // The flag's blast radius, measured rather than assumed: every ordinary
    // commit's record is byte-identical with and without it, and the merge is
    // the only record that gained anything.
    const { repo } = grammarRepo("diff-merges");

    const withFlag = parseLogStream([repo.gitBuffer(logArgs(true))]);
    const without = parseLogStream([repo.gitBuffer(logArgs(false))]);

    expect(withFlag.map((c) => c.sha)).toEqual(without.map((c) => c.sha));
    expect(withFlag.slice(1)).toEqual(without.slice(1));
    expect(without[0].paths).toEqual([]);
    expect(withFlag[0].paths).toEqual(["b.ts"]);
    expect({ ...withFlag[0], paths: [] }).toEqual(without[0]);
  });
});

/**
 * The history, kept — which extraction no longer does on its own.
 *
 * These tests are ABOUT what git produced, so they are exactly the caller that
 * should ask for the commits and pay for them. `extract.history` is where a
 * sink puts what it kept.
 */
function readingOf(repo: FixtureRepo) {
  return extractRepo(repo.dir, { sink: () => commitCollector() });
}

describe("extractRepo", () => {
  it("reads a single-commit repository", async () => {
    const repo = createFixtureRepo({ prefix: "single" });
    repo.commit({
      message: "the first honest line",
      date: "2026-02-01T09:30:00+00:00",
      files: { "src/index.ts": "export const x = 1;\n" },
    });

    const extract = await readingOf(repo);
    expect(extract.history).toHaveLength(1);
    const [commit] = extract.history;
    expect(commit.subject).toBe("the first honest line");
    expect(commit.parentCount).toBe(0);
    expect(commit.authorName).toBe(ADA.name);
    expect(commit.authorEmail).toBe(ADA.email);
    expect(commit.committerName).toBe(ADA.name);
    expect(new Date(commit.authoredAt).toISOString()).toBe(
      "2026-02-01T09:30:00.000Z",
    );
    expect(commit.paths).toEqual(["src/index.ts"]);
    expect(extract.tree).toEqual([
      { path: "src/index.ts", bytes: 20 },
    ]);
    expect(extract.provenance).toEqual({
      shallow: false,
      grafted: false,
      emptyRepo: false,
      sinceBound: null,
      atRef: null,
      submodulesSkipped: 0,
    });
  });

  it("keeps a non-UTC author offset rather than normalising it away", async () => {
    const repo = createFixtureRepo({ prefix: "offset" });
    repo.commit({
      message: "written in Bengaluru",
      date: "2026-02-01T15:00:00+05:30",
      files: { "a.ts": "1\n" },
    });
    const extract = await readingOf(repo);
    expect(extract.history[0].authoredAt).toBe("2026-02-01T15:00:00+05:30");
  });

  it("records a merge as a two-parent commit carrying the branch's file set", async () => {
    const repo = createFixtureRepo({ prefix: "merge" });
    repo.commit({
      message: "root",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    repo.createBranch("feature");
    repo.commit({
      message: "side work",
      date: "2026-01-02T00:00:00+00:00",
      files: { "b.ts": "2\n" },
      author: GRACE,
    });
    repo.checkout("main");
    repo.merge("feature", {
      date: "2026-01-03T00:00:00+00:00",
      message: "Merge pull request #9 from feature",
    });

    const extract = await readingOf(repo);
    const merge = extract.history[0];
    expect(merge.parentCount).toBe(2);
    // Not the merge's own edits (it made none) — the net change against the
    // first parent, which is what the pull request contained.
    expect(merge.paths).toEqual(["b.ts"]);
    expect(extract.history.map((commit) => commit.parentCount)).toEqual([
      2, 1, 0,
    ]);
    expect(extract.history.map((commit) => commit.authorEmail)).toEqual([
      ADA.email,
      GRACE.email,
      ADA.email,
    ]);
  });

  it("carries a co-author trailer through verbatim", async () => {
    const repo = createFixtureRepo({ prefix: "trailer" });
    repo.commit({
      message: "prompted work",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
      coAuthors: [CLAUDE_TRAILER],
    });
    const extract = await readingOf(repo);
    expect(extract.history[0].body).toContain(
      `Co-Authored-By: ${CLAUDE_TRAILER}`,
    );
  });

  it("reads unicode, space and emoji paths, and CRLF files, unmangled", async () => {
    const repo = createFixtureRepo({ prefix: "unicode" });
    const crlf = "line one\r\nline two\r\n";
    // `"` is not a legal character in an NTFS filename, so this one path cannot
    // be created on Windows — the fixture fails there, not the assertion. It is
    // the case that proves git's `core.quotePath` output is unquoted correctly,
    // and Linux runs it on every push; the other three (a space, Cyrillic, an
    // emoji, CRLF contents) are legal everywhere and stay in the set.
    const quoted: Record<string, string> =
      process.platform === "win32" ? {} : { "quote'and\"quote.ts": "1\n" };
    repo.commit({
      message: "odd paths",
      date: "2026-01-01T00:00:00+00:00",
      files: {
        "spa ce/dir/файл 🚀.ts": "export const emoji = 1;\n",
        "windows/crlf.ts": crlf,
        ...quoted,
      },
    });

    const extract = await readingOf(repo);
    const paths = extract.tree.map((entry) => entry.path).sort();
    expect(paths).toEqual(
      [...Object.keys(quoted), "spa ce/dir/файл 🚀.ts", "windows/crlf.ts"].sort(),
    );
    expect(extract.history[0].paths.slice().sort()).toEqual(paths);

    const crlfEntry = extract.tree.find(
      (entry) => entry.path === "windows/crlf.ts",
    );
    expect(crlfEntry?.bytes).toBe(Buffer.byteLength(crlf));
  });

  it("reports every blob's size as the bytes on disk", async () => {
    const repo = createFixtureRepo({ prefix: "sizes" });
    const files: Record<string, string> = {
      "small.ts": "x\n",
      "medium.ts": "y".repeat(1000) + "\n",
      "nested/deep/large.ts": "z".repeat(50_000) + "\n",
    };
    repo.commit({
      message: "sizes",
      date: "2026-01-01T00:00:00+00:00",
      files,
    });
    const extract = await readingOf(repo);
    for (const entry of extract.tree) {
      expect(entry.bytes).toBe(Buffer.byteLength(files[entry.path]));
    }
    expect(extract.tree).toHaveLength(3);
  });

  it("says an empty repository is empty instead of failing", async () => {
    const repo = createFixtureRepo({ prefix: "empty" });
    const extract = await readingOf(repo);
    expect(extract.history).toEqual([]);
    expect(extract.tree).toEqual([]);
    expect(extract.provenance.emptyRepo).toBe(true);
    expect(extract.provenance.shallow).toBe(false);
  });

  it("marks a depth-limited clone as shallow", async () => {
    const origin = createFixtureRepo({ prefix: "deep" });
    for (let i = 0; i < 4; i += 1) {
      origin.commit({
        message: `commit ${i}`,
        date: `2026-01-0${i + 1}T00:00:00+00:00`,
        files: { [`file-${i}.ts`]: `${i}\n` },
      });
    }
    const clone = origin.shallowClone(1);

    const full = await readingOf(origin);
    const truncated = await readingOf(clone);
    expect(full.provenance.shallow).toBe(false);
    expect(full.history).toHaveLength(4);
    expect(truncated.provenance.shallow).toBe(true);
    expect(truncated.history).toHaveLength(1);
    // The tree is whole even where the history is not — which is exactly why
    // a shallow reading must be reported as partial rather than as a number.
    expect(truncated.tree).toHaveLength(4);
  });

  it("notices grafts without reading them", async () => {
    const repo = createFixtureRepo({ prefix: "graft" });
    repo.commit({
      message: "root",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    expect((await readingOf(repo)).provenance.grafted).toBe(false);

    mkdirSync(path.join(repo.dir, ".git", "info"), { recursive: true });
    writeFileSync(path.join(repo.dir, ".git", "info", "grafts"), "");
    expect((await readingOf(repo)).provenance.grafted).toBe(true);
  });

  it("still notices a replacement once `git gc` has packed it", async () => {
    const repo = createFixtureRepo({ prefix: "replace" });
    repo.commit({ message: "one", date: "2026-01-01T00:00:00+00:00", files: { "a.ts": "1\n" } });
    repo.commit({ message: "two", date: "2026-01-02T00:00:00+00:00", files: { "a.ts": "2\n" } });
    repo.git(["replace", "-f", "HEAD~1", "HEAD"]);
    repo.git(["pack-refs", "--all"]);
    expect((await readingOf(repo)).provenance.grafted).toBe(true);
  });

  it("notices the repository's grafts from a linked worktree", async () => {
    const repo = createFixtureRepo({ prefix: "graft-wt" });
    repo.commit({ message: "root", date: "2026-01-01T00:00:00+00:00", files: { "a.ts": "1\n" } });
    const worktree = path.join(mkdtempSync(path.join(os.tmpdir(), "fathohm-wt-")), "wt");
    repo.git(["worktree", "add", "--quiet", worktree]);
    mkdirSync(path.join(repo.dir, ".git", "info"), { recursive: true });
    writeFileSync(path.join(repo.dir, ".git", "info", "grafts"), "");
    const reading = await extractRepo(worktree, { sink: () => commitCollector() });
    expect(reading.provenance.grafted).toBe(true);
  });

  it("skips a submodule gitlink and counts it", async () => {
    const inner = createFixtureRepo({ prefix: "inner" });
    inner.commit({
      message: "inner root",
      date: "2026-01-01T00:00:00+00:00",
      files: { "inner.ts": "1\n" },
    });
    const outer = createFixtureRepo({ prefix: "outer" });
    outer.commit({
      message: "outer root",
      date: "2026-01-02T00:00:00+00:00",
      files: { "outer.ts": "1\n" },
    });
    outer.addSubmodule(inner, "vendor/inner", {
      date: "2026-01-03T00:00:00+00:00",
      message: "vendor the inner repo",
    });

    const extract = await readingOf(outer);
    const paths = extract.tree.map((entry) => entry.path);
    expect(paths).toContain("outer.ts");
    expect(paths).toContain(".gitmodules");
    expect(paths).not.toContain("vendor/inner");
    expect(paths.some((p) => p.startsWith("vendor/inner/"))).toBe(false);
    expect(extract.provenance.submodulesSkipped).toBe(1);
  });

  it("records a symlink as the blob git stores", async () => {
    const repo = createFixtureRepo({ prefix: "symlink" });
    repo.write("real.ts", "export const real = 1;\n");
    repo.symlink("real.ts", "alias.ts");
    repo.commit({ message: "link it", date: "2026-01-01T00:00:00+00:00" });

    const extract = await readingOf(repo);
    const alias = extract.tree.find((entry) => entry.path === "alias.ts");
    expect(alias).toEqual({ path: "alias.ts", bytes: "real.ts".length });
  });

  it("bounds history with --since and records the bound", async () => {
    const repo = createFixtureRepo({ prefix: "since" });
    repo.commit({
      message: "old",
      date: "2025-01-01T00:00:00+00:00",
      files: { "old.ts": "1\n" },
    });
    repo.commit({
      message: "new",
      date: "2026-06-01T00:00:00+00:00",
      files: { "new.ts": "1\n" },
    });

    const bounded = await extractRepo(repo.dir, {
      since: "2026-01-01T00:00:00Z",
      sink: () => commitCollector(),
    });
    expect(bounded.history.map((commit) => commit.subject)).toEqual(["new"]);
    expect(bounded.provenance.sinceBound).toBe("2026-01-01T00:00:00Z");
    // The tree is the tree — `--since` bounds the history, not the files.
    expect(bounded.tree.map((entry) => entry.path).sort()).toEqual([
      "new.ts",
      "old.ts",
    ]);
  });

  it("reads a ref's own history and its own tree under --at", async () => {
    const repo = createFixtureRepo({ prefix: "at" });
    repo.commit({
      message: "first",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    repo.tag("v1");
    repo.commit({
      message: "second",
      date: "2026-02-01T00:00:00+00:00",
      files: { "b.ts": "2\n" },
    });

    const now = await readingOf(repo);
    expect(now.history).toHaveLength(2);
    expect(now.tree.map((entry) => entry.path)).toEqual(["a.ts", "b.ts"]);

    const then = await extractRepo(repo.dir, { atRef: "v1", sink: () => commitCollector() });
    expect(then.history.map((commit) => commit.subject)).toEqual(["first"]);
    expect(then.tree.map((entry) => entry.path)).toEqual(["a.ts"]);
    expect(then.provenance.atRef).toBe("v1");
  });

  it("reads the whole repository when run from a subdirectory", async () => {
    const repo = createFixtureRepo({ prefix: "subdir" });
    repo.commit({
      message: "two directories",
      date: "2026-01-01T00:00:00+00:00",
      files: { "top.ts": "1\n", "nested/inner.ts": "2\n" },
    });
    const extract = await extractRepo(path.join(repo.dir, "nested"), { sink: () => commitCollector() });
    expect(extract.tree.map((entry) => entry.path)).toEqual([
      "nested/inner.ts",
      "top.ts",
    ]);
  });

  /**
   * The subject of a reading is the REPOSITORY, and the directory handed in is
   * only where to start looking. Everything above proves the history and the
   * tree come back repo-wide from anywhere inside it; this is the name that has
   * to travel with them, because a header and a config lookup are both derived
   * from it downstream and both were derived from the wrong thing.
   */
  it("names the repository root, however deep it was entered", async () => {
    const repo = createFixtureRepo({ prefix: "root" });
    repo.commit({
      message: "two directories",
      date: "2026-01-01T00:00:00+00:00",
      files: { "top.ts": "1\n", "nested/deeper/inner.ts": "2\n" },
    });

    // From the root itself git reports the way up as an EMPTY string, which is
    // the line a positional parse most easily loses; from two levels down it is
    // `../../`. Both have to land on the same directory.
    const fromRoot = await extractRepo(repo.dir, { sink: () => commitCollector() });
    const fromDeep = await extractRepo(path.join(repo.dir, "nested", "deeper"), { sink: () => commitCollector() });

    expect(fromRoot.root).toBe(path.resolve(repo.dir));
    expect(fromDeep.root).toBe(fromRoot.root);
    expect(fromDeep.tree).toEqual(fromRoot.tree);
    expect(fromDeep.history).toEqual(fromRoot.history);
  });

  it("falls back to the directory it was handed for a bare repository", async () => {
    const source = createFixtureRepo({ prefix: "bare-source" });
    source.commit({
      message: "the only commit",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    const bare = source.bareClone();

    const extract = await extractRepo(bare.dir, { sink: () => commitCollector() });
    // A bare repository is still a readable one: same history, same tree.
    const original = await extractRepo(source.dir, { sink: () => commitCollector() });
    expect(extract.history.map((commit) => commit.sha)).toEqual(
      original.history.map((commit) => commit.sha),
    );
    expect(extract.tree).toEqual(original.tree);

    // But it has no working tree, so git reports no root at all — and the
    // honest name for it is the directory the reader pointed at.
    expect(extract.root).toBe(path.resolve(bare.dir));
  });

  it("names the root even when there is no commit to resolve", async () => {
    // The shortest probe output there is: the ref line is absent AND the way
    // up is present. Reading either one out of the other's slot is exactly the
    // failure a positional parse invites.
    const repo = createFixtureRepo({ prefix: "empty-root" });
    const nested = path.join(repo.dir, "nested");
    mkdirSync(nested, { recursive: true });

    const extract = await extractRepo(nested, { sink: () => commitCollector() });
    expect(extract.provenance.emptyRepo).toBe(true);
    expect(extract.history).toEqual([]);
    expect(extract.root).toBe(path.resolve(repo.dir));
  });

  it("gives byte-identical readings on repeated runs", async () => {
    const repo = createFixtureRepo({ prefix: "deterministic" });
    repo.commit({
      message: "root",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    repo.createBranch("feature");
    repo.squashSubjectCommit({
      message: "squashed work",
      pr: 12,
      date: "2026-01-02T00:00:00+00:00",
      files: { "b.ts": "2\n" },
    });
    repo.checkout("main");
    repo.merge("feature", { date: "2026-01-03T00:00:00+00:00" });

    const first = await readingOf(repo);
    const second = await readingOf(repo);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("records a squash-merge subject with nothing else to give it away", async () => {
    const repo = createFixtureRepo({ prefix: "squash" });
    repo.squashSubjectCommit({
      message: "Add the reading card",
      pr: 128,
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    const extract = await readingOf(repo);
    expect(extract.history[0].subject).toBe("Add the reading card (#128)");
    expect(extract.history[0].parentCount).toBe(0);
  });

  it("refuses a directory that is not a repository, at exit 3", async () => {
    const plain = mkdtempSync(path.join(os.tmpdir(), "fathohm-plain-"));
    const failure = await extractRepo(plain).catch((error: unknown) => error);
    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.exitCode).toBe(EXIT.cannotRead);
    expect(failure.message).toContain("git rev-parse");
    expect(failure.message).toContain("expected a git repository to read");
    expect(failure.hint).toContain("git status");
  });

  it("calls an --at ref that resolves to nothing a usage error", async () => {
    const repo = createFixtureRepo({ prefix: "badref" });
    repo.commit({
      message: "root",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    const failure = await extractRepo(repo.dir, {
      atRef: "no-such-ref",
    }).catch((error: unknown) => error);
    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.exitCode).toBe(EXIT.usage);
    expect(failure.message).toContain("git rev-parse --verify no-such-ref");
    expect(failure.hint).toContain("git log --oneline -5");
  });

  it("reads a merge-heavy history without losing a commit", async () => {
    const repo = createFixtureRepo({ prefix: "merges" });
    repo.commit({
      message: "root",
      date: "2026-01-01T00:00:00+00:00",
      files: { "a.ts": "1\n" },
    });
    for (let i = 0; i < 5; i += 1) {
      repo.createBranch(`feature-${i}`);
      repo.commit({
        message: `feature ${i}`,
        date: `2026-02-0${i + 1}T00:00:00+00:00`,
        files: { [`feat-${i}.ts`]: `${i}\n` },
        author: i % 2 === 0 ? ADA : GRACE,
      });
      repo.checkout("main");
      repo.merge(`feature-${i}`, {
        date: `2026-03-0${i + 1}T00:00:00+00:00`,
        message: `Merge pull request #${i} from feature-${i}`,
      });
    }

    const extract = await readingOf(repo);
    expect(extract.history).toHaveLength(11);
    const merges = extract.history.filter(
      (commit) => commit.parentCount >= 2,
    );
    expect(merges).toHaveLength(5);
    // Newest merge first: each carries exactly the file its branch added.
    expect(merges.map((commit) => commit.paths)).toEqual([
      ["feat-4.ts"],
      ["feat-3.ts"],
      ["feat-2.ts"],
      ["feat-1.ts"],
      ["feat-0.ts"],
    ]);
    expect(extract.tree).toHaveLength(6);
  });
});
