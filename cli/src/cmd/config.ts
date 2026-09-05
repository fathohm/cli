import { readFileSync } from "node:fs";
import path from "node:path";

import { parseDurationDays, parsePercent } from "./args";
import { CliError, EXIT } from "./errors";

/**
 * `.fathohm.toml` — the CI-side half of the command surface, and a hand-rolled
 * parser for a DELIBERATELY tiny subset of TOML.
 *
 * The grammar, in full:
 *
 *     # a comment
 *     max-blind = 40                       # number
 *     exclude   = ["dist/**", "vendor/**"] # array of strings, one line
 *     horizon   = "90d"                    # string
 *
 * Top-level keys only. No tables, no dotted keys, no multi-line anything. A
 * real TOML dependency would be a runtime dependency, and the promise on the
 * tin is zero of those — but the subset is not only about the dependency. A
 * config file that can express structure invites structure, and every extra
 * shape is another way for a build to be gated on something nobody can read
 * off the file at a glance. What this file may say is: how much debt is
 * allowed, what is not part of the codebase, and how far ahead to look.
 *
 * Three rules the parser will not bend:
 *
 * **The file is read, never written.** fathohm writes exactly one path in its
 * whole life — `map --out` — and it is named on the command line. Nothing here
 * creates, migrates or "initialises" a config.
 *
 * **It is looked for at the target repository root, and nowhere else.** No
 * walking up to `$HOME`. A tool that silently inherited a `max-blind` from a
 * directory above the one you are standing in would produce a verdict you
 * cannot reproduce from what you can see, which is the whole failure mode a
 * gate exists to avoid.
 *
 * **An unknown key warns; it never fails.** A newer fathohm's key must not
 * break an older fathohm's build. But an unknown key is not silently ignored
 * either — silence is how a typo'd `max_blind` gates nothing for a year.
 */

export const CONFIG_FILENAME = ".fathohm.toml";

/** The keys fathohm reads. Everything else warns. */
const KNOWN_KEYS = ["max-blind", "exclude", "horizon"] as const;

export interface FathohmConfig {
  /** `max-blind` — the share of the repo `check` will tolerate below the line. */
  readonly maxBlind: number | null;
  /** `exclude` — globs whose files leave the reading's denominator entirely. */
  readonly exclude: readonly string[];
  /** `horizon` — how far ahead a fade crossing is looked for, in whole days. */
  readonly horizonDays: number | null;
}

export interface LoadedConfig {
  readonly config: FathohmConfig;
  /** One line per unknown key. The caller prints them to stderr. */
  readonly warnings: readonly string[];
  /** The file this came from, or null when there was none. */
  readonly source: string | null;
}

export const EMPTY_CONFIG: FathohmConfig = {
  maxBlind: null,
  exclude: [],
  horizonDays: null,
};

/**
 * The config for a repository, or the empty one.
 *
 * A missing file is the overwhelmingly common case and is not an event: no
 * warning, no note on the card. An UNREADABLE file is the opposite — somebody
 * wrote a config and fathohm is about to ignore it — so that is a usage error
 * with the path in it.
 */
export function loadConfig(repoDir: string): LoadedConfig {
  const file = path.join(repoDir, CONFIG_FILENAME);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return { config: EMPTY_CONFIG, warnings: [], source: null };
    throw new CliError(
      EXIT.usage,
      `${CONFIG_FILENAME} could not be read — ${describe(error)}`,
      `fathohm reads ${file} and never writes it; remove it, or make it readable.`,
    );
  }
  return parseConfig(text, CONFIG_FILENAME);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The parser, split out so the whole grammar is testable without a filesystem. */
export function parseConfig(text: string, source: string): LoadedConfig {
  const warnings: string[] = [];
  const seen = new Set<string>();
  let maxBlind: number | null = null;
  let exclude: readonly string[] = [];
  let horizonDays: number | null = null;

  // The BOM is stripped rather than tolerated: an editor that writes one would
  // otherwise turn the first key into `﻿max-blind`, which reads as an
  // unknown key — a warning nobody could explain from looking at the file.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("[")) {
      throw grammarError(
        source,
        lineNumber,
        trimmed,
        "fathohm's TOML subset has no tables",
      );
    }

    const equals = trimmed.indexOf("=");
    if (equals === -1) {
      throw grammarError(source, lineNumber, trimmed, "every line is `key = value`");
    }

    const key = trimmed.slice(0, equals).trim();
    if (key === "") {
      throw grammarError(source, lineNumber, trimmed, "the key is missing");
    }
    if (key.includes(".")) {
      throw grammarError(
        source,
        lineNumber,
        trimmed,
        "fathohm's TOML subset has no dotted keys",
      );
    }
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw grammarError(
        source,
        lineNumber,
        trimmed,
        "a key is letters, digits, `-` and `_`",
      );
    }
    if (seen.has(key)) {
      throw grammarError(source, lineNumber, trimmed, `\`${key}\` was already set above`);
    }
    seen.add(key);

    const value = parseValue(trimmed.slice(equals + 1), source, lineNumber, trimmed);

    switch (key) {
      case "max-blind":
        maxBlind = readMaxBlind(value, source, lineNumber, trimmed);
        break;
      case "exclude":
        exclude = readExclude(value, source, lineNumber, trimmed);
        break;
      case "horizon":
        horizonDays = readHorizon(value, source, lineNumber, trimmed);
        break;
      default:
        warnings.push(
          `${source}:${lineNumber}: unknown key \`${key}\` — fathohm reads ` +
            `${KNOWN_KEYS.join(", ")}. Left alone.`,
        );
    }
  }

  return { config: { maxBlind, exclude, horizonDays }, warnings, source };
}

/** The four shapes a value can take. Anything else is a grammar error. */
type ConfigValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "array"; value: string[] };

function parseValue(
  text: string,
  source: string,
  lineNumber: number,
  line: string,
): ConfigValue {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw grammarError(source, lineNumber, line, "the value is missing");
  }

  if (trimmed.startsWith('"')) {
    const read = readString(trimmed, 0, source, lineNumber, line);
    requireOnlyComment(trimmed.slice(read.end), source, lineNumber, line);
    return { kind: "string", value: read.value };
  }

  if (trimmed.startsWith("[")) {
    return readArray(trimmed, source, lineNumber, line);
  }

  const bare = stripComment(trimmed).trim();
  if (bare === "true") return { kind: "boolean", value: true };
  if (bare === "false") return { kind: "boolean", value: false };
  if (/^[+-]?\d+(?:\.\d+)?$/.test(bare)) return { kind: "number", value: Number(bare) };

  throw grammarError(
    source,
    lineNumber,
    line,
    "a value is a quoted string, a number, `true`/`false`, or a one-line array of quoted strings",
  );
}

/**
 * A basic TOML string, from the opening quote to the closing one.
 *
 * Two escapes, `\"` and `\\`, and no others. Multi-line strings, literal
 * strings and the `\uXXXX` family are all out: an exclude glob has no use for
 * them, and every escape a parser accepts is an escape it can get wrong on a
 * path that decides what is in the denominator.
 */
function readString(
  text: string,
  start: number,
  source: string,
  lineNumber: number,
  line: string,
): { value: string; end: number } {
  let value = "";
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      const next = text[index + 1];
      if (next !== '"' && next !== "\\") {
        throw grammarError(
          source,
          lineNumber,
          line,
          'the only escapes are `\\"` and `\\\\`',
        );
      }
      value += next;
      index += 2;
      continue;
    }
    if (character === '"') return { value, end: index + 1 };
    value += character;
    index += 1;
  }
  throw grammarError(source, lineNumber, line, "the string is missing its closing quote");
}

function readArray(
  text: string,
  source: string,
  lineNumber: number,
  line: string,
): ConfigValue {
  const items: string[] = [];
  let index = 1;
  let expectingItem = true;

  while (index < text.length) {
    const character = text[index];
    if (character === " " || character === "\t") {
      index += 1;
      continue;
    }
    if (character === "]") {
      requireOnlyComment(text.slice(index + 1), source, lineNumber, line);
      return { kind: "array", value: items };
    }
    if (character === ",") {
      if (expectingItem) {
        throw grammarError(source, lineNumber, line, "an empty slot between commas");
      }
      expectingItem = true;
      index += 1;
      continue;
    }
    if (character === '"') {
      if (!expectingItem) {
        throw grammarError(source, lineNumber, line, "two values with no comma between them");
      }
      const read = readString(text, index, source, lineNumber, line);
      items.push(read.value);
      expectingItem = false;
      index = read.end;
      continue;
    }
    throw grammarError(source, lineNumber, line, "an array holds quoted strings only");
  }

  throw grammarError(
    source,
    lineNumber,
    line,
    "an array must open and close on one line",
  );
}

/** Everything after a value: whitespace, then nothing or a `#` comment. */
function requireOnlyComment(
  rest: string,
  source: string,
  lineNumber: number,
  line: string,
): void {
  const trimmed = rest.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return;
  throw grammarError(source, lineNumber, line, "there is more on the line than one value");
}

/** A trailing comment on a bare value — safe here because bare values hold no
 *  `#` of their own (a `#` inside a string is handled by the string reader). */
function stripComment(text: string): string {
  const hash = text.indexOf("#");
  return hash === -1 ? text : text.slice(0, hash);
}

function readMaxBlind(
  value: ConfigValue,
  source: string,
  lineNumber: number,
  line: string,
): number {
  if (value.kind !== "number") {
    throw typeError(source, lineNumber, line, "max-blind", "a number between 0 and 100");
  }
  const percent = parsePercent(String(value.value));
  if (percent === null) {
    throw typeError(source, lineNumber, line, "max-blind", "a number between 0 and 100");
  }
  return percent;
}

function readExclude(
  value: ConfigValue,
  source: string,
  lineNumber: number,
  line: string,
): string[] {
  if (value.kind !== "array") {
    throw typeError(source, lineNumber, line, "exclude", "an array of quoted globs");
  }
  for (const item of value.value) {
    if (item.trim() === "") {
      throw typeError(source, lineNumber, line, "exclude", "globs that are not empty");
    }
  }
  return value.value;
}

/**
 * `horizon`, through the SAME parser `--horizon` uses. A config that accepted
 * `"3 months"` where the flag rejects it would be two products, and the one
 * people would find out about is the one in CI.
 */
function readHorizon(
  value: ConfigValue,
  source: string,
  lineNumber: number,
  line: string,
): number {
  const raw =
    value.kind === "string"
      ? value.value
      : value.kind === "number"
        ? String(value.value)
        : null;
  const days = raw === null ? null : parseDurationDays(raw);
  if (days === null) {
    throw typeError(source, lineNumber, line, "horizon", 'a day count, like "90d"');
  }
  return days;
}

/**
 * Every config failure names the line it is on, quotes it back, and states the
 * documented subset. A config error is read in a CI log by somebody who cannot
 * see the file, which is the whole reason the line comes with the message.
 */
function grammarError(
  source: string,
  lineNumber: number,
  line: string,
  detail: string,
): CliError {
  return new CliError(
    EXIT.usage,
    `${source}:${lineNumber}: ${detail} — got \`${line}\``,
    "fathohm reads a TOML SUBSET: top-level `key = value` only, where a value is a " +
      'quoted string, a number, `true`/`false`, or a one-line array of quoted strings. ' +
      "`#` starts a comment.",
  );
}

function typeError(
  source: string,
  lineNumber: number,
  line: string,
  key: string,
  expected: string,
): CliError {
  return new CliError(
    EXIT.usage,
    `${source}:${lineNumber}: \`${key}\` takes ${expected} — got \`${line}\``,
    `fathohm reads ${KNOWN_KEYS.join(", ")}; every other key is left alone with a warning.`,
  );
}
