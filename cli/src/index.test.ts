import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import {
  CLAUDE_TRAILER,
  cleanupFixtureRepos,
  createFixtureRepo,
  type FixtureRepo,
} from "../test-helpers/fixture-repo";
import { COMMANDS } from "./cmd/args";
import { EXIT } from "./cmd/errors";
import { main, type CliIo } from "./index";
import type { MountSelector } from "./interactive";
import { SCORER_VERSION } from "./version";

/** Wrapped card copy, on one line: the renderer breaks at the terminal's width,
 *  so a multi-word assertion has to compare against unwrapped text. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ");
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(argv: string[], io: Partial<CliIo> = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    env: {},
    isTTY: false,
    cwd: "/tmp/fathohm-test",
    ...io,
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

describe("--version", () => {
  it("prints the pinned string and nothing else", async () => {
    const result = await run(["--version"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toBe("fathohm 1.6.2 (scorer v4)\n");
    expect(result.stderr).toBe("");
  });

  it("prints the same string from the short alias", async () => {
    expect((await run(["-V"])).stdout).toBe("fathohm 1.6.2 (scorer v4)\n");
  });
});

describe("--help", () => {
  it("prints the whole command surface at the root", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stderr).toBe("");
    for (const command of COMMANDS) expect(result.stdout).toContain(command);
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  it("prints a command's own usage when the command was named", async () => {
    const named = await run(["check", "--help"]);
    expect(named.code).toBe(EXIT.ok);
    expect(named.stdout).toContain("fathohm check");
    expect(named.stdout).toContain("--max-blind");
    // The root listing is not repeated inside a command's help.
    expect(named.stdout).not.toContain("exit codes");
  });

  it("prints the root help when no command was named", async () => {
    const root = await run(["-h"]);
    expect(root.stdout).toContain("exit codes");
  });
});

describe("usage failures", () => {
  const cases: Array<{ name: string; argv: string[]; stderr: RegExp }> = [
    { name: "unknown flag", argv: ["--nope"], stderr: /^error: unknown flag for `read`: --nope\n/ },
    { name: "unknown flag suggests", argv: ["--asci"], stderr: /hint: did you mean `--ascii`\?/ },
    { name: "unknown command suggests", argv: ["raed"], stderr: /hint: did you mean `fathohm read`\?/ },
    { name: "bad --now", argv: ["--now", "yesterday"], stderr: /error: --now expects an ISO timestamp/ },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} exits 2 with a next step`, async () => {
      const result = await run(testCase.argv);
      expect(result.code).toBe(EXIT.usage);
      expect(result.stderr).toMatch(testCase.stderr);
      // Output discipline: a failure never contaminates stdout, so `--json`
      // consumers see either a reading or nothing at all.
      expect(result.stdout).toBe("");
    });
  }

  it("keeps the stack trace behind --debug", async () => {
    const quiet = await run(["--nope"]);
    const loud = await run(["--nope", "--debug"]);
    expect(quiet.stderr).not.toContain("at ");
    expect(loud.stderr).toContain("at ");
    expect(loud.code).toBe(quiet.code);
  });
});

/**
 * END TO END — a real git repository, through the real binary, to bytes.
 *
 * Everything above this point tests the argument surface; everything in
 * `render/` tests the card against a fixture reading. Neither would notice if
 * `main` never called the scorer, resolved the wrong directory, or read the
 * wall clock instead of `--now`. This does: `git init` in a temp directory,
 * three commits, and then the same call the published `bin` makes.
 */
describe("a reading, end to end", () => {
  afterAll(() => {
    cleanupFixtureRepos();
  });

  const NOW = "2026-07-31T00:00:00Z";

  function repoWithHistory(): FixtureRepo {
    const repo = createFixtureRepo({ prefix: "render" });
    repo.commit({
      message: "the parser",
      date: "2025-09-01T00:00:00Z",
      files: { "src/parse.ts": "export const parse = () => 1;\n" },
    });
    repo.commit({
      message: "the renderer",
      date: "2026-06-20T00:00:00Z",
      files: { "src/render.ts": "export const render = () => 2;\n" },
      coAuthors: [CLAUDE_TRAILER],
    });
    repo.commit({
      message: "the entry (#12)",
      date: "2026-07-20T00:00:00Z",
      files: { "src/index.ts": "export const main = () => 3;\n" },
    });
    return repo;
  }

  it("prints a card for the default command, and exits 0", async () => {
    const repo = repoWithHistory();
    const result = await run(["--now", NOW, "--no-color", "--ascii"], {
      cwd: repo.dir,
      env: { COLUMNS: "80" },
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("FATHOHM");
    expect(result.stdout).toContain("GONE DARK");
    expect(result.stdout).toContain(NOW);
    expect(result.stdout).toContain("TREND");
    expect(flatten(result.stdout)).toContain("authorship is declared, not detected: undeclared agent work reads as human.");
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  it("is byte-identical across runs at the same --now", async () => {
    const repo = repoWithHistory();
    const argv = ["read", repo.dir, "--now", NOW, "--no-color", "--ascii"];
    const first = await run(argv, { env: { COLUMNS: "80" } });
    const second = await run(argv, { env: { COLUMNS: "80" } });
    expect(first.stdout).toBe(second.stdout);
  });

  it("reads a repository named as a positional, from anywhere", async () => {
    const repo = repoWithHistory();
    const result = await run(["read", repo.dir, "--now", NOW, "--no-color", "--ascii"], {
      cwd: "/",
      env: { COLUMNS: "80" },
    });
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain(path.basename(repo.dir));
  });

  it("explains one file, and exits 2 on a path that is not in the tree", async () => {
    const repo = repoWithHistory();
    const ok = await run(["explain", "src/parse.ts", "--now", NOW, "--no-color", "--ascii"], {
      cwd: repo.dir,
      env: { COLUMNS: "80" },
    });
    expect(ok.code).toBe(EXIT.ok);
    expect(ok.stdout).toContain("src/parse.ts");
    expect(ok.stdout).toContain("human review depth");

    const missing = await run(["explain", "src/parse.tsx", "--now", NOW], { cwd: repo.dir });
    expect(missing.code).toBe(EXIT.usage);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("did you mean `src/parse.ts`?");
  });

  it("explains a path relative to where the caller is standing", async () => {
    const repo = createFixtureRepo({ prefix: "explain-cwd" });
    repo.commit({
      message: "two files, one name",
      date: "2026-07-01T00:00:00Z",
      files: { "a.ts": "export const root = 1;\n", "sub/a.ts": "export const sub = 2;\n" },
    });
    const fromSub = await run(["explain", "a.ts", "--now", NOW, "--no-color", "--ascii"], {
      cwd: path.join(repo.dir, "sub"),
      env: { COLUMNS: "80" },
    });
    expect(fromSub.code).toBe(EXIT.ok);
    expect(fromSub.stdout).toContain("sub/a.ts");
  });

  it("prints a filename's control bytes visibly, never raw", async () => {
    // A repository can name a file with a terminal escape in it; printed raw it
    // could recolour, move the cursor, or erase the PARTIAL READING banner.
    const repo = createFixtureRepo({ prefix: "escape" });
    repo.commit({
      message: "hostile name",
      date: "2025-01-01T00:00:00Z",
      files: { "src/a[2Jb.ts": "export const a = 1;\n" },
    });
    const text = await run(["read", "--now", NOW, "--no-color", "--ascii", "--full"], {
      cwd: repo.dir,
      env: { COLUMNS: "80" },
    });
    expect(text.code).toBe(EXIT.ok);
    expect(text.stdout).not.toContain("");
    expect(text.stdout).toContain("a\\x1b[2Jb.ts");

    const json = await run(["read", "--now", NOW, "--json"], { cwd: repo.dir });
    expect(json.stdout).toContain("a\\u001b[2Jb.ts");
  });

  it("explains a row of GONE DARK by its number", async () => {
    const repo = repoWithHistory();
    const argv = ["--now", NOW, "--no-color", "--ascii"];
    const card = await run(["read", ...argv], { cwd: repo.dir, env: { COLUMNS: "80" } });
    // The first path the card's GONE DARK section offers, read off the
    // card itself rather than hard-coded: the ordinal's whole claim is that it
    // resolves what the reader can see.
    const offered = /factor by factor: fathohm explain (\S+)/.exec(card.stdout)?.[1];
    expect(offered).toBeDefined();

    const byNumber = await run(["explain", "1", ...argv], {
      cwd: repo.dir,
      env: { COLUMNS: "80" },
    });
    const byPath = await run(["explain", offered ?? "", ...argv], {
      cwd: repo.dir,
      env: { COLUMNS: "80" },
    });
    expect(byNumber.code).toBe(EXIT.ok);
    expect(byNumber.stdout).toBe(byPath.stdout);

    const past = await run(["explain", "9999", ...argv], { cwd: repo.dir });
    expect(past.code).toBe(EXIT.usage);
    expect(past.stdout).toBe("");
    expect(past.stderr).toContain("dark row");
  });

  it("lists the crossings, honouring --horizon", async () => {
    const repo = repoWithHistory();
    const result = await run(
      ["fade", repo.dir, "--now", NOW, "--horizon", "30d", "--no-color", "--ascii"],
      { env: { COLUMNS: "80" } },
    );
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("crossings within 30 days");
  });

  it("--quiet keeps the headline and the provenance and drops the rest", async () => {
    const repo = repoWithHistory();
    const result = await run(["--now", NOW, "--quiet", "--no-color", "--ascii"], {
      cwd: repo.dir,
      env: { COLUMNS: "80" },
    });
    // The quiet form is the lower-case one-liner, not the block face: it
    // carries both numbers on one line so `$(fathohm --quiet)` stays capturable.
    expect(result.stdout).toContain("gone dark");
    expect(result.stdout).toContain("comprehension debt");
    expect(flatten(result.stdout)).toContain("authorship is declared, not detected: undeclared agent work reads as human.");
    expect(result.stdout).not.toContain("TREND");
  });

  it("--at moves the history AND the clock", async () => {
    const repo = repoWithHistory();
    const first = repo.git(["rev-list", "--max-parents=0", "HEAD"]).trim();
    const result = await run(["read", repo.dir, "--at", first, "--no-color", "--ascii"], {
      env: { COLUMNS: "80" },
    });
    expect(result.code).toBe(EXIT.ok);
    // The ref's own commit date, not today's: a reading of the past has to
    // read as the past read.
    expect(result.stdout).toContain("2025-09-01T00:00:00Z");
    expect(result.stdout).toContain(`read as of ${first}`);
  });

  it("reads a repository with no commits without inventing a percentage", async () => {
    const empty = createFixtureRepo({ prefix: "empty-render" });
    const result = await run(["--now", NOW, "--no-color", "--ascii"], {
      cwd: empty.dir,
      env: { COLUMNS: "80" },
    });
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("nothing to fathom here yet");
    expect(result.stdout).not.toMatch(/%/);
  });

  it("caps the fade table and says where the rest of the crossings are", async () => {
    const repo = createFixtureRepo({ prefix: "many-crossings" });
    for (let index = 0; index < 24; index += 1) {
      repo.commit({
        message: `file ${index}`,
        date: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
        files: { [`src/f${index}.ts`]: `export const f${index} = ${index};\n` },
      });
    }
    const result = await run(["fade", repo.dir, "--now", NOW, "--no-color", "--ascii"], {
      env: { COLUMNS: "80" },
    });
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("more crossings");
    expect(result.stdout).toContain("--json has the full set");
    // 24 sequential `git commit` subprocesses to build the fixture, which is
    // the point of the test — the cap only exists above 20 crossings. That is
    // subprocess time, not scoring time, and it runs past the 5s default
    // whenever the rest of the suite is competing for cores. An explicit
    // budget beats a suite that fails for a reason absent from every diff.
  }, 60_000);

  /**
   * THE PICKER'S GATE, through `main` rather than through the predicate.
   *
   * `selector.test.ts` enumerates the gate as a function; this is the wiring
   * around it — that the flags and the two TTY bits actually arrive, that the
   * rows handed to the picker are the card's, and above all that a run which
   * does not mount is byte-for-byte the run this command has always produced.
   *
   * The mount point is injected because a test runner cannot supply a raw-mode
   * terminal. What it CANNOT cover is stated plainly rather than implied: the
   * keystrokes, the redraw and the terminal restore are exercised by hand.
   */
  describe("the interactive picker", () => {
    interface Mounted {
      readonly rows: ReadonlyArray<{ path: string; body: string }>;
      readonly explained: readonly string[];
    }

    function recorder(): { mounts: Mounted[]; mount: MountSelector } {
      const mounts: Mounted[] = [];
      return {
        mounts,
        mount: (spec) => {
          mounts.push({
            rows: spec.rows.map((row) => ({ path: row.path, body: row.body })),
            // Called here rather than on a keystroke: it is the same closure
            // Enter would run, and this is the only place a test can see it.
            explained: spec.explain(spec.rows[0].path),
          });
          return Promise.resolve();
        },
      };
    }

    const ARGV = ["--now", NOW, "--no-color", "--ascii"];
    const TTY: Partial<CliIo> = { isTTY: true, stdinIsTTY: true, env: { COLUMNS: "80" } };

    it("mounts under the card, with the rows the card printed", async () => {
      const repo = repoWithHistory();
      const { mounts, mount } = recorder();
      const result = await run(ARGV, { ...TTY, cwd: repo.dir, mountSelector: mount });

      expect(result.code).toBe(EXIT.ok);
      expect(mounts.length).toBe(1);
      expect(mounts[0].rows.length).toBeGreaterThan(0);
      for (const row of mounts[0].rows) {
        expect(result.stdout, `not on the card: ${row.body}`).toContain(`  ${row.body}\n`);
      }
      // Enter's closure renders the explain for that row, not a second card.
      expect(mounts[0].explained.join("\n")).toContain(mounts[0].rows[0].path);
      expect(mounts[0].explained.join("\n")).toContain("human review depth");
    });

    it("prints exactly the non-interactive card before the picker sees anything", async () => {
      // The determinism contract, at the seam: mounting must not move a byte
      // of the reading. It is written first, and it is the same bytes.
      const repo = repoWithHistory();
      const { mount } = recorder();
      const interactive = await run(ARGV, { ...TTY, cwd: repo.dir, mountSelector: mount });
      const piped = await run(ARGV, { cwd: repo.dir, env: { COLUMNS: "80" } });
      expect(interactive.stdout).toBe(piped.stdout);
      expect(interactive.code).toBe(piped.code);
    });

    const CLOSED: ReadonlyArray<{ why: string; argv?: string[]; io?: Partial<CliIo> }> = [
      { why: "stdout is redirected", io: { isTTY: false } },
      { why: "stdin is a pipe", io: { stdinIsTTY: false } },
      { why: "--no-interactive", argv: ["--no-interactive"] },
      { why: "--full", argv: ["--full"] },
      { why: "--quiet", argv: ["--quiet"] },
      { why: "--json", argv: ["--json"] },
      { why: "CI is set", io: { env: { COLUMNS: "80", CI: "true" } } },
      { why: "TERM is dumb", io: { env: { COLUMNS: "80", TERM: "dumb" } } },
    ];

    for (const { why, argv, io } of CLOSED) {
      it(`stays out of the way, and prints the same bytes, when ${why}`, async () => {
        const repo = repoWithHistory();
        const { mounts, mount } = recorder();
        const full = [...ARGV, ...(argv ?? [])];
        const gated = await run(full, {
          ...TTY,
          ...io,
          cwd: repo.dir,
          mountSelector: mount,
        });
        expect(mounts).toEqual([]);

        // And the bytes are the ones the same invocation produces with no
        // terminal anywhere near it.
        const piped = await run(full, { cwd: repo.dir, env: { COLUMNS: "80" } });
        expect(gated.stdout).toBe(piped.stdout);
        expect(gated.code).toBe(piped.code);
      });
    }

    for (const command of ["check", "fade", "map", "explain"] as const) {
      it(`never mounts under \`${command}\``, async () => {
        const repo = repoWithHistory();
        const { mounts, mount } = recorder();
        const argv =
          command === "check"
            ? ["check", repo.dir, "--max-blind", "100", ...ARGV]
            : command === "map"
              ? ["map", repo.dir, "--out", path.join(repo.dir, "m.html"), ...ARGV]
              : command === "explain"
                ? ["explain", "1", ...ARGV]
                : ["fade", repo.dir, ...ARGV];
        await run(argv, { ...TTY, cwd: repo.dir, mountSelector: mount });
        expect(mounts).toEqual([]);
      });
    }

    it("never mounts on a reading with nothing below the line", async () => {
      const fresh = createFixtureRepo({ prefix: "picker-empty" });
      const { mounts, mount } = recorder();
      const result = await run(ARGV, { ...TTY, cwd: fresh.dir, mountSelector: mount });
      expect(result.stdout).toContain("nothing to fathom here yet");
      expect(mounts).toEqual([]);
    });
  });
});

/**
 * THE GATE, THE FILE AND THE DOCUMENT — end to end.
 *
 * The three surfaces Task 6 adds are the ones with consequences outside the
 * terminal: an exit code a pipeline branches on, a file written to disk, and a
 * document somebody parses. Each is exercised through `main`, on a real
 * repository, exactly as the published binary would run it.
 */
describe("check, map and --json, end to end", () => {
  afterAll(() => {
    cleanupFixtureRepos();
  });

  const NOW = "2026-07-31T00:00:00Z";

  /** Two files, both long stale: a repository that fails any tight gate. */
  function staleRepo(): FixtureRepo {
    const repo = createFixtureRepo({ prefix: "gate" });
    repo.commit({
      message: "the parser",
      date: "2024-01-01T00:00:00Z",
      files: { "src/parse.ts": "export const parse = () => 1;\n" },
    });
    repo.commit({
      message: "the renderer",
      date: "2024-02-01T00:00:00Z",
      files: { "src/render.ts": "export const render = () => 2;\n" },
    });
    return repo;
  }

  function config(repo: FixtureRepo, contents: string): void {
    writeFileSync(path.join(repo.dir, ".fathohm.toml"), contents, "utf8");
  }

  describe("check", () => {
    it("passes a generous limit with one incontestable sentence", async () => {
      const result = await run(
        ["check", staleRepo().dir, "--max-blind", "100", "--now", NOW, "--no-color", "--ascii"],
        { env: { COLUMNS: "80" } },
      );
      expect(result.code).toBe(EXIT.ok);
      expect(result.stdout).toContain("PASS");
      expect(flatten(result.stdout)).toContain("authorship is declared, not detected: undeclared agent work reads as human.");
    });

    it("fails a tight one, and exits 1", async () => {
      const result = await run(
        ["check", staleRepo().dir, "--max-blind", "0", "--now", NOW, "--no-color", "--ascii"],
        { env: { COLUMNS: "80" } },
      );
      expect(result.code).toBe(EXIT.checkFailed);
      expect(result.stdout).toContain("FAIL");
      // Unwrapped before matching: the sentence is one sentence, and where the
      // terminal broke it is the layout's business, not the verdict's.
      expect(result.stdout.replace(/\s+/g, " ")).toContain("over your limit of 0%");
    });

    it("refuses to invent a limit, and names both places one can live", async () => {
      const result = await run(["check", staleRepo().dir, "--now", NOW]);
      expect(result.code).toBe(EXIT.usage);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("--max-blind");
      expect(result.stderr).toContain(".fathohm.toml");
    });

    it("reads the limit from the config, and lets the flag beat it", async () => {
      const repo = staleRepo();
      config(repo, "max-blind = 0\n");
      expect((await run(["check", repo.dir, "--now", NOW])).code).toBe(EXIT.checkFailed);
      expect((await run(["check", repo.dir, "--max-blind", "100", "--now", NOW])).code).toBe(
        EXIT.ok,
      );
    });

    /**
     * The one exit code that is neither answer. A shallow clone is a fragment,
     * and a pipeline that treated it as a pass would be green on a repository
     * nobody read.
     */
    it("exits 3 on a shallow clone rather than passing or failing", async () => {
      const shallow = staleRepo().shallowClone(1).dir;
      const result = await run(
        ["check", shallow, "--max-blind", "0", "--now", NOW, "--no-color", "--ascii"],
        { env: { COLUMNS: "80" } },
      );
      expect(result.code).toBe(EXIT.cannotRead);
      expect(result.stdout).toContain("PARTIAL READING");
      expect(result.stdout).toContain("NO VERDICT");
      expect(result.stdout).not.toContain("FAIL");
    });

    /**
     * `--format markdown` — a second rendering, never a second gate.
     *
     * The whole risk of a new output form on this command is that it becomes
     * a different verdict: a build that goes green in one format and red in
     * another is worse than a build with no gate on it. So the exit code is
     * asserted to be identical to the text run's, on the same repository and
     * the same limit.
     */
    it("prints the pasteable verdict, with the SAME exit code as the text form", async () => {
      const repo = staleRepo();
      const argv = [repo.dir, "--max-blind", "0", "--now", NOW, "--no-color", "--ascii"];
      const text = await run(["check", ...argv], { env: { COLUMNS: "80" } });
      const markdown = await run(["check", ...argv, "--format", "markdown"], {
        env: { COLUMNS: "80" },
      });

      expect(markdown.code).toBe(text.code);
      expect(markdown.code).toBe(EXIT.checkFailed);
      expect(markdown.stdout).toContain("## fathohm check");
      expect(markdown.stdout).toContain("FAIL");
      // The three things a pasted verdict owes a reader who never ran it: the
      // command that reproduces it, the term's definition, and where the
      // measured version comes from.
      expect(markdown.stdout).toContain("npx fathohm check --max-blind 0");
      expect(markdown.stdout).toContain("measured from the record, not a survey");
      expect(markdown.stdout).toContain("https://fathohm.dev");
    });

    it("refuses --scope, because a gate is a claim about the repository", async () => {
      const result = await run(
        ["check", staleRepo().dir, "--scope", "src", "--max-blind", "40", "--now", NOW],
        { env: { COLUMNS: "80" } },
      );
      expect(result.code).toBe(EXIT.usage);
      expect(result.stderr).toContain("whole repository");
      expect(result.stdout).toBe("");
    });
  });

  /**
   * `--scope <dir>` — a reading of one directory, which is a different subject
   * from the repository and has to say so on every command that offers it.
   */
  describe("--scope", () => {
    /** Two directories, so a scope has something to leave out. */
    function twoCorners(): FixtureRepo {
      const repo = createFixtureRepo({ prefix: "scope" });
      repo.commit({
        message: "the parser",
        date: "2024-01-01T00:00:00Z",
        files: { "src/parse.ts": "export const parse = () => 1;\n" },
      });
      repo.commit({
        message: "the docs site",
        date: "2026-07-20T00:00:00Z",
        files: { "site/page.tsx": "export const Page = () => null;\n" },
      });
      return repo;
    }

    it("reads the subtree, and states the denominator it divided by", async () => {
      const repo = twoCorners();
      const result = await run(
        ["read", repo.dir, "--scope", "src", "--now", NOW, "--no-color", "--ascii"],
        { env: { COLUMNS: "80" } },
      );
      expect(result.code).toBe(EXIT.ok);
      const flat = result.stdout.replace(/\s+/g, " ");
      expect(flat).toContain("Reading: src/ -- 1 file");
      expect(flat).toContain("the repository's own number is different");
      // The subject names the subtree, and the file outside it is nowhere in
      // the reading — not in the ledger, not in the mini-map, not in a count.
      expect(flat).toContain(`${path.basename(repo.dir)}/src`);
      expect(result.stdout).not.toContain("site/page.tsx");
    });

    it("moves the number, because the denominator is the subtree", async () => {
      const repo = twoCorners();
      const argv = [repo.dir, "--json", "--now", NOW];
      const whole = JSON.parse((await run(["read", ...argv])).stdout) as {
        headline: { dark: number; fileCount: number };
      };
      const scoped = JSON.parse(
        (await run(["read", ...argv, "--scope", "src"])).stdout,
      ) as { headline: { dark: number; fileCount: number } };

      expect(whole.headline.fileCount).toBe(2);
      expect(scoped.headline.fileCount).toBe(1);
      // `src/` is the stale corner: alone, it is wholly dark; with the fresh
      // one beside it, it is not.
      expect(scoped.headline.dark).toBeGreaterThan(whole.headline.dark);
    });

    it("refuses a directory with no code in it rather than reading nothing", async () => {
      // The failure mode this closes: a typo'd path produces the honest-looking
      // "nothing to fathom here yet" card, exit 0 — a true sentence about the
      // wrong subject, which reads as good news.
      const result = await run(
        ["read", twoCorners().dir, "--scope", "nowhere", "--now", NOW],
        { env: { COLUMNS: "80" } },
      );
      expect(result.code).toBe(EXIT.usage);
      expect(result.stderr).toContain("no code files under nowhere/");
      expect(result.stdout).toBe("");
    });
  });

  describe("map", () => {
    it("writes one self-contained file and says where it went", async () => {
      const repo = staleRepo();
      const out = path.join(repo.dir, "reading.html");
      const result = await run(
        ["map", repo.dir, "--out", out, "--now", NOW, "--no-color", "--ascii"],
        { env: { COLUMNS: "80" } },
      );
      expect(result.code).toBe(EXIT.ok);
      // The path is never broken across lines, however long it is — a path you
      // cannot copy out of a terminal is a path you cannot open.
      expect(result.stdout).toContain(out);
      expect(result.stdout.replace(/\s+/g, " ")).toContain(`wrote ${out}`);

      const html = readFileSync(out, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("src/parse.ts");
      expect(html.match(/https?:\/\//g) ?? []).toHaveLength(2);
    });

    it("defaults to fathohm-map.html in the working directory", async () => {
      const repo = staleRepo();
      const result = await run(["map", "--now", NOW, "--no-color", "--ascii"], {
        cwd: repo.dir,
        env: { COLUMNS: "80" },
      });
      expect(result.code).toBe(EXIT.ok);
      expect(existsSync(path.join(repo.dir, "fathohm-map.html"))).toBe(true);
    });

    it("overwrites its own output without asking — this runs in CI", async () => {
      const repo = staleRepo();
      const argv = ["map", repo.dir, "--out", path.join(repo.dir, "m.html"), "--now", NOW];
      await run(argv);
      const first = readFileSync(path.join(repo.dir, "m.html"), "utf8");
      await run(argv);
      expect(readFileSync(path.join(repo.dir, "m.html"), "utf8")).toBe(first);
    });

    it("refuses to write inside .git", async () => {
      const repo = staleRepo();
      const result = await run([
        "map",
        repo.dir,
        "--out",
        path.join(repo.dir, ".git", "map.html"),
        "--now",
        NOW,
      ]);
      expect(result.code).toBe(EXIT.usage);
      expect(result.stderr).toContain("refusing to write inside .git");
      expect(existsSync(path.join(repo.dir, ".git", "map.html"))).toBe(false);
    });

    it("names the path when the directory does not exist", async () => {
      const repo = staleRepo();
      const missing = path.join(repo.dir, "nope", "map.html");
      const result = await run(["map", repo.dir, "--out", missing, "--now", NOW]);
      expect(result.code).toBe(EXIT.usage);
      expect(result.stderr).toContain(missing);
    });
  });

  describe("--json", () => {
    it("composes with every command, and parses", async () => {
      const repo = staleRepo();
      const commands: string[][] = [
        ["read", repo.dir],
        ["explain", "src/parse.ts"],
        ["fade", repo.dir],
        ["check", repo.dir, "--max-blind", "100"],
        ["map", repo.dir, "--out", path.join(repo.dir, "j.html")],
      ];
      for (const argv of commands) {
        const result = await run([...argv, "--json", "--now", NOW], { cwd: repo.dir });
        expect(result.code).toBe(EXIT.ok);
        const document = JSON.parse(result.stdout);
        expect(document.fathohm.scorerVersion).toBe(SCORER_VERSION);
        expect(document.now).toBe(NOW.replace("Z", ".000Z"));
        expect(document.provenance.agentShareIsLowerBound).toBe(true);
      }
    });

    it("keeps the exit code the text form would have had", async () => {
      const repo = staleRepo();
      const failed = await run(["check", repo.dir, "--max-blind", "0", "--json", "--now", NOW]);
      expect(failed.code).toBe(EXIT.checkFailed);
      expect(JSON.parse(failed.stdout).verdict.passed).toBe(false);

      const shallow = await run([
        "check",
        repo.shallowClone(1).dir,
        "--max-blind", "0",
        "--json",
        "--now", NOW,
      ]);
      expect(shallow.code).toBe(EXIT.cannotRead);
      expect(JSON.parse(shallow.stdout).verdict.indeterminate).toBe(true);
    });

    it("is byte-identical across runs at the same --now", async () => {
      const repo = staleRepo();
      const argv = ["read", repo.dir, "--json", "--now", NOW];
      expect((await run(argv)).stdout).toBe((await run(argv)).stdout);
    });

    it("carries nothing but the document on stdout, warnings and all", async () => {
      const repo = staleRepo();
      config(repo, "max_blind = 40\n");
      const result = await run(["read", repo.dir, "--json", "--now", NOW]);
      expect(result.code).toBe(EXIT.ok);
      expect(result.stderr).toContain("unknown key");
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });
  });

  describe(".fathohm.toml", () => {
    it("shrinks the reading's denominator by its excludes", async () => {
      const repo = staleRepo();
      const before = JSON.parse(
        (await run(["read", repo.dir, "--json", "--now", NOW])).stdout,
      );
      config(repo, 'exclude = ["src/render.ts"]\n');
      const after = JSON.parse((await run(["read", repo.dir, "--json", "--now", NOW])).stdout);

      expect(after.headline.fileCount).toBe(before.headline.fileCount - 1);
      expect(after.headline.scoredBytes).toBeLessThan(before.headline.scoredBytes);
      expect(after.provenance.excluded.fileCount).toBe(1);
      expect(after.files.some((file: { path: string }) => file.path === "src/render.ts")).toBe(
        false,
      );
    });

    it("takes its horizon, and lets --horizon win", async () => {
      const repo = staleRepo();
      config(repo, 'horizon = "30d"\n');
      const fromFile = await run(["fade", repo.dir, "--now", NOW, "--no-color", "--ascii"], {
        env: { COLUMNS: "80" },
      });
      expect(fromFile.stdout).toContain("crossings within 30 days");

      const fromFlag = await run(
        ["fade", repo.dir, "--horizon", "45d", "--now", NOW, "--no-color", "--ascii"],
        { env: { COLUMNS: "80" } },
      );
      expect(fromFlag.stdout).toContain("crossings within 45 days");
    });

    it("fails with the line quoted back when it is outside the subset", async () => {
      const repo = staleRepo();
      config(repo, "[gate]\nmax-blind = 40\n");
      const result = await run(["read", repo.dir, "--now", NOW]);
      expect(result.code).toBe(EXIT.usage);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(".fathohm.toml:1");
      expect(result.stderr).toContain("no tables");
    });

    /** The config belongs to the repository being read, not to the shell's
     *  working directory — otherwise a gate would depend on where you stood. */
    it("is read from the target repository, not from the caller's directory", async () => {
      const target = staleRepo();
      const elsewhere = staleRepo();
      config(elsewhere, "max-blind = 0\n");
      const result = await run(["check", target.dir, "--now", NOW], { cwd: elsewhere.dir });
      expect(result.code).toBe(EXIT.usage);
      expect(result.stderr).toContain("check needs a limit");
    });
  });
});
