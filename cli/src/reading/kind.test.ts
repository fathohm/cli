import { describe, expect, it } from "vitest";

import { byDisplayOrder, kindRank } from "./kind";

/**
 * The three tiers, and — the half that matters — the near-misses.
 *
 * A classifier that demotes real source is worse than no classifier at all: the
 * section's whole job is to hand a reader the file they should open, and a
 * `contest.ts` pushed to the back because four of its letters spell "test" is
 * the section quietly getting that wrong. So every rule here is pinned against
 * the string that almost matches it.
 */

describe("rank 2 — tests, by the marker in the filename", () => {
  const tests = [
    "cli/src/extract.test.ts",
    "lib/reading-explained.test.ts",
    "src/parse.spec.ts",
    "internal/server/handler_test.go",
    "api/test_client.py",
    "TEST_CLIENT.PY",
    "src/Parser.Test.tsx",
  ];
  for (const path of tests) {
    it(`ranks ${path} last`, () => {
      expect(kindRank(path)).toBe(2);
    });
  }
});

describe("rank 2 — tests, by the directory that declares them", () => {
  // The segment rule is the one lib/code-files.ts deliberately does NOT have.
  // Kind-of-use is a statement about where a file sits, so it is fair here.
  const tests = [
    "src/__tests__/parse.ts",
    "cli/test/bundle.ts",
    "tests/integration/flow.ts",
    "app/TESTS/case.ts",
    "e2e/checkout.ts",
    "packages/web/e2e/login.ts",
    "packages/core/test/deep/nested/case.ts",
  ];
  for (const path of tests) {
    it(`ranks ${path} last`, () => {
      expect(kindRank(path)).toBe(2);
    });
  }
});

describe("rank 2 — stylesheets, by extension", () => {
  const styles = [
    "app/bridge.css",
    "styles/main.scss",
    "styles/main.sass",
    "styles/main.less",
    "styles/main.styl",
    "app/Bridge.CSS",
  ];
  for (const path of styles) {
    it(`ranks ${path} last`, () => {
      expect(kindRank(path)).toBe(2);
    });
  }
});

describe("rank 1 — the scaffolding", () => {
  const scaffold: ReadonlyArray<readonly [string, string]> = [
    ["package.json", "a manifest is not the parser"],
    ["tsconfig.json", "config by extension"],
    ["workers/config.yml", "config by extension"],
    ["deploy/values.yaml", "config by extension"],
    ["project.toml", "config by extension"],
    ["setup.ini", "config by extension"],
    ["Dockerfile", "config by exact filename"],
    ["ops/DOCKERFILE", "case-insensitive"],
    ["Makefile", "config by exact filename"],
    ["docker-compose.yml", "config by stem"],
    ["docker-compose", "config by stem, extensionless"],
    ["docker-compose.prod.yaml", "config by stem, doubled extension"],
    ["supabase/migrations/20260719195925_remote_schema.sql", "sql by extension"],
    ["db/seed.SQL", "sql by extension"],
    ["supabase/migrations/0001_init.ts", "sql by the migrations segment"],
    ["scripts/cli-gallery-parity.ts", "scripts by segment"],
    ["packages/web/scripts/build.sh", "scripts by segment"],
    ["SCRIPTS/deploy.ts", "scripts by segment, case-insensitive"],
    ["dist/bundle.js", "build output by segment"],
    ["app/build/manifest.ts", "build output by segment"],
  ];
  for (const [path, why] of scaffold) {
    it(`ranks ${path} in the middle — ${why}`, () => {
      expect(kindRank(path)).toBe(1);
    });
  }
});

describe("rank 2 beats rank 1 — a test under scripts/ is a test", () => {
  // The tiers rank how far a file sits from the reader's first question, so a
  // file that answers two of them sits at the further one.
  const both = ["scripts/seed.test.ts", "test/schema.sql", "e2e/theme.css", "dist/app.spec.js"];
  for (const path of both) {
    it(`ranks ${path} last, not in the middle`, () => {
      expect(kindRank(path)).toBe(2);
    });
  }
});

describe("rank 0 — the near-misses stay in front", () => {
  const kept = [
    // "test" is in the name, but never as `.test.`, `_test.` or a `test_` head.
    "src/contest.ts",
    "src/protester.ts",
    "src/latest.ts",
    "src/attest.ts",
    // The extension is `ts`; the words are only letters in the middle of one.
    "lib/castsql.ts",
    "lib/distances.ts",
    "src/builder.ts",
    "src/migrations.ts",
    // FILES whose names are the segments. The rule is segment EQUALITY.
    "src/scripts.ts",
    "src/tests.ts",
    "src/test.ts",
    "src/dist.ts",
    "src/build.ts",
    // A file named after a config convention is not that config file.
    "src/makefile.ts",
    "tools/dockerfile.ts",
    "tools/docker-composer.ts",
    // DIRECTORIES that merely start with, or contain, the word.
    "testimony/foo.ts",
    "test-helpers/fixture-repo.ts",
    "scripts-legacy/run.ts",
    "e2e-helpers/driver.ts",
    "distribution/pack.ts",
    // Real application files, which is the whole point of the ordering.
    "app/page.tsx",
    "components/Map.tsx",
    "workers/src/scorer.ts",
    "app/api/route.ts",
  ];
  for (const path of kept) {
    it(`keeps ${path} in front`, () => {
      expect(kindRank(path)).toBe(0);
    });
  }
});

/**
 * THE STACK MATRIX — one representative path per (stack × tier) cell.
 *
 * The tiers were written against a TypeScript monorepo and then pointed at
 * everybody else's repository, which is where the gaps were: `spec/` is RSpec's
 * whole test tree, `conftest.py` carries no marker a prefix rule can find,
 * `go.mod` and `Gemfile` have no extension at all, and a Terraform plan is a
 * declaration of shape rather than the program somebody is trying to read.
 *
 * Held as one table because the failure this guards against is per-STACK: a
 * rule that lands application code in front on Node and buries it on Rails is
 * a card that is honest in one language and useless in another. Every cell is
 * pinned, including the ones that already passed — those are the ones a later
 * rule would silently take away.
 */
describe("the stack matrix — every ecosystem gets the same three tiers", () => {
  const matrix: ReadonlyArray<{
    readonly stack: string;
    readonly cells: ReadonlyArray<readonly [path: string, rank: 0 | 1 | 2]>;
  }> = [
    {
      stack: "Node",
      cells: [
        ["src/server/router.ts", 0],
        ["apps/web/package.json", 1],
        ["infra/main.tf", 1],
        ["infra/prod.tfvars", 1],
        ["prisma/schema.prisma", 1],
        ["src/router.test.ts", 2],
        ["cypress/e2e/checkout.cy.ts", 2],
        ["examples/basic/index.ts", 2],
      ],
    },
    {
      stack: "Python",
      cells: [
        ["app/services/billing.py", 0],
        ["pyproject.toml", 1],
        ["alembic/migrate/0001_init.py", 1],
        ["tests/test_billing.py", 2],
        ["app/test_billing.py", 2],
        ["tests/conftest.py", 2],
        ["conftest.py", 2],
      ],
    },
    {
      stack: "Go",
      cells: [
        ["internal/server/handler.go", 0],
        ["go.mod", 1],
        ["deploy/values.yaml", 1],
        ["internal/server/handler_test.go", 2],
        ["internal/server/testdata/golden.json", 2],
      ],
    },
    {
      stack: "Rust",
      cells: [
        ["src/parser/lexer.rs", 0],
        ["Cargo.toml", 1],
        ["benches/parse.rs", 2],
        ["examples/echo.rs", 2],
        ["tests/integration.rs", 2],
      ],
    },
    {
      stack: "Rails",
      cells: [
        ["app/models/invoice.rb", 0],
        ["Gemfile", 1],
        ["Rakefile", 1],
        ["db/migrate/20260101_add_invoices.rb", 1],
        ["db/schema.sql", 1],
        ["spec/models/invoice_spec.rb", 2],
        ["app/assets/theme.scss", 2],
      ],
    },
    {
      stack: "Java/Kotlin",
      cells: [
        ["src/main/java/App.java", 0],
        ["src/main/kotlin/Router.kt", 0],
        ["build/libs/app.jar", 1],
        ["config/application.yml", 1],
        ["src/test/java/App.java", 2],
        ["src/test/kotlin/RouterTest.kt", 2],
      ],
    },
  ];

  for (const { stack, cells } of matrix) {
    for (const [path, rank] of cells) {
      it(`${stack}: ${path} is tier ${rank}`, () => {
        expect(kindRank(path)).toBe(rank);
      });
    }
  }
});

describe("the new segments are near-miss safe too", () => {
  // Every rule added for another ecosystem is a new way to bury somebody's
  // source. The segment rules are EQUALITY, and the filename rules are exact.
  const kept = [
    "src/specifics.ts",
    "src/spec.ts",
    "lib/specification.rb",
    "cypress-helpers/mount.ts",
    "src/cypress.ts",
    "benchmarks/parse.rs",
    "src/benches.rs",
    "src/examples.ts",
    "example/app.ts",
    "src/testdata.go",
    "src/migrate.go",
    "lib/migrated.ts",
    "src/conftest.ts",
    "tools/gemfile.rb",
    "tools/go.mod.ts",
  ];
  for (const path of kept) {
    it(`keeps ${path} in front`, () => {
      expect(kindRank(path)).toBe(0);
    });
  }
});

describe("the rule is total and pure", () => {
  it("says 0 about a path with nothing in it", () => {
    expect(kindRank("")).toBe(0);
    expect(kindRank("/")).toBe(0);
  });

  it("returns the same answer every time it is asked", () => {
    for (const path of ["app/bridge.css", "src/contest.ts", "scripts/seed.ts", "package.json"]) {
      expect(kindRank(path)).toBe(kindRank(path));
    }
  });

  it("only ever answers 0, 1 or 2", () => {
    for (const path of ["a.ts", "a.css", "a.json", "test/a.ts", "scripts/a.ts", "x/y/z"]) {
      expect([0, 1, 2]).toContain(kindRank(path));
    }
  });
});

describe("byDisplayOrder — tier, then bytes, then path", () => {
  it("puts a small application file above a large test", () => {
    const route = { path: "app/api/route.ts", bytes: 900 };
    const test = { path: "cli/src/extract.test.ts", bytes: 90000 };
    expect(byDisplayOrder(route, test)).toBeLessThan(0);
  });

  it("puts a small application file above a large manifest", () => {
    // The failure a binary demotion could not fix: `package.json` is not a
    // test, and it is not the parser either.
    const route = { path: "app/api/route.ts", bytes: 900 };
    const manifest = { path: "package.json", bytes: 90000 };
    expect(byDisplayOrder(route, manifest)).toBeLessThan(0);
  });

  it("puts a manifest above a test", () => {
    expect(
      byDisplayOrder({ path: "package.json", bytes: 1 }, { path: "a.test.ts", bytes: 99 }),
    ).toBeLessThan(0);
  });

  it("ranks by bytes inside one tier, and by path on a tie", () => {
    expect(byDisplayOrder({ path: "a.ts", bytes: 10 }, { path: "b.ts", bytes: 20 })).toBeGreaterThan(
      0,
    );
    expect(byDisplayOrder({ path: "a.ts", bytes: 10 }, { path: "b.ts", bytes: 10 })).toBeLessThan(0);
    expect(byDisplayOrder({ path: "a.ts", bytes: 10 }, { path: "a.ts", bytes: 10 })).toBe(0);
  });

  it("sorts a mixed list into tiers, biggest first inside each", () => {
    const files = [
      { path: "cli/src/extract.test.ts", bytes: 22000 },
      { path: "package.json", bytes: 30000 },
      { path: "app/api/route.ts", bytes: 9000 },
      { path: "app/bridge.css", bytes: 40000 },
      { path: "workers/src/drain.ts", bytes: 12000 },
      { path: "scripts/seed.ts", bytes: 18000 },
    ];
    expect([...files].sort(byDisplayOrder).map((file) => file.path)).toEqual([
      "workers/src/drain.ts",
      "app/api/route.ts",
      "package.json",
      "scripts/seed.ts",
      "app/bridge.css",
      "cli/src/extract.test.ts",
    ]);
  });
});
