import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ADA,
  CLAUDE_TRAILER,
  GRACE,
  cleanupFixtureRepos,
  createFixtureRepo,
  createMergeHeavyRepo,
  type FixtureRepo,
} from "../test-helpers/fixture-repo";
import { COMMANDS, type Command } from "../src/cmd/args";
import { EXIT } from "../src/cmd/errors";
import { main, type CliIo } from "../src";
import { jsonDocumentSchema, type JsonDocument } from "../src/render/json";

/**
 * THE INTEGRATION SWEEP — the whole command surface, over real repositories,
 * through the real entry point.
 *
 * Every other suite in `cli/` tests one seam: the parser against argv, a
 * renderer against a fixture reading, the scorer against fixture events. Each
 * is sharper than this file at what it covers, and none of them would notice
 * the failures that only exist between them — a command that resolves the
 * wrong directory, a `--json` path that takes a different route to its
 * numbers than the card does, a flag that is parsed and then dropped on the
 * floor, an exit code that is right in a unit test and wrong end to end.
 *
 * So this is deliberately shallow and deliberately wide. It asserts four
 * things, and they are the four properties a person piping this into a
 * pipeline is actually relying on:
 *
 *   1. **Nothing in the matrix crashes.** Every command × text/`--json` ×
 *      unicode/`--ascii`, over three differently-shaped repositories, exits 0.
 *      The merge-heavy fixture is in the matrix on purpose: merges are where
 *      the CLI's file attribution and the hosted product's PR file list have
 *      to agree, and a linear history exercises none of it.
 *
 *   2. **Byte-stability at the composition level.** The same invocation twice
 *      produces the same bytes. The golden files pin the renderers against
 *      fixture data; this pins the whole program against a repository on disk,
 *      which is where a stray `Date.now()`, an unordered `Map` iteration or a
 *      path that leaks the run's temp directory would show up.
 *
 *   3. **The exit-code contract, end to end.** 0/1/2/3 from `check`, each
 *      produced by the situation it is published to mean — including a real
 *      shallow clone for 3, because "a truncated history is indeterminate" is
 *      the promise a green CI run is resting on.
 *
 *   4. **Two invariants that are claims about honesty**, not about code:
 *      `--without` can only ever make a repository read worse (a bus-factor
 *      simulation that removed somebody and improved the number would be
 *      telling teams their key person is a liability), and `--at <ref>` reads
 *      the past exactly as the past read (the retroactivity claim, measured
 *      against the same history built fresh).
 *
 * Local only: no network, no Supabase, no clock. The hosted-parity half of
 * Task 8 lives in `scripts/cli-gallery-parity.ts`, which clones and queries and
 * is therefore an ops script rather than a test.
 */

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One invocation of the published entry point, with every ambient input
 *  pinned: empty env, no TTY, fixed width. Two runs differing would then be
 *  the program's own doing. */
async function run(argv: readonly string[], cwd = "/"): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    env: { COLUMNS: "80" },
    isTTY: false,
    columns: 80,
    cwd,
  };
  const code = await main(argv, io);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

function parseDocument(stdout: string): JsonDocument {
  // Parsed against the EXPORTED schema, not against a shape written here. The
  // schema is the published contract; a test with its own copy of it would go
  // green on a document no consumer could read.
  return jsonDocumentSchema.parse(JSON.parse(stdout));
}

const NOW = "2026-07-31T00:00:00Z";

/** Scratch space for `map --out`. Outside every fixture repository, so no
 *  command in this file ever writes into a repository it is reading. */
const scratch = mkdtempSync(path.join(os.tmpdir(), "fathohm-integration-"));

afterAll(() => {
  cleanupFixtureRepos();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * An ordinary history: one long-stale file, one prompted file, one merged
 * through a pull request, one squash-subject commit. Enough shape that every
 * bucket the card can print has something in it.
 */
function ordinaryRepo(): FixtureRepo {
  const repo = createFixtureRepo({ prefix: "integration-ordinary" });
  repo.commit({
    message: "the parser",
    date: "2024-03-01T00:00:00Z",
    files: { "src/parse.ts": "export const parse = () => 1;\n" },
  });
  repo.commit({
    message: "the renderer",
    date: "2026-05-10T00:00:00Z",
    author: GRACE,
    files: { "src/render.ts": "export const render = () => 2;\n" },
    coAuthors: [CLAUDE_TRAILER],
  });
  repo.createBranch("feature");
  repo.commit({
    message: "the entry",
    date: "2026-06-15T00:00:00Z",
    files: { "src/index.ts": "export const main = () => 3;\n" },
  });
  repo.checkout(repo.defaultBranch);
  repo.merge("feature", { date: "2026-06-16T00:00:00Z", author: GRACE });
  repo.squashSubjectCommit({
    message: "the config",
    pr: 41,
    date: "2026-07-01T00:00:00Z",
    files: { "src/config.ts": "export const config = {};\n" },
  });
  return repo;
}

/** Two files, both years stale, nothing PR-mediated: the ceiling collapses
 *  onto the floor and any tight gate fails. */
function staleRepo(): FixtureRepo {
  const repo = createFixtureRepo({ prefix: "integration-stale" });
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

/**
 * A trunk that took sixteen branches, built in one fast-import pass.
 *
 * Small by the perf gate's standards and large by this file's: what it is here
 * for is SHAPE, not size — every merge in it carries a first-parent diff, which
 * is the path `--diff-merges=first-parent` exists to read and the one an
 * ordinary fixture never touches.
 */
const mergeHeavy = createMergeHeavyRepo({
  pairs: 16,
  files: 12,
  filesPerBranch: 3,
  endDate: "2026-07-10T00:00:00Z",
  spanDays: 420,
});

const ordinary = ordinaryRepo();
const stale = staleRepo();

interface MatrixRepo {
  readonly name: string;
  readonly repo: FixtureRepo;
  /** A path that is in the tree — `explain`'s positional. */
  readonly file: string;
}

const MATRIX: readonly MatrixRepo[] = [
  { name: "ordinary", repo: ordinary, file: "src/parse.ts" },
  { name: "merge-heavy", repo: mergeHeavy, file: "src/pkg0/mod0/unit0.ts" },
  { name: "stale", repo: stale, file: "src/parse.ts" },
];

/**
 * The argv for one cell of the matrix.
 *
 * `check` carries a limit it cannot fail, because this axis is asserting that
 * the command RUNS — the verdict axis is a separate describe below, and a
 * matrix that failed its gate would be measuring two things at once.
 *
 * `explain`'s repository is the working directory (its positional is the
 * file), so it is the one command whose target is not the repo path.
 */
function argvFor(
  command: Command,
  cell: MatrixRepo,
  options: { json: boolean; ascii: boolean; out: string },
): { argv: string[]; cwd: string } {
  const flags = [
    "--now",
    NOW,
    "--no-color",
    ...(options.json ? ["--json"] : []),
    ...(options.ascii ? ["--ascii"] : []),
  ];
  if (command === "explain") {
    return { argv: ["explain", cell.file, ...flags], cwd: cell.repo.dir };
  }
  const target = cell.repo.dir;
  // `offboard`'s positional is the PERSON, and the repository comes second.
  // Ada authored something in all three fixtures, so the matrix exercises a
  // simulation that actually removed somebody rather than the miss path.
  if (command === "offboard") {
    return { argv: ["offboard", ADA.name, target, ...flags], cwd: "/" };
  }
  if (command === "check") {
    return { argv: ["check", target, "--max-blind", "100", ...flags], cwd: "/" };
  }
  if (command === "map") {
    return { argv: ["map", target, "--out", options.out, ...flags], cwd: "/" };
  }
  return { argv: [command, target, ...flags], cwd: "/" };
}

/**
 * WHERE YOU ARE STANDING IS NOT WHAT YOU ARE READING.
 *
 * git resolves to the repository root from any directory inside it, so the
 * history and the tree a reading is built from are ALWAYS the whole
 * repository's — there is no such thing as a reading of a subdirectory here.
 * Anything else derived from the directory the caller happened to be in is
 * therefore a second, quieter subject riding along with the first, and this
 * describe is the two places one got in:
 *
 *   - the header, which named `cli` over a count of the repository's files
 *   - `.fathohm.toml`, looked for beside the caller instead of at the root,
 *     found nowhere, and silently not applied — a CI gate losing its threshold
 *     and its exclusions and going green on neither
 *
 * Asserted through what a caller can see (the printed subject, the file count,
 * the exit code), never by reaching into the resolution itself.
 */
describe("the subject is the repository, not the directory you stood in", () => {
  /** A directory that exists inside every fixture built here. */
  const INSIDE = "src";

  it("labels a reading taken from a subdirectory with the repository", async () => {
    const nested = path.join(ordinary.dir, INSIDE);
    const fromRoot = parseDocument(
      (await run(["read", ".", "--json", "--now", NOW], ordinary.dir)).stdout,
    );
    const fromSub = parseDocument(
      (await run(["read", ".", "--json", "--now", NOW], nested)).stdout,
    );

    expect(fromSub.target).toBe(path.basename(ordinary.dir));
    expect(fromSub.target).toBe(fromRoot.target);
    // The numbers were never the divergence — the label was. Pinning them
    // together is what makes the label a claim about the same reading.
    expect(fromSub.headline).toEqual(fromRoot.headline);

    const card = await run(["read", ".", "--now", NOW, "--no-color", "--ascii"], nested);
    expect(card.code).toBe(EXIT.ok);
    expect(card.stdout).toContain(`git-only reading of ${path.basename(ordinary.dir)}`);
    expect(card.stdout).not.toContain(`reading of ${INSIDE}`);
  });

  it("labels explain the same way, whose repository is the working directory", async () => {
    const document = parseDocument(
      (
        await run(
          ["explain", "src/parse.ts", "--json", "--now", NOW],
          path.join(ordinary.dir, INSIDE),
        )
      ).stdout,
    );
    expect(document.target).toBe(path.basename(ordinary.dir));
    expect(document.file?.path).toBe("src/parse.ts");
  });

  it("applies the root's exclude when the reading is taken from a subdirectory", async () => {
    const repo = staleRepo();
    const nested = path.join(repo.dir, INSIDE);
    const before = parseDocument(
      (await run(["read", ".", "--json", "--now", NOW], nested)).stdout,
    );

    writeFileSync(
      path.join(repo.dir, ".fathohm.toml"),
      'exclude = ["src/render.ts"]\n',
      "utf8",
    );
    const after = parseDocument(
      (await run(["read", ".", "--json", "--now", NOW], nested)).stdout,
    );

    // The observable effect, not the config object: a file left the
    // denominator, and the reading says which and how many.
    expect(after.headline.fileCount).toBe(before.headline.fileCount - 1);
    expect(after.provenance.excluded.fileCount).toBe(1);
    expect(after.files?.some((file) => file.path === "src/render.ts")).toBe(false);
  });

  it("gates on the root's max-blind from a subdirectory rather than demanding one", async () => {
    // The half of this that ships broken code: `check` in CI, run from a
    // package directory. Without the root's file it has no threshold at all
    // and exits 2 asking for one — and a pipeline that treats anything but 1
    // as passing has just lost its gate.
    const repo = staleRepo();
    const nested = path.join(repo.dir, INSIDE);
    writeFileSync(path.join(repo.dir, ".fathohm.toml"), "max-blind = 0\n", "utf8");

    const result = await run(["check", ".", "--now", NOW], nested);
    expect(result.code).toBe(EXIT.checkFailed);
    expect(result.stderr).toBe("");
  });
});

describe("the command matrix", () => {
  for (const cell of MATRIX) {
    for (const command of COMMANDS) {
      for (const json of [false, true]) {
        for (const ascii of [false, true]) {
          const label =
            `${command} · ${cell.name} · ${json ? "--json" : "text"}` +
            `${ascii ? " · --ascii" : ""}`;

          it(`runs and is byte-stable: ${label}`, async () => {
            const out = path.join(
              scratch,
              `${cell.name}-${command}-${json ? "json" : "text"}-${ascii ? "ascii" : "unicode"}.html`,
            );
            const { argv, cwd } = argvFor(command, cell, { json, ascii, out });

            const first = await run(argv, cwd);
            expect(first.stderr).toBe("");
            expect(first.code).toBe(EXIT.ok);
            expect(first.stdout.endsWith("\n")).toBe(true);

            // Determinism at the CLI composition level: (repo state, --now,
            // flags) → the same bytes. Not "the same numbers" — the same bytes.
            const second = await run(argv, cwd);
            expect(second.stdout).toBe(first.stdout);
            expect(second.code).toBe(first.code);

            if (json) {
              const document = parseDocument(first.stdout);
              expect(document.command).toBe(command === "map" ? "map" : command);
              expect(document.now).toBe(new Date(NOW).toISOString());
              expect(document.fathohm.scorerVersion).toBe("v4");
              // The headline travels with EVERY command — the property that
              // makes `check --json` and `read --json` interchangeable inputs
              // to one dashboard.
              expect(document.headline.ceiling).toBeLessThanOrEqual(
                document.headline.floor + 1e-9,
              );
            } else if (ascii) {
              // The ascii fold is not decoration: a CI log that mangles a glyph
              // is a reading nobody trusts. Nothing above 0x7f survives —
              // asserted here as a property of the WHOLE card, because the
              // glyph table is only one of the places a dash or a bullet can
              // get into the output.
              expect(first.stdout).toMatch(/^[\x00-\x7f]*$/);
            }
          });
        }
      }
    }
  }
});

/**
 * `--without` — the bus-factor simulation, and the one direction it is allowed
 * to move.
 *
 * Removing a person can only ever remove engagement: their commits, their
 * reviews, their recency, their share of the bus factor. Every factor that
 * feeds a score is therefore weakly decreasing, the denominator (the tree) does
 * not move at all, and the floor blind share can only rise. If it ever fell,
 * `fathohm read --without alice` would be answering "what happens when Alice
 * leaves?" with "things improve" — which is not a rounding error, it is the
 * feature inverted.
 */
describe("--without is monotonic", () => {
  const cells = MATRIX.filter((cell) => cell.name !== "stale");

  for (const cell of cells) {
    for (const who of [ADA.name, GRACE.name, ADA.email]) {
      it(`never lowers the floor blind share: ${cell.name} without ${who}`, async () => {
        const base = parseDocument(
          (await run(["read", cell.repo.dir, "--json", "--now", NOW])).stdout,
        );
        const without = parseDocument(
          (await run(["read", cell.repo.dir, "--json", "--now", NOW, "--without", who]))
            .stdout,
        );

        expect(without.headline.scoredBytes).toBe(base.headline.scoredBytes);
        expect(without.headline.floor).toBeGreaterThanOrEqual(
          base.headline.floor - 1e-9,
        );
        expect(without.headline.floorBlindBytes).toBeGreaterThanOrEqual(
          base.headline.floorBlindBytes,
        );
      });
    }
  }

  it("composes: removing both people is at least as bad as removing one", async () => {
    const one = parseDocument(
      (await run(["read", ordinary.dir, "--json", "--now", NOW, "--without", ADA.name]))
        .stdout,
    );
    const both = parseDocument(
      (
        await run([
          "read",
          ordinary.dir,
          "--json",
          "--now",
          NOW,
          "--without",
          ADA.name,
          "--without",
          GRACE.name,
        ])
      ).stdout,
    );
    expect(both.headline.floor).toBeGreaterThanOrEqual(one.headline.floor - 1e-9);
  });
});

/**
 * THE EXIT-CODE CONTRACT, end to end.
 *
 * These four numbers are the published interface: a pipeline branches on them,
 * and by the time somebody notices they are wrong they have already shipped
 * green on a repository nobody read. Each is produced here by the situation it
 * is documented to mean, through `main`, on a real repository.
 */
describe("check exit codes", () => {
  it("0 — the reading is inside the limit", async () => {
    const result = await run(["check", stale.dir, "--max-blind", "100", "--now", NOW]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("PASS");
  });

  it("1 — the reading is outside it", async () => {
    const result = await run(["check", stale.dir, "--max-blind", "0", "--now", NOW]);
    expect(result.code).toBe(EXIT.checkFailed);
    expect(result.stdout).toContain("FAIL");
  });

  it("2 — no limit was given, by flag or by file", async () => {
    const result = await run(["check", stale.dir, "--now", NOW]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("check needs a limit");
  });

  it("3 — a shallow clone is neither a pass nor a failure", async () => {
    // A REAL truncated history: cloned at depth 1 through a `file://` URL,
    // because a local path clone silently ignores `--depth`.
    const shallow = stale.shallowClone(1);
    const result = await run([
      "check",
      shallow.dir,
      "--max-blind",
      "100",
      "--now",
      NOW,
    ]);
    expect(result.code).toBe(EXIT.cannotRead);
  });

  it("the exit code is identical in --json and in text", async () => {
    for (const limit of ["100", "0"]) {
      const text = await run(["check", stale.dir, "--max-blind", limit, "--now", NOW]);
      const json = await run([
        "check",
        stale.dir,
        "--max-blind",
        limit,
        "--now",
        NOW,
        "--json",
      ]);
      expect(json.code).toBe(text.code);
      expect(parseDocument(json.stdout).verdict?.passed).toBe(limit === "100");
    }
  });
});

/**
 * `--at <ref>` — the retroactivity claim, measured.
 *
 * "Improve the scorer and all of history re-values" only means anything if a
 * reading of the past is the reading the past would have got. So the same
 * history is built twice: once as a repository that went on to have more
 * commits and carries a tag at the halfway point, and once as a repository that
 * stopped there. Reading the first `--at` the tag must equal reading the second
 * as it stands — same numbers, same files, same clock. Anything the later
 * commits leaked into the earlier reading (a tree entry, an author, a date)
 * would show up as a difference.
 */
describe("--at reads the past as the past read", () => {
  const TAG = "milestone";
  const HALFWAY = "2026-04-02T00:00:00Z";

  /** The shared prefix, applied identically to both repositories. */
  function firstHalf(repo: FixtureRepo): void {
    repo.commit({
      message: "the parser",
      date: "2025-11-01T00:00:00Z",
      files: { "src/parse.ts": "export const parse = () => 1;\n" },
    });
    repo.commit({
      message: "the renderer",
      date: "2026-02-01T00:00:00Z",
      author: GRACE,
      files: { "src/render.ts": "export const render = () => 2;\n" },
      coAuthors: [CLAUDE_TRAILER],
    });
    repo.commit({
      message: "the entry (#7)",
      date: HALFWAY,
      files: { "src/index.ts": "export const main = () => 3;\n" },
    });
  }

  it("equals the same history built fresh, headline and files", async () => {
    const grew = createFixtureRepo({ prefix: "integration-at-grew" });
    firstHalf(grew);
    grew.tag(TAG);
    // Everything after the tag: new files, a new author, a merge. None of it
    // may reach a reading taken at the tag.
    grew.commit({
      message: "the cache",
      date: "2026-06-01T00:00:00Z",
      author: GRACE,
      files: { "src/cache.ts": "export const cache = new Map();\n" },
    });
    grew.commit({
      message: "the parser, again",
      date: "2026-07-20T00:00:00Z",
      files: { "src/parse.ts": "export const parse = () => 42;\n" },
    });

    const stopped = createFixtureRepo({ prefix: "integration-at-stopped" });
    firstHalf(stopped);

    const past = parseDocument(
      (await run(["read", grew.dir, "--at", TAG, "--json", "--no-color"])).stdout,
    );
    const fresh = parseDocument(
      (await run(["read", stopped.dir, "--json", "--no-color", "--now", HALFWAY]))
        .stdout,
    );

    // The clock moved with the history: `--at` took the ref's own commit date,
    // which is the instant the fresh repository was read at.
    expect(past.now).toBe(new Date(HALFWAY).toISOString());
    expect(past.now).toBe(fresh.now);
    expect(past.headline).toEqual(fresh.headline);
    expect(past.files).toEqual(fresh.files);
    // The later commits are gone from the tree, not merely scored away.
    expect(past.files?.map((file) => file.path)).toEqual([
      "src/index.ts",
      "src/parse.ts",
      "src/render.ts",
    ]);
  });

  it("names the ref it read, in the document and on the card", async () => {
    const repo = createFixtureRepo({ prefix: "integration-at-ref" });
    firstHalf(repo);
    repo.tag(TAG);
    const document = parseDocument(
      (await run(["read", repo.dir, "--at", TAG, "--json"])).stdout,
    );
    expect(document.provenance.atRef).toBe(TAG);

    const card = await run(["read", repo.dir, "--at", TAG, "--no-color", "--ascii"]);
    expect(card.code).toBe(EXIT.ok);
    expect(card.stdout).toContain(`read as of ${TAG}`);
  });
});

/**
 * The three commands whose `--json` carries a section of its own. The matrix
 * above proves they run and validate; this proves the section they exist for is
 * actually in the document, on every repository shape.
 */
describe("explain, fade and map carry their own section", () => {
  for (const cell of MATRIX) {
    it(`${cell.name}`, async () => {
      const explain = parseDocument(
        (await run(["explain", cell.file, "--json", "--now", NOW], cell.repo.dir)).stdout,
      );
      expect(explain.file?.path).toBe(cell.file);
      expect(explain.file?.factors.engagement).toBeDefined();

      const fade = parseDocument(
        (await run(["fade", cell.repo.dir, "--json", "--now", NOW])).stdout,
      );
      expect(fade.crossings?.horizonDays).toBe(90);
      for (const crossing of fade.crossings?.files ?? []) {
        expect(crossing.fadesAt).not.toBe("");
      }

      const out = path.join(scratch, `${cell.name}-section.html`);
      // Standing in `scratch` rather than at `run`'s default `/`, so the caller
      // and the file share a volume. On Windows they would not: `/` resolves to
      // the root of the CURRENT drive (the workspace, on D:) while the temp
      // directory is on C:, and there is no relative path between two drives —
      // `path.relative` correctly answers with an absolute one. That is a real
      // case, documented on `relativeMapTarget`, and not the one this assertion
      // is about.
      const map = parseDocument(
        (await run(["map", cell.repo.dir, "--out", out, "--json", "--now", NOW], scratch)).stdout,
      );
      // Relative to where the caller stood, and resolving back to the file that
      // was written — the round trip a consumer performs. The document travels;
      // an absolute path in it would name the machine that produced it rather
      // than the repository it is about.
      expect(path.isAbsolute(map.map?.out ?? "/")).toBe(false);
      expect(path.resolve(scratch, map.map?.out ?? "")).toBe(out);
      // `map --json` computes the tide as well as the tree; a document missing
      // it would mean the strip and the page disagreed about what was computed.
      expect(map.tide?.today.at).toBeDefined();
    });
  }
});
