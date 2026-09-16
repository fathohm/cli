import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT, isCliError } from "../cmd/errors";
import { gitCommandLine, runGit, runGitOutcome, streamGit } from "./git";
import {
  cleanupFixtureRepos,
  createFixtureRepo,
} from "../../test-helpers/fixture-repo";

afterAll(() => {
  cleanupFixtureRepos();
});

function repoWithOneCommit() {
  const repo = createFixtureRepo({ prefix: "git" });
  repo.commit({
    message: "first",
    date: "2026-01-01T00:00:00+00:00",
    files: { "src/a.ts": "export const a = 1;\n" },
  });
  return repo;
}

describe("runGit", () => {
  it("returns stdout as bytes, not a decoded string", async () => {
    const repo = repoWithOneCommit();
    const out = await runGit(repo.dir, ["rev-parse", "HEAD"]);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString("utf8").trim()).toBe(repo.head());
  });

  it("never lets the machine's git config change what it reads", async () => {
    // `log.mailmap` is the sharpest case: a mailmap in effect would rewrite
    // the author fathohm attributes the work to.
    const repo = repoWithOneCommit();
    repo.write(".mailmap", "Someone Else <else@example.dev> <ada@example.dev>\n");
    repo.commit({
      message: "add mailmap",
      date: "2026-01-02T00:00:00+00:00",
      files: {},
    });
    repo.git(["config", "log.mailmap", "true"]);

    const out = await runGit(repo.dir, ["log", "-1", "--pretty=format:%an"]);
    expect(out.toString("utf8")).toBe("Ada Lovelace");
  });

  it("reads the directory it was given even when a git hook exported GIT_DIR", async () => {
    const target = repoWithOneCommit();
    const hookRepo = createFixtureRepo({ prefix: "git-hook" });
    hookRepo.commit({
      message: "other",
      date: "2026-02-01T00:00:00+00:00",
      files: { "b.ts": "export const b = 2;\n" },
    });
    // Read before GIT_DIR is set: the fixture helper's own git inherits it.
    const expected = target.head();
    const original = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(hookRepo.dir, ".git");
    try {
      const out = await runGit(target.dir, ["rev-parse", "HEAD"]);
      expect(out.toString("utf8").trim()).toBe(expected);
    } finally {
      if (original === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = original;
    }
  });

  it("does not hand the machine's secrets to git", async () => {
    const repo = repoWithOneCommit();
    process.env.FATHOHM_TEST_SECRET = "sk-should-not-leak";
    try {
      const out = await runGit(repo.dir, ["-c", "alias.dumpenv=!env", "dumpenv"]);
      const env = out.toString("utf8");
      expect(env).toContain("PATH=");
      expect(env).not.toContain("sk-should-not-leak");
    } finally {
      delete process.env.FATHOHM_TEST_SECRET;
    }
  });
});

describe("failures name the command, the expectation, and one next step", () => {
  it("reports a directory that is not a repository as exit 3", async () => {
    const plain = mkdtempSync(path.join(os.tmpdir(), "fathohm-plain-"));

    const failure = await runGit(plain, ["rev-parse", "--git-dir"], {
      expected: "a git repository to read",
      hint: "run `git status` here.",
    }).catch((error: unknown) => error);

    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.exitCode).toBe(EXIT.cannotRead);
    expect(failure.message).toContain("`git rev-parse --git-dir`");
    expect(failure.message).toContain("expected a git repository to read");
    expect(failure.message).toContain("not a git repository");
    expect(failure.hint).toBe("run `git status` here.");
  });

  it("lets the next step depend on what git complained about", async () => {
    // One command can fail for reasons that need different next steps — a
    // flag this git is too old to know is not the same problem as a history
    // it cannot walk — and only git's own words tell them apart.
    const plain = mkdtempSync(path.join(os.tmpdir(), "fathohm-hint-"));
    const seen: string[] = [];

    const failure = await runGit(plain, ["rev-parse", "--git-dir"], {
      hint: (stderr) => {
        seen.push(stderr);
        return stderr.includes("not a git repository")
          ? "start one with `git init`."
          : "something else went wrong.";
      },
    }).catch((error: unknown) => error);

    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.hint).toBe("start one with `git init`.");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("not a git repository");
  });

  it("keeps fathohm's own hermetic flags out of the command it quotes back", async () => {
    const repo = repoWithOneCommit();
    const failure = await runGit(repo.dir, [
      "rev-parse",
      "--verify",
      "no-such-ref",
    ]).catch((error: unknown) => error);

    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.message).toContain("`git rev-parse --verify no-such-ref`");
    expect(failure.message).not.toContain("core.quotePath");
    expect(failure.hint).toContain("git rev-parse --verify no-such-ref");
  });

  it("says git is not installed rather than blaming the repository", async () => {
    const repo = repoWithOneCommit();
    const originalPath = process.env.PATH;
    process.env.PATH = repo.dir; // a directory with no `git` in it
    try {
      const failure = await runGit(repo.dir, ["rev-parse", "HEAD"]).catch(
        (error: unknown) => error,
      );
      expect(isCliError(failure)).toBe(true);
      if (!isCliError(failure)) return;
      expect(failure.exitCode).toBe(EXIT.cannotRead);
      expect(failure.message).toContain("no `git` on PATH");
      expect(failure.message).toContain("`git rev-parse HEAD`");
      expect(failure.hint).toContain("install git");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  // The other ENOENT. Node reports one code for "no binary" and "no working
  // directory", so the branch above and this one are the same errno arriving
  // for opposite reasons — and telling somebody to install a git they already
  // have is the failure mode that actually happens, because a mistyped path is
  // ordinary and a missing git is rare.
  it("blames the missing directory, not git, when the cwd is not there", async () => {
    const repo = repoWithOneCommit();
    const absent = path.join(repo.dir, "no-such-directory");

    const failure = await runGit(absent, ["rev-parse", "HEAD"]).catch(
      (error: unknown) => error,
    );

    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.exitCode).toBe(EXIT.cannotRead);
    expect(failure.message).toContain(absent);
    expect(failure.message).toContain("is not one");
    // The whole point: a working git must not be accused.
    expect(failure.message).not.toContain("no `git` on PATH");
    expect(failure.hint).not.toContain("install git");
  });
});

describe("a cwd that is a file", () => {
  // Node throws ENOTDIR synchronously, outside the callback every other spawn
  // failure arrives through — it used to print "internal failure", exit 4.
  it("is the directory's fault, exit 3, for both runners", async () => {
    const repo = repoWithOneCommit();
    const file = path.join(repo.dir, "src", "a.ts");
    for (const failure of [
      await runGit(file, ["rev-parse", "HEAD"]).catch((error: unknown) => error),
      await streamGit(file, ["log"], { onStdout: () => {} }).catch((error: unknown) => error),
    ]) {
      expect(isCliError(failure)).toBe(true);
      if (!isCliError(failure)) return;
      expect(failure.exitCode).toBe(EXIT.cannotRead);
      expect(failure.message).toContain("is not one");
    }
  });
});

describe("runGitOutcome", () => {
  it("hands back a non-zero status as a value, not a throw", async () => {
    const repo = repoWithOneCommit();
    const outcome = await runGitOutcome(repo.dir, [
      "rev-parse",
      "--verify",
      "--quiet",
      "no-such-ref^{commit}",
    ]);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout.length).toBe(0);
  });

  it("still returns the output printed before the failing argument", async () => {
    // The whole all-in-one probe rests on this: every flag before the ref
    // prints even when the ref at the end resolves to nothing.
    //
    // Note the EMPTY line, and note that it is not filtered out here. `git
    // rev-parse` answers in argument order, so `--show-cdup`'s empty answer —
    // "you are already at the repository root" — occupies a slot, and dropping
    // it would slide the ref's absence into the root's place. That is a real
    // reading of the wrong directory, which is why the blank is asserted.
    const repo = repoWithOneCommit();
    const outcome = await runGitOutcome(repo.dir, [
      "rev-parse",
      "--is-shallow-repository",
      "--is-bare-repository",
      "--git-dir",
      "--show-cdup",
      "--verify",
      "--quiet",
      "no-such-ref^{commit}",
    ]);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout.toString("utf8")).toBe("false\nfalse\n.git\n\n");
  });
});

describe("streamGit", () => {
  it("delivers stdout in order and resolves when git exits clean", async () => {
    const repo = repoWithOneCommit();
    const chunks: Buffer[] = [];
    await streamGit(repo.dir, ["rev-parse", "HEAD"], {
      onStdout: (chunk) => {
        chunks.push(chunk);
      },
    });
    expect(Buffer.concat(chunks).toString("utf8").trim()).toBe(repo.head());
  });

  it("turns a non-zero exit into the exit-3 block", async () => {
    const repo = repoWithOneCommit();
    const failure = await streamGit(
      repo.dir,
      ["log", "no-such-ref"],
      {
        onStdout: () => {},
        expected: "the commit history",
      },
    ).catch((error: unknown) => error);

    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.exitCode).toBe(EXIT.cannotRead);
    expect(failure.message).toContain("`git log no-such-ref`");
    expect(failure.message).toContain("expected the commit history");
  });

  it("propagates a parse failure instead of swallowing it behind git's status", async () => {
    const repo = repoWithOneCommit();
    const boom = new Error("parser said no");
    const failure = await streamGit(repo.dir, ["log", "--pretty=format:%H"], {
      onStdout: () => {
        throw boom;
      },
    }).catch((error: unknown) => error);
    expect(failure).toBe(boom);
  });
});

describe("gitCommandLine", () => {
  it("renders a command the reader can paste", () => {
    expect(gitCommandLine(["ls-tree", "-r", "HEAD"])).toBe(
      "git ls-tree -r HEAD",
    );
  });
});
