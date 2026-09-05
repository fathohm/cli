import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE LANES HOLD, OR THE BUILD SAYS SO.
 *
 * `cli/src/README.md` states six rules about which lane may import which.
 * A rule nobody enforces is a comment, and this file is the enforcement —
 * written the day the lanes were created, because a boundary is only worth
 * drawing if crossing it is noisy.
 *
 * All three assertions below are invariants now. The third used to be a
 * RATCHET pinning four files in `reading/` that imported `render/`; the debt
 * is paid, so it asserts the empty set and the direction is absolute. The
 * ratchet did its job — each removal was the one-line edit it was built to
 * invite, and the last one closed it.
 */

const SRC = path.join(import.meta.dirname);

/** Non-test modules in a lane, as basenames. */
function lane(name: string): { file: string; text: string }[] {
  return readdirSync(path.join(SRC, name))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: f, text: readFileSync(path.join(SRC, name, f), "utf8") }));
}

/** Which sibling lanes this file imports from, by `../<lane>/` specifiers. */
function importsFrom(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/from\s+"\.\.\/([a-z-]+)\//g)].map((m) => m[1]),
  );
}

/** Same, but only the imports that survive to runtime (`import type` is erased). */
function valueImportsFrom(text: string): Set<string> {
  const withoutTypes = text.replace(/import\s+type\s+[^;]*?;/g, "");
  return importsFrom(withoutTypes);
}

describe("cli/src lanes", () => {
  it("repo/ imports cmd/ and nothing else in this tree", () => {
    const strays = lane("repo")
      .filter((m) => [...importsFrom(m.text)].some((l) => l !== "cmd"))
      .map((m) => `repo/${m.file}`);

    // repo/ turns a working copy into typed data. If it needs a score or a
    // rendered string, the dependency is pointing the wrong way.
    expect(strays).toEqual([]);
  });

  it("tty/ never imports render/ at runtime", () => {
    // tty/selector.ts names `EnvLike` from render/term. A type is erased at
    // build, so the rule — "no printing, no ANSI" — still holds. This asserts
    // the rule (no VALUE crosses), not the absence of the word "render".
    const printers = lane("tty")
      .filter((m) => valueImportsFrom(m.text).has("render"))
      .map((m) => `tty/${m.file}`);

    expect(printers).toEqual([]);
  });

  it("reading/ never imports render/", () => {
    const offenders = lane("reading")
      .filter((m) => importsFrom(m.text).has("render"))
      .map((m) => m.file)
      .sort();

    // The lane's defining rule, with nothing exempted from it: `reading/`
    // computes and `render/` prints. Any name here is a regression, and the
    // fix is the same one that emptied this list — move the arithmetic down,
    // never the printing up.
    expect(offenders).toEqual([]);
  });
});
