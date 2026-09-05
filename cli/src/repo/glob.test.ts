import { describe, expect, it } from "vitest";

import { excludeMatcher, matchGlob } from "./glob";

/**
 * The glob matrix.
 *
 * These patterns decide what is in the reading's DENOMINATOR, which makes an
 * over-eager `*` the most expensive bug in this file: a pattern that matched
 * one segment too many would quietly delete real code from the measurement and
 * the headline would go down. So the table is written from both sides — what
 * each pattern must match AND what it must not — and the "must not" column is
 * the one that matters.
 */

const CASES: ReadonlyArray<{
  pattern: string;
  matches: readonly string[];
  misses: readonly string[];
}> = [
  {
    pattern: "dist/**",
    // `**` matches zero segments as well as many, so the pattern names the
    // tree AND a file called `dist` sitting where the tree would be. One rule,
    // no trailing-star special case to remember.
    matches: ["dist/index.js", "dist/a/b/c.js", "dist"],
    // `distant/` and `src/dist/` are different places with similar names: the
    // match is anchored at both ends, which is what stops an exclusion from
    // quietly deleting real code from the denominator.
    misses: ["distant/x.js", "src/dist/x.js"],
  },
  {
    pattern: "**/*.generated.ts",
    matches: ["a.generated.ts", "src/a.generated.ts", "src/deep/a.generated.ts"],
    misses: ["a.generated.tsx", "src/generated.ts.bak"],
  },
  {
    pattern: "src/*.ts",
    // A single star never crosses a slash: this is the rule that keeps
    // `src/*.ts` from swallowing the whole subtree.
    matches: ["src/index.ts", "src/a-b.ts"],
    misses: ["src/deep/index.ts", "src/index.tsx", "index.ts"],
  },
  {
    pattern: "vendor",
    // No wildcard is an exact path, anchored at both ends.
    matches: ["vendor"],
    misses: ["vendor/x.ts", "src/vendor", "vendors"],
  },
  {
    pattern: "a/**/b.ts",
    // `**` matches zero segments too, which is what every other tool with this
    // syntax does and therefore what a reader will assume.
    matches: ["a/b.ts", "a/x/b.ts", "a/x/y/b.ts"],
    misses: ["a/b.tsx", "x/a/b.ts"],
  },
  {
    pattern: "**",
    matches: ["a.ts", "a/b/c.ts"],
    misses: [],
  },
  {
    pattern: "*.lock",
    matches: ["yarn.lock"],
    misses: ["sub/yarn.lock"],
  },
  {
    // Regex metacharacters are literal — the reason the matcher is hand-rolled
    // rather than compiled to a RegExp with escaping done by hand.
    pattern: "src/a.b+c(1).ts",
    matches: ["src/a.b+c(1).ts"],
    misses: ["src/axbxcx1x.ts", "src/a.b+c(1)_ts"],
  },
  {
    pattern: "docs/*/*.md",
    matches: ["docs/a/b.md"],
    misses: ["docs/b.md", "docs/a/b/c.md"],
  },
];

describe("the glob subset", () => {
  for (const { pattern, matches, misses } of CASES) {
    for (const path of matches) {
      it(`${pattern} matches ${path}`, () => {
        expect(matchGlob(pattern, path)).toBe(true);
      });
    }
    for (const path of misses) {
      it(`${pattern} does NOT match ${path}`, () => {
        expect(matchGlob(pattern, path)).toBe(false);
      });
    }
  }

  it("is case-sensitive — a Mac and CI must exclude the same files", () => {
    expect(matchGlob("SRC/**", "src/a.ts")).toBe(false);
    expect(matchGlob("src/**", "src/a.ts")).toBe(true);
  });

  it("reads `./dist/` and `dist` as the same thing a person meant", () => {
    expect(matchGlob("./dist/**", "dist/a.js")).toBe(true);
    expect(matchGlob("dist/", "dist")).toBe(true);
  });

  it("matches unicode paths by their own characters", () => {
    expect(matchGlob("src/**", "src/café/日本語.ts")).toBe(true);
    expect(matchGlob("src/*.ts", "src/日本語.ts")).toBe(true);
  });
});

describe("excludeMatcher", () => {
  it("excludes nothing when there are no patterns", () => {
    const matcher = excludeMatcher([]);
    expect(matcher("anything/at/all.ts")).toBe(false);
  });

  it("is the union of its patterns", () => {
    const matcher = excludeMatcher(["dist/**", "**/*.min.js"]);
    expect(matcher("dist/a.js")).toBe(true);
    expect(matcher("public/a.min.js")).toBe(true);
    expect(matcher("src/a.js")).toBe(false);
  });
});
