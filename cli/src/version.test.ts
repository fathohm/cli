import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCORER_VERSION as SCORER_VERSION_FROM_WORKERS } from "../../workers/src/scorer";
import { CLI_VERSION, SCORER_VERSION, versionLine } from "./version";

describe("versionLine", () => {
  // Pinned literally on purpose: `--version` is a contract other tools parse,
  // and the whole point of printing the scorer version is that a reading is
  // only attributable if the lens is stated. Changing either half of this
  // string is a deliberate release act, not a refactor.
  it("prints the CLI version and the scorer version", () => {
    expect(versionLine()).toBe("fathohm 1.6.2 (scorer v4)");
  });

  it("is composed from the two exported versions, not written out by hand", () => {
    expect(versionLine()).toBe(`fathohm ${CLI_VERSION} (scorer ${SCORER_VERSION})`);
  });

  it("re-exports the scorer version from the shared scorer, never a copy", () => {
    expect(SCORER_VERSION).toBe(SCORER_VERSION_FROM_WORKERS);
  });
});

describe("cli/package.json", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  const record = manifest as Record<string, unknown>;

  it("declares the version the CLI prints", () => {
    expect(record.version).toBe(CLI_VERSION);
  });

  it("declares no dependencies of any kind", () => {
    // The zero-runtime-dependency promise is the reason `npx fathohm` is safe
    // to run against a private repo. Shared logic arrives by bundling, never
    // by install. A dependency field appearing here is the failure, not the
    // install size.
    expect(Object.keys(record)).not.toContain("dependencies");
    expect(Object.keys(record)).not.toContain("devDependencies");
    expect(Object.keys(record)).not.toContain("peerDependencies");
    expect(Object.keys(record)).not.toContain("optionalDependencies");
  });

  it("ships one bundled binary and nothing else", () => {
    expect(record.name).toBe("fathohm");
    // NO leading `./`. npm 11.16.0 removes a "./"-prefixed bin target as
    // invalid rather than normalising it, which is what silently stripped the
    // bin from the 1.0.0 publish. The prefix is a publish bug, not a style.
    expect(record.bin).toEqual({ fathohm: "dist/fathohm.cjs" });
    expect(record.files).toEqual(["dist"]);
    expect(record.engines).toEqual({ node: ">=20.9" });
  });
});
