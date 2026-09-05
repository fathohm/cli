import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE REFUSALS, AS A TEST.
 *
 * The extension's whole claim is that it adds a number to the editor and adds
 * nothing else — no socket, no per-line mark, no verdict about a person. Those
 * are promises a README cannot be trusted on, so they are read off the source
 * that ships instead.
 *
 * The transitive half is already covered: everything under `cli/src`, `lib`
 * and `workers/src/scorer` reaches the user through the CLI bundle too, and
 * `cli/test/no-network.test.ts` asserts that bundle token by token. What is new
 * here is `extension/src`, so that is what this reads.
 */

const SRC = path.join(process.cwd(), "extension", "src");

/** Everything the extension host may import by name. Node builtins are absent
 *  on purpose — the extension does no IO of its own; extraction does it. */
const ALLOWED_MODULES = ["vscode"] as const;

/** Standalone tokens that would name a network-capable module. */
const NETWORK_MODULES = /(?<![A-Za-z0-9_$])(https|http|net|dns|tls|http2|dgram)(?![A-Za-z0-9_$])/g;
/** The one shape those tokens are allowed in: a URL scheme, never an import. */
const SCHEME_AHEAD = /^s?:\/\//;
/** Substrings with no innocent reading. */
const NETWORK_CALLS = ["fetch(", "XMLHttpRequest", "WebSocket", "navigator.sendBeacon"];

/**
 * The editor APIs that would put a mark on a LINE rather than beside a file.
 * Per-line colouring implies a content-level claim this evidence cannot
 * support and reads as blame; a diagnostic would frame comprehension debt as
 * an error, which is the wrong register for a fact about a record.
 */
const PER_LINE_APIS = [
  "createTextEditorDecorationType",
  "setDecorations",
  "createDiagnosticCollection",
  "registerCodeLensProvider",
  "CodeLens",
  "DiagnosticSeverity",
  "registerInlayHintsProvider",
];

function sources(): Array<{ file: string; text: string }> {
  return readdirSync(SRC)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ file: name, text: readFileSync(path.join(SRC, name), "utf8") }));
}

/** Comments out, so prose about "no network" is not read as an import. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function specifiers(text: string): string[] {
  return [...code(text).matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("the extension imports nothing that could reach a network", () => {
  it("names only `vscode` and paths inside this repository", () => {
    for (const { file, text } of sources()) {
      for (const specifier of specifiers(text)) {
        if (specifier.startsWith(".")) continue;
        expect(
          (ALLOWED_MODULES as readonly string[]).includes(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it("names no network module, under any spelling", () => {
    for (const { file, text } of sources()) {
      const body = code(text);
      for (const match of body.matchAll(NETWORK_MODULES)) {
        const after = body.slice(match.index + match[0].length);
        expect(SCHEME_AHEAD.test(after), `${file} names ${match[0]}`).toBe(true);
      }
      for (const call of NETWORK_CALLS) {
        expect(body, `${file} contains ${call}`).not.toContain(call);
      }
    }
  });
});

/**
 * THE ONE OUTWARD-POINTING LINE.
 *
 * `vscode.env.openExternal` is not a network call by this extension: it hands a
 * URL to the editor, which hands it to the desktop, which opens a browser. The
 * browser connects; this process does not, learns nothing, and sends nothing.
 * The invariant the "no network" rule actually protects is untouched by it —
 * no network module is imported, no fetch/WebSocket/XHR/socket is opened — and
 * that half is asserted above, token by token, exactly as before.
 *
 * What is asserted here is that this escape hatch stays exactly one door wide:
 * the extension may open ONE external URL, and it must be a fathohm.dev URL.
 * A second `openExternal`, or one pointing at any other host, is the shape a
 * beacon would take — a URL is a request the moment somebody appends a query
 * string to it — so the count and the host are what get pinned, not the ban.
 */
describe("the extension opens exactly one external URL, and it is ours", () => {
  it("calls openExternal once, on a literal fathohm.dev https URL", () => {
    const calls: string[] = [];
    const urls = new Set<string>();
    for (const { text } of sources()) {
      const body = code(text);
      calls.push(...(body.match(/openExternal/g) ?? []));
      for (const [, url] of body.matchAll(/["'`](https?:\/\/[^"'`]+)["'`]/g)) urls.add(url);
    }
    expect(calls.length, "one door, or none").toBe(1);
    expect([...urls]).toEqual(["https://fathohm.dev/dashboard"]);
    for (const url of urls) {
      expect(new URL(url).host, `${url} is not ours`).toBe("fathohm.dev");
      expect(url, "no query string — a URL with parameters can carry a reading").not.toContain("?");
    }
  });
});

describe("the extension marks files, never lines", () => {
  it("touches no decoration, diagnostic, code-lens or inlay API", () => {
    for (const { file, text } of sources()) {
      const body = code(text);
      for (const api of PER_LINE_APIS) {
        expect(body, `${file} uses ${api}`).not.toContain(api);
      }
    }
  });
});
