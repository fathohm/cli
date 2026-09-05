import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { CONFIG_FILENAME, loadConfig, parseConfig } from "./config";
import { EXIT, isCliError } from "./errors";

/**
 * `.fathohm.toml`, key by key and failure by failure.
 *
 * The parser is small because the grammar is small, and the tests are the
 * larger half on purpose: a config parser's whole job is to be predictable
 * from the file in front of you, and every case below is somebody's honest
 * mistake — a table header copied from another tool, a key with a dot in it, a
 * multi-line array. Each one has to fail by NAMING THE LINE, because the person
 * who reads the failure is looking at a CI log, not at the file.
 */

const directories: string[] = [];

function repoWith(contents: string | null): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fathohm-config-"));
  directories.push(dir);
  if (contents !== null) writeFileSync(path.join(dir, CONFIG_FILENAME), contents, "utf8");
  return dir;
}

afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function parse(text: string) {
  return parseConfig(text, CONFIG_FILENAME);
}

function failure(text: string): { message: string; hint: string | undefined; code: number } {
  try {
    parse(text);
  } catch (error) {
    if (!isCliError(error)) throw error;
    return { message: error.message, hint: error.hint, code: error.exitCode };
  }
  throw new Error("expected the config to be rejected");
}

describe("the documented subset", () => {
  it("reads every key fathohm knows, comments and all", () => {
    const { config, warnings } = parse(
      [
        "# how much of this repo may sit below the line",
        "max-blind = 40",
        "",
        'exclude = ["dist/**", "**/*.generated.ts"]   # generated, not written',
        'horizon = "120d"',
      ].join("\n"),
    );
    expect(config.maxBlind).toBe(40);
    expect(config.exclude).toEqual(["dist/**", "**/*.generated.ts"]);
    expect(config.horizonDays).toBe(120);
    expect(warnings).toEqual([]);
  });

  it("takes an empty file, an empty array and a fractional limit", () => {
    expect(parse("").config).toEqual({ maxBlind: null, exclude: [], horizonDays: null });
    expect(parse("exclude = []").config.exclude).toEqual([]);
    expect(parse("max-blind = 0.5").config.maxBlind).toBe(0.5);
    expect(parse("max-blind = 0").config.maxBlind).toBe(0);
    expect(parse("max-blind = 100").config.maxBlind).toBe(100);
  });

  it("reads horizon written as a bare number, the way --horizon does", () => {
    expect(parse("horizon = 90").config.horizonDays).toBe(90);
    expect(parse('horizon = "90"').config.horizonDays).toBe(90);
  });

  it("survives CRLF, a BOM and trailing whitespace", () => {
    const { config } = parse("﻿max-blind = 25  \r\nhorizon = \"30d\"\r\n");
    expect(config.maxBlind).toBe(25);
    expect(config.horizonDays).toBe(30);
  });

  it("keeps a `#` inside a string out of the comment reader", () => {
    expect(parse('exclude = ["src/#hash/**"]').config.exclude).toEqual(["src/#hash/**"]);
  });

  it("unescapes the two escapes it has, and refuses the ones it does not", () => {
    expect(parse('exclude = ["a\\"b", "c\\\\d"]').config.exclude).toEqual(['a"b', "c\\d"]);
    expect(failure('exclude = ["a\\nb"]').message).toMatch(/only escapes/);
  });
});

describe("an unknown key warns and never fails", () => {
  it("names the key and the line, and keeps reading the file", () => {
    const { config, warnings } = parse(
      ["max_blind = 40", "max-blind = 12", "future-thing = true"].join("\n"),
    );
    // The typo'd underscore did NOT become the limit — that is the bug the
    // warning exists to make visible rather than the one it papers over.
    expect(config.maxBlind).toBe(12);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("max_blind");
    expect(warnings[0]).toContain(":1:");
    expect(warnings[1]).toContain("future-thing");
    expect(warnings.join(" ")).toContain("max-blind, exclude, horizon");
  });
});

describe("everything outside the subset is a usage error naming the line", () => {
  const CASES: ReadonlyArray<{ name: string; text: string; says: RegExp }> = [
    { name: "a table header", text: "[gate]\nmax-blind = 40", says: /no tables/ },
    { name: "a dotted key", text: "gate.max-blind = 40", says: /no dotted keys/ },
    { name: "no equals sign", text: "max-blind 40", says: /key = value/ },
    { name: "a missing value", text: "max-blind =", says: /value is missing/ },
    { name: "a missing key", text: "= 40", says: /key is missing/ },
    {
      name: "a multi-line array",
      text: 'exclude = [\n  "dist/**",\n]',
      says: /one line/,
    },
    { name: "an unquoted string", text: "horizon = 90d", says: /a value is/ },
    { name: "an unterminated string", text: 'horizon = "90d', says: /closing quote/ },
    { name: "a bare array item", text: "exclude = [dist]", says: /quoted strings only/ },
    { name: "a duplicate key", text: "max-blind = 1\nmax-blind = 2", says: /already set/ },
    { name: "two values on a line", text: 'horizon = "90d" "30d"', says: /more on the line/ },
  ];

  for (const { name, text, says } of CASES) {
    it(`${name} exits 2 with the line quoted back`, () => {
      const thrown = failure(text);
      expect(thrown.code).toBe(EXIT.usage);
      expect(thrown.message).toMatch(says);
      expect(thrown.message).toContain(CONFIG_FILENAME);
      expect(thrown.hint).toBeDefined();
    });
  }

  it("rejects a known key holding the wrong kind of value", () => {
    expect(failure('max-blind = "40"').message).toMatch(/max-blind. takes a number/);
    expect(failure("max-blind = 140").message).toMatch(/between 0 and 100/);
    expect(failure("max-blind = -1").message).toMatch(/between 0 and 100/);
    expect(failure('exclude = "dist"').message).toMatch(/exclude. takes an array/);
    expect(failure('exclude = [""]').message).toMatch(/not empty/);
    expect(failure("horizon = true").message).toMatch(/horizon. takes a day count/);
    expect(failure('horizon = "soon"').message).toMatch(/horizon. takes a day count/);
    expect(failure("horizon = 0").message).toMatch(/horizon. takes a day count/);
  });
});

describe("where the file is looked for", () => {
  it("reads the one at the repository root", () => {
    const dir = repoWith("max-blind = 33\n");
    const loaded = loadConfig(dir);
    expect(loaded.config.maxBlind).toBe(33);
    expect(loaded.source).toBe(CONFIG_FILENAME);
  });

  it("is silent when there is no config at all", () => {
    const loaded = loadConfig(repoWith(null));
    expect(loaded.config).toEqual({ maxBlind: null, exclude: [], horizonDays: null });
    expect(loaded.warnings).toEqual([]);
    expect(loaded.source).toBeNull();
  });

  /**
   * The one that matters. A config inherited from a parent directory — or from
   * `$HOME` — would gate a build on a file the person reading the failure
   * cannot see from the repository they are standing in. No walking up.
   */
  it("never walks up to a parent directory", () => {
    const parent = repoWith("max-blind = 1\n");
    const child = path.join(parent, "nested");
    mkdtempSync(path.join(parent, "nested-"));
    expect(loadConfig(child).config.maxBlind).toBeNull();
  });
});
