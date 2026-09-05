import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupFixtureRepos,
  createFixtureRepo,
  type FixtureRepo,
} from "../test-helpers/fixture-repo";
import { EXIT, isCliError, type ExitCode } from "../src/cmd/errors";
import { extractRepo, logFailureHint, parseLogStream, parseLsTree } from "../src/repo/extract";
import { runGit } from "../src/repo/git";
import { main, type CliIo } from "../src";

/**
 * ERROR UX — the three things every failure owes its reader, audited as a
 * property of the code and then exercised on the failures people actually hit.
 *
 * The three, from the spec:
 *
 *   1. **the git command that failed**, verbatim, so it can be pasted;
 *   2. **what fathohm expected from it**, so the reader knows which of the two
 *      of you is confused;
 *   3. **one next step**, in the `hint:` line — one, not a list. A failure in a
 *      CI log is read by somebody who did not write the invocation and cannot
 *      see the repository, and three suggestions is the same as none.
 *
 * Stack traces appear only under `--debug`. A stack in a CI log is noise for
 * everyone who is not debugging fathohm itself, and noise is how the line that
 * mattered gets scrolled past.
 *
 * The structural test below is the one that keeps this true for errors nobody
 * has written yet: every `new CliError(...)` in `cli/src`, without exception,
 * passes a hint.
 */

const CLI_ROOT = path.join(process.cwd(), "cli");
const SRC_DIR = path.join(CLI_ROOT, "src");

let repo: FixtureRepo | null = null;
function fixture(): FixtureRepo {
  if (repo === null) {
    repo = createFixtureRepo({ prefix: "error-ux" });
    repo.commit({
      message: "first",
      date: "2026-06-01T00:00:00Z",
      files: { "src/a.ts": "export const a = 1;\n" },
    });
  }
  return repo;
}

const scratch: string[] = [];
function emptyDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fathohm-not-a-repo-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  cleanupFixtureRepos();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ─── the structural audit ────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found.sort();
}

/**
 * The argument list of a call, split at top level.
 *
 * String and template contents are skipped rather than parsed: a message
 * legitimately contains commas, parentheses and braces, and counting them
 * would report an error site as malformed because its copy reads well.
 */
function callArguments(text: string, openParen: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = openParen + 1;
  let quote: string | null = null;

  for (let i = openParen; i < text.length; i += 1) {
    const character = text[i];
    if (quote !== null) {
      if (character === "\\") i += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        parts.push(text.slice(start, i));
        break;
      }
    } else if (character === "," && depth === 1) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

describe("every error site owes a next step", () => {
  it("passes a hint to every `new CliError`", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const text = readFileSync(file, "utf8");
      let at = -1;
      while ((at = text.indexOf("new CliError(", at + 1)) !== -1) {
        const args = callArguments(text, at + "new CliError".length);
        if (args.length >= 3) continue;
        const line = text.slice(0, at).split("\n").length;
        offenders.push(`${path.relative(process.cwd(), file)}:${line}`);
      }
    }
    // The type allows a two-argument CliError for the rare self-evident case.
    // In practice there is no such case, and a site that thinks it has one
    // should have to argue with this test first.
    expect(offenders).toEqual([]);
  });
});

// ─── the failure modes, table-driven ─────────────────────────────────────────

interface FailureCase {
  readonly name: string;
  readonly exitCode: ExitCode;
  /** A fragment of the git argv the message must quote back. */
  readonly names: string;
  readonly run: () => unknown | Promise<unknown>;
}

/**
 * `PATH` with nothing on it. `runGitOutcome` turns the resulting ENOENT into
 * the "there is no git here" error, which is the first thing anybody hits on a
 * minimal container image.
 */
function withoutGitOnPath<T>(body: () => T): T {
  const original = process.env.PATH;
  process.env.PATH = path.join(os.tmpdir(), "fathohm-no-such-bin");
  try {
    return body();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
}

const CASES: readonly FailureCase[] = [
  {
    name: "git is not installed",
    exitCode: EXIT.cannotRead,
    names: "git rev-parse",
    run: () => withoutGitOnPath(() => extractRepo(emptyDir())),
  },
  {
    name: "the directory is not a repository",
    exitCode: EXIT.cannotRead,
    names: "git rev-parse",
    run: () => extractRepo(emptyDir()),
  },
  {
    name: "--at names a ref that does not resolve",
    exitCode: EXIT.usage,
    names: "git rev-parse --verify",
    run: () => extractRepo(fixture().dir, { atRef: "no-such-ref" }),
  },
  {
    name: "git refuses the invocation",
    exitCode: EXIT.cannotRead,
    names: "git log --no-such-flag",
    run: () =>
      runGit(fixture().dir, ["log", "--no-such-flag"], {
        expected: "the commit history",
        hint: "run `git log` yourself to see what this repository will give you.",
      }),
  },
  {
    name: "the log did not have the shape git was asked for",
    exitCode: EXIT.cannotRead,
    names: "git log",
    run: () => parseLogStream([Buffer.from("not-a-frame\u0000", "utf8")]),
  },
  {
    name: "the tree listing did not have the shape git was asked for",
    exitCode: EXIT.cannotRead,
    names: "git ls-tree",
    run: () => parseLsTree(Buffer.from("nonsense-with-no-tab\u0000", "utf8")),
  },
];

/** Words that make a hint an instruction rather than an observation. */
const NEXT_STEP = /\b(run|re-run|install|upgrade|check|pass|put|try|list|remove|pick|add|fetch)\b/i;

describe.each(CASES)("$name", (testCase) => {
  it("exits with the documented code, names the command, and gives one next step", async () => {
    let thrown: unknown = null;
    try {
      await testCase.run();
    } catch (error) {
      thrown = error;
    }

    expect(isCliError(thrown), `${testCase.name} did not raise a CliError`).toBe(true);
    if (!isCliError(thrown)) return;

    expect(thrown.exitCode).toBe(testCase.exitCode);
    // 1. the command, verbatim and pasteable.
    expect(thrown.message, `does not name \`${testCase.names}\``).toContain(testCase.names);
    // 2. what fathohm wanted from it.
    expect(thrown.message.toLowerCase()).toContain("expected");
    // 3. one next step.
    expect(thrown.hint ?? "").not.toBe("");
    expect(thrown.hint ?? "", "the hint is not an instruction").toMatch(NEXT_STEP);
  });
});

describe("a git too old for --diff-merges=first-parent", () => {
  // The one failure that cannot be reproduced on a modern machine, which is
  // exactly why the hint is a pure exported function rather than a string built
  // at the throw site.
  it("says which flag, which version, and why fathohm needs it", () => {
    const hint = logFailureHint(
      "fatal: unknown value for --diff-merges: first-parent",
      "HEAD",
      "/repo",
    );
    expect(hint).toContain("--diff-merges=first-parent");
    expect(hint).toContain("2.31");
    expect(hint).toMatch(NEXT_STEP);
    // Why it matters, not just that it is required: a reader deciding whether
    // to upgrade git in a build image is owed the consequence.
    expect(hint).toContain("recorded against no file at all");
  });

  it("falls back to the generic next step for any other failure", () => {
    const hint = logFailureHint("fatal: bad object HEAD", "HEAD", "/repo");
    expect(hint).toContain("git log --oneline -5 HEAD");
    expect(hint).toContain("/repo");
  });
});

// ─── the failure block, as the user sees it ──────────────────────────────────

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (chunk) => out.push(chunk),
      stderr: (chunk) => err.push(chunk),
      env: {},
      isTTY: false,
      columns: 80,
      cwd: emptyDir(),
    },
  };
}

describe("the failure block on stderr", () => {
  it("prints error and hint, and nothing on stdout", async () => {
    const { io, out, err } = capture();
    const code = await main([], io);

    expect(code).toBe(EXIT.cannotRead);
    // stdout stays empty so a piped `--json` reading is still parseable when
    // the run dies halfway.
    expect(out).toEqual([]);
    expect(err.join("")).toMatch(/^error: /);
    expect(err.join("")).toContain("hint: ");
  });

  it("shows a stack only under --debug", async () => {
    const plain = capture();
    await main([], plain.io);
    expect(plain.err.join("")).not.toContain("\n    at ");

    const debugged = capture();
    await main(["--debug"], debugged.io);
    expect(debugged.err.join("")).toContain("\n    at ");
  });

  it("suggests the nearest flag rather than printing the whole surface", async () => {
    const { io, err } = capture();
    const code = await main(["read", "--quie"], io);
    expect(code).toBe(EXIT.usage);
    expect(err.join("")).toContain("did you mean `--quiet`?");
  });
});
