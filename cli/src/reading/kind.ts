/**
 * KIND OF USE — the three tiers a file's own NAME declares, and nothing else.
 *
 * BELOW THE LINE names five paths, and the five it named on this repository
 * were a stylesheet, a schema dump, two test files and a seed script. Every one
 * of those numbers is correct and none of them is the file a reader wants to
 * open first: a test that nobody understands is a different sentence from an
 * API route that nobody understands, and the section has four seconds to hand
 * over the second kind.
 *
 * TWO TIERS WERE NOT ENOUGH. A binary demotion put `package.json` into a top
 * five, which is the same failure one rung down — a manifest is not a test, but
 * it is not the parser either. So there are three:
 *
 *   0. APPLICATION CODE. The residual, and the only tier defined by what it is
 *      not. Everything a reader would call "the code".
 *   1. THE SCAFFOLDING a project is assembled from: config, sql and migrations,
 *      scripts, build output. Real files carrying real debt, and never the
 *      first thing anybody opens.
 *   2. TESTS AND STYLES. Furthest back, because both are written ABOUT
 *      something else — "nobody understands this test" is a fact about the test.
 *
 * Rank 2 is checked first, so a test living under `scripts/` is a test. The
 * more demoted reading wins on purpose: the tiers rank how far a file sits from
 * the reader's first question, and a file that answers two of them sits at the
 * further one.
 *
 * This is an ORDERING input and only that. It enters no score, it removes
 * nothing from any count, and it changes no denominator — a demoted file is
 * still below the line, still in the roster, still in the byte share the
 * headline is computed from, and still printed when it reaches the rows. It
 * sorts to the BACK of its group. Exclusion would have been the other fix and
 * it is the wrong one: a repository whose debt really is all tests has a
 * finding, and a filter that hid it would be the card lying by omission.
 *
 * WHY PATH SEGMENTS ARE FAIR HERE, AND NOT IN lib/code-files.ts. That module
 * examines only the FINAL SEGMENT, deliberately: a directory called
 * `generated-reports/` says where a file SITS, not how it was written, and
 * "was this written by hand" is the only question it asks. Kind-of-use is
 * precisely a statement about where a file sits — `scripts/`, `migrations/` and
 * `__tests__/` are conventions whose whole function is to declare what the
 * files under them are for — so a segment rule answers the question actually
 * being asked rather than smuggling in a different one.
 *
 * Pure, deterministic, case-insensitive. Default 0: a path is demoted only when
 * it matches one of the rules below.
 */

/** The three tiers, ascending: 0 sorts first, 2 sorts last. */
export type KindRank = 0 | 1 | 2;

// ── rank 2: written ABOUT the code ─────────────────────────────────────────

/**
 * Segments that declare everything under them written ABOUT the code. Equality,
 * never containment.
 *
 * The five beyond the obvious three are each one language's own convention, and
 * every one of them was found by pointing the card at a repository in that
 * stack: `spec/` is RSpec's whole test tree, `cypress/` is the browser suite,
 * `benches/` is where Cargo keeps benchmarks, `testdata/` is the directory the
 * Go toolchain itself refuses to build, and `examples/` is code written to be
 * read rather than run in production. A reader asking "what does nobody
 * understand here" does not mean the example.
 */
const TEST_SEGMENTS = new Set<string>([
  "__tests__",
  "test",
  "tests",
  "e2e",
  "spec",
  "cypress",
  "benches",
  "examples",
  "testdata",
]);

/** Markers inside the filename itself: the xUnit, Jest, RSpec and Go conventions. */
const TEST_INFIXES = [".test.", ".spec.", "_test."];

/** The `test_foo.py` convention, which puts the marker at the front. */
const TEST_PREFIX = "test_";

/** Test scaffolding by exact filename — pytest's fixture module, which carries
 *  no marker a prefix or an infix could find. */
const TEST_FILENAMES = new Set<string>(["conftest.py"]);

/** Stylesheets, by extension. A `.css` is a declaration of appearance. */
const STYLE_EXTENSIONS = new Set<string>(["css", "scss", "sass", "less", "styl"]);

// ── rank 1: the scaffolding ────────────────────────────────────────────────

/**
 * Segments that declare what sits under them: scripts, migrations, build output.
 *
 * `migrate/` beside `migrations/` because Go and Rust projects spell it the
 * short way, and a schema step is a schema step in either language.
 */
const SCAFFOLD_SEGMENTS = new Set<string>([
  "scripts",
  "migrations",
  "migrate",
  "dist",
  "build",
]);

/**
 * Configuration, by extension.
 *
 * `prisma`, `tf` and `tfvars` are declarations of shape — a schema and an
 * infrastructure plan — rather than the program somebody is trying to
 * understand. They carry real debt, and they are never the first file opened.
 */
const CONFIG_EXTENSIONS = new Set<string>([
  "json",
  "yml",
  "yaml",
  "toml",
  "ini",
  "prisma",
  "tf",
  "tfvars",
]);

/** Schemas and dumps, by extension. */
const SQL_EXTENSIONS = new Set<string>(["sql"]);

/**
 * Configuration by exact filename — the extensionless build conventions, plus
 * the two Ruby manifests and Go's module file, none of which has an extension a
 * rule could reach.
 */
const CONFIG_FILENAMES = new Set<string>([
  "dockerfile",
  "makefile",
  "gemfile",
  "rakefile",
  "go.mod",
]);

/**
 * Configuration by filename STEM: `docker-compose`, `docker-compose.yml`,
 * `docker-compose.prod.yaml`.
 *
 * The stem must end where the name does or at a dot — a bare prefix test would
 * demote `docker-composer.ts`, which is somebody's source file.
 */
const CONFIG_STEMS = ["docker-compose"];

/**
 * Which tier a path's name declares it into.
 *
 * Display ordering only. Nothing here is a score input and nothing here drops a
 * file from a count.
 */
export function kindRank(path: string): KindRank {
  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
  if (segments.length === 0) return 0;

  const name = segments[segments.length - 1];
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";

  for (const segment of segments) {
    if (TEST_SEGMENTS.has(segment)) return 2;
  }
  if (name.startsWith(TEST_PREFIX)) return 2;
  if (TEST_FILENAMES.has(name)) return 2;
  for (const infix of TEST_INFIXES) {
    if (name.includes(infix)) return 2;
  }
  if (STYLE_EXTENSIONS.has(extension)) return 2;

  for (const segment of segments) {
    if (SCAFFOLD_SEGMENTS.has(segment)) return 1;
  }
  if (CONFIG_EXTENSIONS.has(extension) || SQL_EXTENSIONS.has(extension)) return 1;
  if (CONFIG_FILENAMES.has(name)) return 1;
  for (const stem of CONFIG_STEMS) {
    if (name === stem || name.startsWith(`${stem}.`)) return 1;
  }

  return 0;
}

/**
 * THE ORDERING, in one place: tier ascending, then bytes descending, then path.
 *
 * The tie-break on path is load-bearing rather than tidy — it is what makes
 * "row 3" mean the same file twice in a row, and a reading that renumbered
 * itself between two invocations would make an ordinal argument a trap.
 */
export function byDisplayOrder(
  a: { readonly path: string; readonly bytes: number },
  b: { readonly path: string; readonly bytes: number },
): number {
  return (
    kindRank(a.path) - kindRank(b.path) || b.bytes - a.bytes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );
}
