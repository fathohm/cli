import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { HOSTED_URL } from "../src/render/hosted";
import { buildBundle } from "./bundle-build";

/**
 * THE NO-PHONE-HOME ASSERTION — the claim, as a test rather than a promise.
 *
 * "It never opens a socket" is the sentence that decides whether this tool can
 * be run inside a company at all, and it is the one sentence a README cannot
 * be trusted on. So it is checked four ways, and the last two are the ones that
 * matter because they read what actually ships:
 *
 *   A. **Module specifiers.** Every `import`/`require` in `cli/src` and its
 *      test helpers, checked against an ALLOWLIST of node builtins rather than
 *      a denylist of network ones. A denylist passes anything nobody thought
 *      of; an allowlist makes a new builtin somebody's decision.
 *   B. **The shipped source, token by token.** `http`, `https`, `net`, `dns`,
 *      `tls` as standalone tokens, plus `fetch(`, `XMLHttpRequest`,
 *      `WebSocket`. Comments are stripped first — the word "network" appears in
 *      the help copy, and prose is not an import.
 *   C. **The built bundle**, the same way. This is the artifact that reaches a
 *      user's machine, and it contains everything esbuild pulled in
 *      transitively — so a dependency that reached for the network would be
 *      caught here even if nothing in `cli/src` mentioned it.
 *   D. **`cli/package.json` has no dependency fields at all.** Not "an empty
 *      `dependencies` object" — the field is absent, so there is nothing for a
 *      well-meaning `npm install --save` to append to unnoticed.
 *
 * **The one allowance**, in B and C: a `https://` URL SCHEME. A scheme is not a
 * module specifier — no import has ever resolved through one — and the only
 * URL fathohm prints is the hosted link. Which is itself asserted: every URL in
 * the shipped source and in the bundle must be exactly {@link HOSTED_URL}. A
 * second URL appearing anywhere is a finding whether or not anything fetches it.
 */

const CLI_ROOT = path.join(process.cwd(), "cli");
const SRC_DIR = path.join(CLI_ROOT, "src");
const HELPERS_DIR = path.join(CLI_ROOT, "test-helpers");

/** The node builtins the CLI and its fixtures are allowed to reach for. */
const ALLOWED_BUILTINS = [
  "node:child_process",
  "node:fs",
  "node:os",
  "node:path",
] as const;

/** Standalone tokens that would name a network-capable module. */
const MODULE_TOKENS = /(?<![A-Za-z0-9_$])(https|http|net|dns|tls|http2|dgram)(?![A-Za-z0-9_$])/g;
/** A URL scheme — the one shape those tokens are allowed to appear in. */
const SCHEME_AHEAD = /^s?:\/\//;
/** Substrings with no innocent reading at all. */
const NETWORK_CALLS = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "globalThis.fetch",
  "undici",
  "node-fetch",
] as const;
const URLS = /https?:\/\/[^\s"'<>)\\]+/g;

/** Built rather than written as a literal: an escape inside a regex literal is
 *  exactly what `no-control-regex` exists to catch. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI, "");

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
 * Comment lines, stripped by their own leading marker.
 *
 * A block matcher would eat a `https://` inside a string and hide exactly what
 * this test looks for — the same reasoning `render/discipline.test.ts` uses,
 * and for the same reason.
 */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

/** Everything under `cli/src` that ships: the modules, and the golden files
 *  that pin the copy those modules print. Tests are covered by A and by C. */
function shippedSurface(): Array<{ name: string; text: string }> {
  return walk(SRC_DIR)
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => ({
      name: path.relative(CLI_ROOT, file),
      text: file.endsWith(".ts") ? code(readFileSync(file, "utf8")) : readFileSync(file, "utf8"),
    }));
}

/** Every module specifier in a file, from all three import forms. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s+"([^"]+)"/g,
    /\brequire\(\s*"([^"]+)"\s*\)/g,
    /\bimport\(\s*"([^"]+)"\s*\)/g,
    /^\s*import\s+"([^"]+)"/gm,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** Token hits that are not a URL scheme. */
function moduleTokenHits(text: string): Array<{ token: string; context: string }> {
  const hits: Array<{ token: string; context: string }> = [];
  for (const match of text.matchAll(MODULE_TOKENS)) {
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 4);
    if (SCHEME_AHEAD.test(after)) continue;
    hits.push({
      token: match[0],
      context: text.slice(Math.max(0, match.index - 50), match.index + 50),
    });
  }
  return hits;
}

describe("A. every module specifier is an allowed one", () => {
  const files = [...walk(SRC_DIR), ...walk(HELPERS_DIR)].filter((file) =>
    file.endsWith(".ts"),
  );

  it("imports no node builtin outside the allowlist", () => {
    const builtins = new Set<string>();
    for (const file of files) {
      for (const specifier of specifiers(code(readFileSync(file, "utf8")))) {
        if (specifier.startsWith("node:")) builtins.add(specifier);
        // A bare builtin name (`require("http")`) never goes through `node:`.
        else if (!specifier.startsWith(".") && !specifier.includes("/")) {
          builtins.add(specifier);
        }
      }
    }
    // Set equality, not a subset: a builtin that stops being used should have
    // to be deleted from here too, and a new one has to be argued for.
    expect([...builtins].sort()).toEqual([...ALLOWED_BUILTINS, "vitest"].sort());
  });

  it("imports no network-capable module, under any spelling", () => {
    for (const file of files) {
      for (const specifier of specifiers(code(readFileSync(file, "utf8")))) {
        const bare = specifier.replace(/^node:/, "");
        expect(
          ["http", "https", "net", "dns", "tls", "http2", "dgram", "undici", "node-fetch"],
          `${path.relative(CLI_ROOT, file)} imports ${specifier}`,
        ).not.toContain(bare);
      }
    }
  });
});

describe("B. the shipped source names no network module", () => {
  it("has no standalone http/https/net/dns/tls token outside a URL scheme", () => {
    for (const { name, text } of shippedSurface()) {
      const hits = moduleTokenHits(text);
      expect(hits, `${name}: ${JSON.stringify(hits)}`).toEqual([]);
    }
  });

  it("calls nothing that could open a connection", () => {
    for (const { name, text } of shippedSurface()) {
      for (const call of NETWORK_CALLS) {
        expect(text, `${name} contains ${call}`).not.toContain(call);
      }
    }
  });

  it("prints exactly one URL, and it is the hosted link", () => {
    for (const { name, text } of shippedSurface()) {
      // Escapes stripped first: the question is which HOSTS this tool names,
      // and an SGR sequence is not part of a hostname. The coloured golden
      // paints the link, so the raw bytes after `.dev` are a reset — matched by
      // the URL pattern's own character class and read as a second host.
      for (const url of stripAnsi(text).match(URLS) ?? []) {
        expect(url, `${name} carries a second URL`).toBe(HOSTED_URL);
      }
    }
  });
});

describe("C. the built bundle names no network module", () => {
  // The artifact, not the source: whatever esbuild pulled in transitively is in
  // here, and this is the copy that lands on somebody's machine.
  let bundle = "";
  beforeAll(() => {
    bundle = buildBundle();
  }, 300_000);

  it("has no standalone http/https/net/dns/tls token outside a URL scheme", () => {
    expect(moduleTokenHits(bundle)).toEqual([]);
  });

  it("calls nothing that could open a connection", () => {
    for (const call of NETWORK_CALLS) {
      expect(bundle, `the bundle contains ${call}`).not.toContain(call);
    }
  });

  it("requires only the allowed node builtins", () => {
    const required = new Set<string>();
    for (const match of bundle.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
      required.add(match[1]);
    }
    for (const specifier of required) {
      expect(
        ALLOWED_BUILTINS,
        `the bundle requires ${specifier} at run time`,
      ).toContain(specifier);
    }
  });

  it("carries exactly one URL, and it is the hosted link", () => {
    for (const url of bundle.match(URLS) ?? []) expect(url).toBe(HOSTED_URL);
  });
});

/**
 * E. THE FILESYSTEM INVENTORY — the sibling promise to "no socket", and the
 * one the README now prints as a table a reader can reproduce with `grep`.
 *
 * "Source code is never read" is the load-bearing claim of this whole product,
 * and until now nothing enforced the *shape* of it: the no-network block
 * guards what the bundle can reach over a wire, not what it can open on disk.
 * A single added `readFileSync` — for a cache, a lockfile, a "quick peek at
 * the first line to guess the language" — would leave every test green and
 * every promise on the npm page false.
 *
 * So the inventory is pinned exactly, as an equality rather than a ceiling: a
 * NEW call fails this, and so does a call that quietly disappears, because the
 * README documents the count. When this test goes red the question is never
 * "raise the number" — it is "does the README still describe the tool".
 */
describe("E. the bundle's filesystem calls are exactly the documented ones", () => {
  let bundle = "";
  beforeAll(() => {
    bundle = buildBundle();
  }, 300_000);

  /** esbuild namespaces each `node:fs` import (`import_node_fs`,
   *  `import_node_fs2`, …), so match the family rather than one spelling. */
  const FS_CALL = /[A-Za-z_$]*node_fs[0-9]*\.([a-zA-Z]+)/g;

  it("reads one file, writes one file, and otherwise only looks", () => {
    const counts: Record<string, number> = {};
    for (const [, call] of bundle.matchAll(FS_CALL)) {
      counts[call] = (counts[call] ?? 0) + 1;
    }
    expect(counts).toEqual({
      // `loadConfig`, reading the user's own `.fathohm.toml`. THE only read.
      readFileSync: 1,
      // `fathohm map`, writing the single HTML path the user named.
      writeFileSync: 1,
      // Sizes and presence. Never contents.
      statSync: 2,
      existsSync: 1,
    });
  });

  it("names no filesystem call that could read a source file wholesale", () => {
    // Spelling-independent: these would not be caught by the inventory above if
    // they arrived through a differently-namespaced import or a destructure.
    for (const call of ["createReadStream", "readFile(", "promises.readFile", "openSync"]) {
      expect(bundle, `the bundle contains ${call}`).not.toContain(call);
    }
  });
});

describe("D. the package declares no dependencies at all", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(CLI_ROOT, "package.json"), "utf8"),
  ) as Record<string, unknown>;

  it("has no dependency field to fill in", () => {
    // Absent, not empty. An empty `{}` is an invitation for `npm install
    // --save` to add a line nobody reviews; a missing field makes the next
    // dependency a visible edit to this file.
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
      "bundleDependencies",
      "bundledDependencies",
    ]) {
      expect(Object.keys(manifest), `cli/package.json declares ${field}`).not.toContain(field);
    }
  });

  it("runs no install script", () => {
    // A postinstall is the other way a "zero dependency" package reaches the
    // network on somebody's laptop.
    expect(manifest.scripts).toBeUndefined();
  });
});
