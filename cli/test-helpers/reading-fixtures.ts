import { mapEvents, type CliEvent } from "../src/repo/events";
import type { CommitRecord, Provenance, RepoExtract } from "../src/repo/extract";
import { offboardReading, type OffboardReading } from "../src/reading/offboard";
import { paydownReading, type PaydownReading } from "../src/reading/paydown";
import { readingEvents, scoreRepo, type RepoReading } from "../src/reading/scoring";
import { teamReading, type TeamReading } from "../src/reading/team";
import { tideSeries, type TideSeries } from "../src/reading/tide";
import { ADA, CLAUDE_TRAILER, GRACE, type Identity } from "./fixture-repo";

/**
 * Readings shaped like the live ones, built as DATA.
 *
 * The extraction fixtures elsewhere in this suite build real git repositories,
 * because extraction's whole job is to be right about git. The renderers have
 * the opposite requirement: a card is a pure function of a reading, and a
 * golden file that depended on a temp directory, a git version and a clock
 * would fail for reasons that have nothing to do with what it is pinning.
 *
 * So these are commit records written directly, run through the same
 * `mapEvents` → `deriveFactors` → `scoreFromFactors` path a real repository
 * takes. The numbers in the goldens are therefore the scorer's, not the
 * fixture's — if the scorer moves, they move, which is exactly what a golden
 * file is for.
 *
 * The four shapes mirror readings that actually exist:
 *   - `mixed` — fathohm: most of it faded, a working corner still fresh.
 *   - `promptedDominant` — job-ai: agent-written, three small files hand-touched.
 *   - `promptedOnly` — everything prompted, nothing PR-mediated: no spread.
 *   - `empty` — a repository with no commits at all.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant every golden file is pinned to. */
export const FIXTURE_NOW = new Date("2026-07-31T00:00:00Z");

export interface CommitFixture {
  daysAgo: number;
  paths: string[];
  author?: Identity;
  /** A `Co-Authored-By: Claude …` trailer — the prompted (`mixed`) shape. */
  prompted?: boolean;
  /** Two parents: an approval, weightless, PR-mediating. */
  merge?: boolean;
  /** GitHub's squash convention: one parent, subject ending `(#N)`. */
  squashPr?: number;
}

export interface ExtractFixture {
  tree: ReadonlyArray<readonly [path: string, bytes: number]>;
  commits: readonly CommitFixture[];
  provenance?: Partial<Provenance>;
}

/**
 * `exclude` is applied HERE, because that is where production applies it.
 *
 * Events are built as the history streams past, from a config read before the
 * walk — so by the time anything is scored, an excluded path is already gone
 * from every event. A fixture that filtered later would be exercising a path
 * the CLI no longer has.
 */
export function buildExtract(
  fixture: ExtractFixture,
  now: Date = FIXTURE_NOW,
  exclude: readonly string[] = [],
): RepoExtract<CliEvent> {
  // Newest first, the order `git log` hands them over in.
  const ordered = [...fixture.commits].sort((a, b) => a.daysAgo - b.daysAgo);
  const commits = ordered.map((commit, index) => toRecord(commit, index, now));
  return {
    tip: commits[0] ?? null,
    history: mapEvents(commits, exclude),
    tree: fixture.tree.map(([path, bytes]) => ({ path, bytes })),
    provenance: {
      shallow: false,
      grafted: false,
      emptyRepo: fixture.commits.length === 0,
      sinceBound: null,
      atRef: null,
      submodulesSkipped: 0,
      ...fixture.provenance,
    },
    // A fixture has no directory on disk. The name is what a renderer would put
    // in a header, and it is stable so a golden can pin it.
    root: "/fixture/repo",
  };
}

function toRecord(commit: CommitFixture, index: number, now: Date): CommitRecord {
  const author = commit.author ?? ADA;
  const subject =
    commit.squashPr === undefined
      ? `change ${index}`
      : `change ${index} (#${commit.squashPr})`;
  return {
    sha: `${index}`.padStart(40, "0"),
    parentCount: commit.merge === true ? 2 : 1,
    authorName: author.name,
    authorEmail: author.email,
    authoredAt: new Date(now.getTime() - commit.daysAgo * DAY_MS).toISOString(),
    subject,
    body: commit.prompted === true ? `Co-Authored-By: ${CLAUDE_TRAILER}` : "",
    committerName: author.name,
    committerEmail: author.email,
    paths: commit.paths,
  };
}

export interface FixtureReading {
  extract: RepoExtract<CliEvent>;
  reading: RepoReading;
  tide: TideSeries;
}

/** The same composition `index.ts` performs, so a golden pins what ships. */
export function readingOf(
  fixture: ExtractFixture,
  options: {
    now?: Date;
    without?: readonly string[];
    exclude?: readonly string[];
    /** `--scope <dir>`: the subtree reading, composed as `index.ts` composes it
     *  — the same string reaches the scorer AND the tide, because a strip drawn
     *  over the repository under a card about one directory is two readings. */
    scope?: string | null;
  } = {},
): FixtureReading {
  const now = options.now ?? FIXTURE_NOW;
  const without = options.without ?? [];
  const exclude = options.exclude ?? [];
  const scope = options.scope ?? null;
  const extract = buildExtract(fixture, now, exclude);
  return {
    extract,
    reading: scoreRepo(extract, { now, without, exclude, scope }),
    tide: tideSeries(readingEvents(extract, without).events, extract.tree, {
      now,
      exclude,
      scope,
    }),
  };
}

/**
 * The offboard fixture's people.
 *
 * Three humans and one agent, because that is the shape the two new cards are
 * about: `PRIYA` is the only name on a corner of the billing code, `SAM` and
 * `MARCO` share the rest of it, and `AGENT` commits under its own identity —
 * which is what makes its files "no human", as against a `Co-Authored-By`
 * trailer, which is a human being prompted and counts as a quarter of one.
 */
const PRIYA: Identity = { name: "priya", email: "priya@acme.dev" };
const SAM: Identity = { name: "sam", email: "sam@acme.dev" };
const MARCO: Identity = { name: "marco", email: "marco@acme.dev" };
const AGENT: Identity = { name: "Claude", email: "noreply@anthropic.com" };

/**
 * acme-api's shape: three people, an agent, and a billing corner with one name
 * on it.
 *
 * Built to exercise every clause the handover lexicon has, and each file is a
 * different arrangement of the same two factors rather than a different size:
 *
 *   - `invoice`, `proration`, `tax-id` — priya alone and recent. Without her
 *     they have no human in their history at all.
 *   - `webhooks/route` — priya three weeks ago, sam seven months ago. Removing
 *     her does not empty the file, it moves its newest human contact back.
 *   - `tax/rates`, `jobs/retry` — priya is the OLDER of two names, so the
 *     contact date does not move; what moves is the bus factor.
 *   - `search/index`, `scripts/seed` — sam's and marco's own corners, so the
 *     leave column has something to say about each of them.
 *   - `ui/*`, `workers/queue` — committed by the agent under its own identity:
 *     no human name at all, and the largest row on the keeper table.
 */
export const HANDOVER: ExtractFixture = {
  tree: [
    ["lib/billing/invoice.ts", 18000],
    ["lib/billing/proration.ts", 12000],
    ["lib/billing/tax-id.ts", 3000],
    ["app/api/webhooks/route.ts", 9000],
    ["lib/tax/rates.ts", 7000],
    ["app/jobs/retry.ts", 6000],
    ["lib/search/index.ts", 15000],
    ["app/ui/Board.tsx", 24000],
    ["app/ui/Table.tsx", 21000],
    ["workers/queue.ts", 11000],
    ["scripts/seed.ts", 4000],
    ["package.json", 800],
  ],
  commits: [
    { daysAgo: 400, paths: ["package.json"], author: SAM },
    { daysAgo: 380, paths: ["package.json"], author: PRIYA },
    { daysAgo: 200, paths: ["app/api/webhooks/route.ts"], author: SAM },
    { daysAgo: 150, paths: ["lib/tax/rates.ts", "app/jobs/retry.ts"], author: PRIYA },
    { daysAgo: 130, paths: ["app/ui/Board.tsx", "app/ui/Table.tsx"], author: AGENT },
    // A real two-parent merge, so the ceiling rests on the commit graph rather
    // than on a naming convention. It adds nobody to the UI files' history: an
    // approval with zero comments is weightless, which is exactly why those two
    // stay in the `no human` row while gaining a review record they could have.
    {
      daysAgo: 129,
      paths: ["app/ui/Board.tsx", "app/ui/Table.tsx"],
      author: SAM,
      merge: true,
    },
    { daysAgo: 110, paths: ["app/jobs/retry.ts"], author: MARCO },
    { daysAgo: 100, paths: ["lib/tax/rates.ts"], author: SAM },
    { daysAgo: 60, paths: ["workers/queue.ts"], author: AGENT },
    { daysAgo: 40, paths: ["scripts/seed.ts"], author: MARCO },
    { daysAgo: 30, paths: ["lib/search/index.ts"], author: SAM, squashPr: 88 },
    { daysAgo: 25, paths: ["lib/billing/proration.ts"], author: PRIYA },
    { daysAgo: 22, paths: ["lib/billing/tax-id.ts"], author: PRIYA },
    // Squash subjects rather than merges: a squash is an ordinary single-parent
    // commit, so it makes these files PR-mediated (the ceiling may credit them)
    // without adding a weightless approval that would change who counts as a
    // human in their history.
    {
      daysAgo: 20,
      paths: ["lib/billing/invoice.ts", "app/api/webhooks/route.ts"],
      author: PRIYA,
      squashPr: 91,
    },
  ],
};

/**
 * Long names, long paths, four figures of files: the widest every card has to
 * fit into eighty columns.
 *
 * Real repositories are not called `acme-api` and real people are not called
 * `sam`. The keeper table is the surface where that bites — a name column, a
 * bar, a share and a clause on one row — so this is the fixture the width
 * promise is actually tested against. ASCII throughout, because `--ascii` is a
 * promise about the byte set and a fixture that broke it would be testing the
 * fold rather than the layout.
 */
export const LONG_NAMES: ExtractFixture = {
  tree: [
    ["packages/platform/services/billing/reconciliation-engine.ts", 40000],
    ["packages/platform/services/billing/ledger-projections.ts", 12000],
    ["packages/platform/generated/openapi-client.ts", 30000],
    ["packages/platform/services/search/query-planner.ts", 9000],
  ],
  commits: [
    {
      daysAgo: 20,
      paths: [
        "packages/platform/services/billing/reconciliation-engine.ts",
        "packages/platform/services/billing/ledger-projections.ts",
      ],
      author: {
        name: "Konstantin Vasilevsky-Andersson",
        email: "konstantin.vasilevsky@enterprise-platform.example",
      },
    },
    {
      daysAgo: 45,
      paths: ["packages/platform/services/search/query-planner.ts"],
      author: {
        name: "Marguerite Oyelaran-Fitzgerald",
        email: "marguerite.oyelaran@enterprise-platform.example",
      },
    },
    {
      daysAgo: 70,
      paths: ["packages/platform/generated/openapi-client.ts"],
      author: AGENT,
    },
  ],
};

/** Every commit the agent's own, so the keeper table has one row and the leave
 *  section has nothing at all to remove. */
export const AGENT_ONLY: ExtractFixture = {
  tree: [
    ["src/router.ts", 12000],
    ["src/handlers.ts", 8000],
    ["src/db.ts", 5000],
  ],
  commits: [
    { daysAgo: 90, paths: ["src/router.ts", "src/db.ts"], author: AGENT },
    { daysAgo: 20, paths: ["src/handlers.ts"], author: AGENT },
  ],
};

export interface FixtureOptions {
  readonly now?: Date;
  readonly without?: readonly string[];
  readonly exclude?: readonly string[];
  readonly scope?: string | null;
  readonly full?: boolean;
}

/** The offboard simulation, composed exactly as `index.ts` composes it. */
export function offboardOf(
  fixture: ExtractFixture,
  query: string,
  options: FixtureOptions = {},
): OffboardReading {
  const { extract, opts } = scored(fixture, options);
  return offboardReading(extract, opts, query, scoreRepo(extract, opts));
}

/** The ladder, composed exactly as `index.ts` composes it. */
export function paydownOf(
  fixture: ExtractFixture,
  options: FixtureOptions & {
    readonly maxBlind?: number | null;
    readonly pessimistic?: boolean;
  } = {},
): PaydownReading {
  const { extract, opts } = scored(fixture, options);
  return paydownReading(scoreRepo(extract, opts), {
    maxBlind: options.maxBlind ?? null,
    pessimistic: options.pessimistic ?? false,
  });
}

/** The roster, composed exactly as `index.ts` composes it. */
export function teamOf(fixture: ExtractFixture, options: FixtureOptions = {}): TeamReading {
  const { extract, opts } = scored(fixture, options);
  return teamReading(extract, opts, scoreRepo(extract, opts), {
    full: options.full ?? false,
  });
}

function scored(fixture: ExtractFixture, options: FixtureOptions) {
  const now = options.now ?? FIXTURE_NOW;
  const extract = buildExtract(fixture, now);
  return {
    extract,
    opts: {
      now,
      without: options.without ?? [],
      exclude: options.exclude ?? [],
      scope: options.scope ?? null,
    },
  };
}

/**
 * fathohm's shape: a long-settled majority, a corner two people worked in
 * this month, and enough pull-request mediation for the interval to be wide.
 */
export const MIXED: ExtractFixture = {
  tree: [
    ["app/page.tsx", 18000],
    ["app/layout.tsx", 4200],
    ["app/api/route.ts", 2600],
    ["components/Map.tsx", 22000],
    ["components/Wordmark.tsx", 1800],
    ["lib/palette.ts", 6400],
    ["lib/map-tree.ts", 9100],
    ["lib/scoring-notes.ts", 3400],
    ["workers/src/scorer.ts", 12800],
    ["workers/src/index.ts", 7300],
    ["cli/src/index.ts", 5200],
    ["README.md", 3000],
    ["package.json", 900],
  ],
  commits: [
    {
      daysAgo: 400,
      paths: [
        "app/page.tsx",
        "app/layout.tsx",
        "components/Map.tsx",
        "lib/palette.ts",
        "lib/map-tree.ts",
        "README.md",
        "package.json",
      ],
    },
    { daysAgo: 300, paths: ["components/Map.tsx"] },
    { daysAgo: 220, paths: ["lib/map-tree.ts", "lib/palette.ts"], author: GRACE },
    { daysAgo: 150, paths: ["app/page.tsx"], prompted: true },
    { daysAgo: 120, paths: ["app/page.tsx", "components/Map.tsx"], merge: true },
    { daysAgo: 95, paths: ["components/Wordmark.tsx"], prompted: true },
    { daysAgo: 60, paths: ["app/api/route.ts"], squashPr: 7 },
    { daysAgo: 55, paths: ["lib/scoring-notes.ts"], author: GRACE },
    { daysAgo: 40, paths: ["workers/src/scorer.ts", "workers/src/index.ts"] },
    { daysAgo: 30, paths: ["cli/src/index.ts"], prompted: true, squashPr: 42 },
    { daysAgo: 12, paths: ["workers/src/scorer.ts"], author: GRACE },
    { daysAgo: 5, paths: ["README.md"], prompted: true },
  ],
};

/**
 * job-ai's shape: agent-written throughout, three small files hand-touched
 * inside the window. The reading the founder had to ask an assistant about.
 */
export const PROMPTED_DOMINANT: ExtractFixture = {
  tree: [
    ["src/agents/router.ts", 24000],
    ["src/agents/planner.ts", 19000],
    ["src/api/jobs.ts", 15000],
    ["src/api/auth.ts", 8000],
    ["src/lib/db.ts", 11000],
    ["src/lib/queue.ts", 9000],
    ["src/lib/env.ts", 300],
    ["src/ui/App.tsx", 21000],
    ["src/ui/Board.tsx", 17000],
    ["src/config.ts", 250],
    ["scripts/seed.ts", 400],
    ["README.md", 2000],
  ],
  commits: [
    { daysAgo: 300, paths: ["README.md"], prompted: true },
    { daysAgo: 240, paths: ["src/lib/queue.ts"], prompted: true },
    { daysAgo: 200, paths: ["src/lib/db.ts"], prompted: true },
    { daysAgo: 120, paths: ["src/api/auth.ts"], prompted: true },
    { daysAgo: 90, paths: ["src/ui/App.tsx"], prompted: true },
    { daysAgo: 70, paths: ["src/api/jobs.ts"], prompted: true },
    { daysAgo: 60, paths: ["src/ui/Board.tsx"], prompted: true },
    { daysAgo: 50, paths: ["src/agents/router.ts", "src/ui/Board.tsx"], merge: true },
    { daysAgo: 45, paths: ["src/agents/planner.ts"], prompted: true },
    { daysAgo: 44, paths: ["scripts/seed.ts"] },
    { daysAgo: 30, paths: ["src/lib/env.ts"] },
    { daysAgo: 20, paths: ["src/agents/router.ts"], prompted: true },
    { daysAgo: 10, paths: ["src/config.ts"] },
  ],
};

/** Every byte prompted, nothing PR-mediated: the interval collapses to a point
 *  because there is no review record that could ever have existed. */
export const PROMPTED_ONLY: ExtractFixture = {
  tree: [
    ["src/index.ts", 8000],
    ["src/router.ts", 6000],
    ["src/db.ts", 4000],
    ["src/ui.tsx", 9000],
    ["test/index.test.ts", 2000],
    ["package.json", 800],
  ],
  commits: [
    { daysAgo: 120, paths: ["src/index.ts", "src/db.ts", "package.json"], prompted: true },
    { daysAgo: 40, paths: ["src/router.ts", "test/index.test.ts"], prompted: true },
    { daysAgo: 10, paths: ["src/ui.tsx", "src/index.ts"], prompted: true },
  ],
};

/**
 * The founder's own card, in miniature: the four biggest files below the line
 * are a stylesheet, a schema dump, a test and a seed script, and the two files
 * an engineer would actually open are the smallest things in the tree.
 *
 * Shared because four surfaces have to agree about it — the ledger's groups,
 * the card's rows, the ordinal `explain 1` resolves, and the rows the picker
 * re-lists. A second copy of this tree would eventually stop being the same
 * test.
 *
 * Six files, so the card's fold line is exercised too.
 */
export const KINDS_BELOW: ExtractFixture = {
  tree: [
    ["app/bridge.css", 30000],
    ["supabase/migrations/20260719195925_remote_schema.sql", 26000],
    ["cli/src/extract.test.ts", 22000],
    ["scripts/seed.ts", 18000],
    ["app/api/route.ts", 9000],
    ["workers/src/drain.ts", 7000],
  ],
  commits: [
    {
      daysAgo: 300,
      paths: [
        "app/bridge.css",
        "supabase/migrations/20260719195925_remote_schema.sql",
        "cli/src/extract.test.ts",
        "scripts/seed.ts",
        "app/api/route.ts",
        "workers/src/drain.ts",
      ],
      prompted: true,
    },
  ],
};

/** A repository whose entire debt is declared kinds. There is nothing to promote. */
export const ALL_SET_ASIDE: ExtractFixture = {
  tree: [
    ["src/__tests__/parse.ts", 12000],
    ["app/theme.scss", 9000],
    ["db/schema.sql", 6000],
    ["scripts/deploy.ts", 3000],
  ],
  commits: [
    {
      daysAgo: 300,
      paths: ["src/__tests__/parse.ts", "app/theme.scss", "db/schema.sql", "scripts/deploy.ts"],
      prompted: true,
    },
  ],
};

/** No commits, no tree: the "nothing to fathom here yet" state. */
export const EMPTY: ExtractFixture = { tree: [], commits: [] };

/**
 * Twenty-six files, each hand-written once by one person inside the last
 * month: every one of them is above the line today and every one of them
 * crosses it inside the horizon.
 *
 * The shape exists to overflow the fade table's twenty-row cap — which is not
 * a contrived case at all. Solo, unreviewed, hand-written code crosses about
 * sixty-six days after its last touch, so a small repository with one active
 * author produces exactly this: a whole quarter's work fading in a queue.
 */
export const MANY_CROSSINGS: ExtractFixture = {
  tree: Array.from({ length: 26 }, (_unused, index) => {
    const name = String.fromCharCode("a".charCodeAt(0) + index);
    return [`src/${name}.ts`, 1000 + index * 100] as const;
  }),
  commits: Array.from({ length: 26 }, (_unused, index) => ({
    daysAgo: index + 1,
    paths: [`src/${String.fromCharCode("a".charCodeAt(0) + index)}.ts`],
  })),
};

/**
 * A LADDER WHOSE RUNGS ARE A ROUNDING ERROR — the arrangement the paydown
 * card's suppression rule exists for.
 *
 * Twelve hundred-byte files below the line, one megabyte of schema below it
 * with them, and a megabyte of fresh code above it. The ladder stops at ten
 * rungs and those ten together are a thousand bytes against a two-megabyte
 * denominator, so every printed share holds while the underlying bytes move —
 * which is exactly the case where four rows of an identical number would be a
 * leverage claim refuting itself, and where a limit of 50 still flips.
 *
 * `db/schema.sql` sorts behind the twelve on kind, so the rungs cannot reach
 * the byte mass that would move the share. That is the ordering doing what it
 * is documented to do rather than a fixture arranged around it.
 */
export const TINY_LADDER: ExtractFixture = {
  tree: [
    ...Array.from(
      { length: 12 },
      (_unused, index) => [`src/${String.fromCharCode(97 + index)}.ts`, 100] as const,
    ),
    ["db/schema.sql", 1_000_000],
    ["src/live.ts", 1_000_000],
  ],
  commits: [
    {
      daysAgo: 500,
      paths: [
        ...Array.from({ length: 12 }, (_unused, index) =>
          `src/${String.fromCharCode(97 + index)}.ts`,
        ),
        "db/schema.sql",
      ],
      prompted: true,
    },
    { daysAgo: 1, paths: ["src/live.ts"] },
  ],
};

/** A tree with nothing in it that counts as code. */
export const NON_CODE: ExtractFixture = {
  tree: [
    ["docs/hero.png", 44000],
    ["fonts/Inter.woff2", 91000],
    ["package-lock.json", 210000],
  ],
  commits: [{ daysAgo: 3, paths: ["docs/hero.png"] }],
};

/** The truncated-history banner: a `--depth 1` clone reads a fragment. */
export const SHALLOW: ExtractFixture = { ...MIXED, provenance: { shallow: true } };

/** Squash subjects and not one two-parent merge: the ceiling rests on a
 *  naming convention, and the card says so. */
export const SQUASH_ONLY: ExtractFixture = {
  tree: [
    ["src/index.ts", 9000],
    ["src/parse.ts", 5400],
    ["src/render.ts", 7200],
  ],
  commits: [
    { daysAgo: 200, paths: ["src/index.ts", "src/parse.ts"], squashPr: 3, prompted: true },
    { daysAgo: 90, paths: ["src/render.ts"], squashPr: 11, prompted: true },
    { daysAgo: 20, paths: ["src/parse.ts"], squashPr: 19 },
  ],
};
