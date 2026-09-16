import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { beforeAll, describe, expect, it } from "vitest";

import { HOSTED_URL } from "../src/render/hosted";
import { CLI_VERSION, SCORER_VERSION, versionLine } from "../src/version";
import { BUNDLE_PATH, DIST_DIR, buildBundle } from "./bundle-build";

/**
 * THE PACKAGING GATE — what `npm publish` would actually put on somebody's
 * machine, asserted before it can.
 *
 * The spec's dependency promise is five separate claims, and each of them is a
 * different way to break trust:
 *
 *   - **one file.** Not a `dist/` of chunks. A single artifact is what makes
 *     "read it yourself" a realistic invitation rather than a gesture.
 *   - **readable.** The invitation is only real if the file can be read. This
 *     one ships unminified, with its comments, because `LICENSE` promises a
 *     reader can "read exactly what is measured" and for five releases that
 *     promise pointed at 24 lines of mangled names.
 *   - **under 300KB packed.** `npx fathohm` downloads this before it prints
 *     anything, and a tool that takes ten seconds to start is a tool people
 *     run once.
 *   - **the shebang, on line one.** `bin` entries are executed directly; a
 *     bundle whose first byte is not `#!` is a package that installs cleanly
 *     and fails at the first invocation.
 *   - **the version string, from the built binary.** Pinned as a literal
 *     because it is a published contract that CI logs and bug reports quote —
 *     and compared against `versionLine()` in the same breath, so the source
 *     and the artifact cannot drift apart while both stay green.
 *
 * And the packed file list, which is the one that catches the accident nobody
 * looks for: a stray file that ships because `files` was widened, or a `.env`
 * that was in the directory when somebody ran `npm pack`.
 */

const REPO_ROOT = process.cwd();
const CLI_DIR = path.join(REPO_ROOT, "cli");

/** The spec's packed ceiling. */
const MAX_BUNDLE_BYTES = 300 * 1024;
/**
 * Exactly what a `fathohm` tarball may contain. `LICENSE` is here on purpose
 * and not only by npm's automatic inclusion: a tool that asks to be audited
 * has to arrive with the terms that make auditing it legal.
 */
const PACKED_FILES = ["LICENSE", "README.md", "dist/fathohm.cjs", "package.json"];

interface Manifest {
  bin: Record<string, string>;
  description: string;
  keywords: string[];
}

/** The published manifest, read from disk — never from an import, so the test
 *  sees exactly the bytes `npm publish` will upload. */
function manifest(): Manifest {
  return JSON.parse(readFileSync(path.join(CLI_DIR, "package.json"), "utf8")) as Manifest;
}

interface PackedFile {
  readonly path: string;
}
interface PackResult {
  readonly name: string;
  readonly version: string;
  readonly files: readonly PackedFile[];
  readonly entryCount: number;
}

describe("the built bundle", () => {
  let bundle = "";
  beforeAll(() => {
    bundle = buildBundle();
  }, 300_000);

  it("is a single file", () => {
    // Not "at least one": a `dist/` that grew a second chunk still runs, and
    // would quietly turn the one-artifact promise into a directory nobody
    // audits.
    expect(readdirSync(DIST_DIR)).toEqual(["fathohm.cjs"]);
  });

  it(`is under ${MAX_BUNDLE_BYTES / 1024}KB packed`, () => {
    // PACKED, as the spec says: the gzipped bytes `npx` downloads. This used to
    // weigh the unpacked file, a proxy ~4x stricter than the promise, and it
    // went red on bug fixes while the download stayed a quarter of the ceiling.
    const bytes = gzipSync(readFileSync(BUNDLE_PATH)).length;
    expect({ bytes }, `the bundle packs to ${bytes} bytes`).toEqual({
      bytes: Math.min(bytes, MAX_BUNDLE_BYTES),
    });
  });

  /**
   * READABLE, NOT MINIFIED — the claim `LICENSE` makes about this very file.
   *
   * The MIT lane exists, in the licence's own words, "so that the claims are
   * checkable: you can read exactly what is measured". Through 1.5.4 the build
   * ran `--minify`, so the artifact carrying that promise was 24 lines of
   * mangled identifiers, and the sentence was false on the one surface that
   * shipped it. The size guard above is exactly the pressure that would put
   * `--minify` back, which is why this sits directly beneath it: the ceiling is
   * 300KB packed and readable packs to ~82KB (~301KB unpacked), so both
   * fit, and the tradeoff is recorded rather than rediscovered.
   *
   * Asserted as a PROPERTY, never a byte count — a reader's greps survive, and
   * the prose explaining the arithmetic ships beside it.
   */
  it("ships readable, with the names and comments a reader would look for", () => {
    // Each of these is what a sceptic reaches for first: the window the whole
    // reading turns on, the function the card re-runs in front of you, and one
    // factor key from the score's decomposition.
    for (const name of ["RECENCY_WINDOW_DAYS", "scoreFromFactors", "human_review_depth"]) {
      expect(bundle, `the bundle no longer contains \`${name}\``).toContain(name);
    }
    const comments = bundle.split("\n").filter((line) => /^\s*(\/\/|\*|\/\*)/.test(line));
    expect(comments.length, "the explanatory comments were stripped").toBeGreaterThan(100);
    // A minified bundle is a handful of enormous lines; a readable one is
    // thousands of short ones. Shape catches a minifier that keeps names.
    expect(bundle.split("\n").length, "the bundle collapsed to few lines").toBeGreaterThan(2000);
  });

  it("opens with the shebang, on the first line", () => {
    expect(bundle.split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  it("is the file `bin` points at", () => {
    expect(path.resolve(CLI_DIR, manifest().bin.fathohm)).toBe(BUNDLE_PATH);
  });
});

/**
 * THE NPM PAGE HEADLINE — the shipped surface nobody edits.
 *
 * `description` is the subtitle on npmjs.com and the one line that shows in
 * npm search results, and it is the only piece of user-facing copy in this
 * repository that lives in a manifest rather than in a renderer or a document.
 * That is precisely why it goes stale: a copy sweep that walks `cli/src` and
 * the READMEs walks straight past it. It has been missed once already (PR #83
 * found three shipped surfaces a hand grep had not), and it then survived the
 * whole of 1.5.0 still describing the CLI as "a git-only reading of
 * comprehension debt" — which is the claim 1.5.0 exists to retract. Git records
 * no reviews, so this tool can only BOUND comprehension debt; the question it
 * closes is whether anybody has been near the code.
 *
 * Asserted as the CLAIM rather than as the sentence, for the reason
 * `tests/seo.test.ts` learned the hard way: a test that pins the wording is how
 * the wording outlives the product.
 */
describe("the npm page headline", () => {
  it("names the question the CLI actually closes", () => {
    const description = manifest().description;
    expect(description).toMatch(/gone dark/i);
    expect(description).toMatch(/\b180 days\b/);
    expect(description).toMatch(/wrote or prompted|written or prompted/i);
  });

  it("never sells the reading as a measurement of comprehension debt", () => {
    // The term belongs in `keywords` — it is the category this is an instrument
    // for, and the search term people arrive on. What it may not do is sit in
    // the description as the thing the CLI READS, because git carries no review
    // record and the closing block of every card says so.
    const description = manifest().description.toLowerCase();
    expect(description).not.toMatch(/reading of comprehension debt/);
    expect(description).not.toMatch(/measures? comprehension debt/);
    expect(manifest().keywords).toContain("comprehension debt");
  });

  it("keeps the two promises that decide whether a stranger runs it", () => {
    expect(manifest().description).toMatch(/never file contents/i);
    expect(manifest().description).toMatch(/no network/i);
  });

  /**
   * A `repository` field is a link npm renders as "Repository", and through
   * 1.5.4 it pointed at a PRIVATE repo — so the npm page advertised MIT beside
   * a door that 404s, which is worse than no door at all for a tool whose
   * pitch is that you can check it yourself.
   *
   * The field is therefore absent until a public repository exists, and this
   * pins the only two states that are honest: absent, or pointing into the
   * `fathohm` org. It is deliberately NOT a test for "some repository exists" —
   * the failure mode is somebody restoring the private URL because npm's own
   * lint suggests filling the field in.
   */
  it("advertises no repository until there is one a stranger can open", () => {
    const repository = (manifest() as { repository?: { url?: string } }).repository;
    if (repository === undefined) return;
    expect(repository.url, "a `repository` URL must be publicly openable").toMatch(
      /^https:\/\/github\.com\/fathohm\//,
    );
  });
});

describe("the built binary runs", () => {
  beforeAll(() => {
    buildBundle();
  }, 300_000);

  it("prints both versions, exactly", () => {
    const printed = execFileSync("node", [BUNDLE_PATH, "--version"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    // The literal is the published contract; the second assertion is what keeps
    // the artifact and the source from drifting while both stay green.
    expect(printed).toBe("fathohm 1.6.3 (scorer v4)\n");
    expect(printed.trim()).toBe(versionLine());
  });

  it("prints usage without a repository, and exits 0", () => {
    const printed = execFileSync("node", [BUNDLE_PATH, "--help"], {
      encoding: "utf8",
      cwd: path.parse(REPO_ROOT).root,
    });
    expect(printed).toContain("npx fathohm [command] [path] [options]");
    expect(printed).toContain("Opens no network connection");
  });
});

describe("the published tarball", () => {
  let packed: PackResult;
  beforeAll(() => {
    buildBundle();
    // `--dry-run` writes no tarball; `--json` is the machine-readable manifest
    // npm itself uses. stderr carries npm's notices and is not parsed.
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: CLI_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // npm 12 changed the shape: through 11 this was `[{…}]`, and it is now an
    // object keyed by package name. Both are read, because the version of npm
    // that runs this is the runner's, not ours — the publish workflow installs
    // `npm@latest` and a major landed under it mid-release, red here and green
    // on every developer machine.
    const parsed = JSON.parse(out) as PackResult[] | Record<string, PackResult>;
    packed = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]) as PackResult;
  }, 300_000);

  it("is `fathohm`, at the version the binary prints", () => {
    expect(packed.name).toBe("fathohm");
    // The manifest's version against the source's, through the one string the
    // binary prints. `v4` was a literal here until 2026-08-11 — a second copy
    // of a constant that has already been bumped four times.
    expect(`fathohm ${packed.version} (scorer ${SCORER_VERSION})`).toBe(versionLine());
  });

  it("contains the bundle, the manifest, the README and the licence — and nothing else", () => {
    expect(packed.files.map((file) => file.path).sort()).toEqual(PACKED_FILES);
    expect(packed.entryCount).toBe(PACKED_FILES.length);
  });

  it("ships the README that documents the honesty model", () => {
    // It is IN the tarball, so it is the npmjs.com page and the first thing an
    // evaluator reads. The claims that decide whether this is installable have
    // to be in it.
    //
    // ASSERTED AS PROPERTIES, NOT AS SENTENCES, and this test is the reason the
    // rule exists. It used to pin five literal strings, one of which was
    // `"scorer v2"` — and it stayed green through v3 and v4 while the npm page
    // told every reader a scorer version two releases stale. A literal answers
    // "did this change?"; it can never answer "is this right?".
    const readme = readFileSync(path.join(CLI_DIR, "README.md"), "utf8");

    // The two versions, from the code rather than from a typist. A README that
    // names a version the binary does not print is the npm page disagreeing
    // with the thing it is selling.
    expect(readme).toContain(`scorer ${SCORER_VERSION}`);
    expect(readme).toContain(CLI_VERSION);

    // The permanent provenance line: git records who DECLARED themselves, so
    // an agent commit with no trailer and no committer signature is read as a
    // human's. It is a caveat that must survive every rewrite of this file.
    expect(readme).toContain("authorship is declared, not detected: undeclared agent work reads as human.");

    // The offline claim, as an experiment the reader can run rather than as an
    // adjective. Some form of "verify" plus some form of "offline/firewall".
    expect(readme).toMatch(/verify[^.]*\b(offline|firewall)\b/i);

    // Where the other half of the reading lives.
    expect(readme).toContain(HOSTED_URL);

    // The word retired from every CLI surface at 1.5.0 and stayed on the hosted
    // ones. The npm page is a CLI surface, and it is the one a previous copy
    // sweep missed.
    expect(readme).not.toMatch(/unfathomed/i);
  });
});
