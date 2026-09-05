import { DARK_WINDOW_DAYS } from "../reading/dark";
import type { Ground } from "../render/term";
import { CliError, EXIT } from "./errors";

/**
 * The argument surface, hand-rolled (zero runtime dependencies).
 *
 * The flag table below is the single source of truth for BOTH parsing and
 * `--help`: the usage text is generated from the same rows the parser
 * validates against, so documented and accepted can never drift apart.
 */

export const COMMANDS = [
  "read",
  "explain",
  "fade",
  "check",
  "map",
  "offboard",
  "team",
  "paydown",
] as const;
export type Command = (typeof COMMANDS)[number];

export const DEFAULT_COMMAND: Command = "read";

/**
 * `check --format`. Two forms and no third: the gate speaks to a terminal or
 * into a pull-request comment, and `--json` already answers the machine.
 */
export const CHECK_FORMATS = ["text", "markdown"] as const;
export type CheckFormat = (typeof CHECK_FORMATS)[number];

/**
 * The commands a subtree reading is offered on.
 *
 * `check` is deliberately absent, and `wrongCommandFlag` says why in words: a
 * gate is a contract about a repository, and one that could be pointed at a
 * clean corner of it would pass a codebase nobody read.
 */
export const SCOPED_COMMANDS: readonly Command[] = [
  "read",
  "explain",
  "fade",
  "team",
  "paydown",
  "offboard",
];

export interface CliFlags {
  /** `--now <iso>`: the instant the repo is read as of. Raw, validated string. */
  readonly now: string | null;
  /** `--since <iso>`: history before this instant is not read at all. */
  readonly since: string | null;
  readonly json: boolean;
  readonly noColor: boolean;
  readonly ascii: boolean;
  /**
   * `--light` / `--dark`: which background the colours are picked for.
   *
   * Null means the reader did not say, which is the usual case — the terminal
   * is asked next (`COLORFGBG`) and dark is the fallback. There is no third
   * state to represent: a ground is a fact about a screen, not a preference
   * with an "auto" setting, and every ink has to resolve to something.
   */
  readonly ground: Ground | null;
  readonly quiet: boolean;
  readonly debug: boolean;
  readonly help: boolean;
  readonly version: boolean;
  /** `read --at <ref>`: read the repo as it stood at a git ref. */
  readonly at: string | null;
  /** `--without <author>`, repeatable. */
  readonly without: readonly string[];
  readonly full: boolean;
  /** `read --no-interactive`: never mount the picker, terminal or not. */
  readonly noInteractive: boolean;
  /** `fade --horizon 90d`, normalized to whole days. */
  readonly horizonDays: number | null;
  /** `check --max-blind <pct>`, 0–100. */
  readonly maxBlind: number | null;
  /** `check --format <text|markdown>`. Null means the terminal form. */
  readonly format: CheckFormat | null;
  /**
   * `--scope <dir>`: read one subtree instead of the repository.
   *
   * Repository-root-relative and already normalized (no `./`, no trailing
   * slash) — a flag that accepted three spellings of one directory would put
   * three different headers over the same reading.
   */
  readonly scope: string | null;
  readonly pessimistic: boolean;
  /** `map --out <file>`. The only path fathohm ever writes. */
  readonly out: string | null;
}

export interface CliInvocation {
  readonly command: Command;
  /** The repository directory, or — for `explain` — the file being explained. */
  readonly target: string;
  /**
   * `offboard <author>`: the person the simulation removes, exactly as typed.
   * Null on every other command — it is a POSITIONAL rather than a flag because
   * it is what the command is about, and `fathohm offboard --without priya`
   * would read as a filter on a question that has not been asked yet.
   */
  readonly author: string | null;
  readonly flags: CliFlags;
  /**
   * Whether the user actually named the command. `fathohm` and `fathohm .` are
   * both `read`, but only the named form should get `read`'s usage text out of
   * `--help`.
   */
  readonly explicitCommand: boolean;
}

type FlagKind = "boolean" | "text" | "iso" | "days" | "percent" | "list";

interface FlagSpec {
  readonly name: string;
  readonly alias?: string;
  readonly kind: FlagKind;
  readonly metavar?: string;
  /** "global" applies to every command; otherwise the commands that take it. */
  readonly scope: "global" | readonly Command[];
  readonly help: string;
}

const FLAGS: readonly FlagSpec[] = [
  {
    name: "now",
    kind: "iso",
    metavar: "<iso>",
    scope: "global",
    help: "read the repo as of this instant (default: now)",
  },
  {
    name: "since",
    kind: "iso",
    metavar: "<iso>",
    scope: "global",
    help: "ignore all history before this instant",
  },
  { name: "json", kind: "boolean", scope: "global", help: "emit the reading as JSON" },
  { name: "no-color", kind: "boolean", scope: "global", help: "never emit ANSI colour" },
  { name: "ascii", kind: "boolean", scope: "global", help: "ASCII-only glyphs" },
  {
    name: "light",
    kind: "boolean",
    scope: "global",
    help: "colours for a light terminal background",
  },
  {
    name: "dark",
    kind: "boolean",
    scope: "global",
    help: "colours for a dark terminal background (the default)",
  },
  { name: "quiet", kind: "boolean", scope: "global", help: "the headline and the provenance, nothing else" },
  { name: "debug", kind: "boolean", scope: "global", help: "print stack traces on failure" },
  {
    name: "version",
    alias: "-V",
    kind: "boolean",
    scope: "global",
    help: "print the CLI and scorer versions",
  },
  {
    name: "help",
    alias: "-h",
    kind: "boolean",
    scope: "global",
    help: "print this, or a command's own usage",
  },
  {
    name: "at",
    kind: "text",
    metavar: "<ref>",
    scope: ["read"],
    help: "read the repo as it stood at a git ref",
  },
  {
    name: "without",
    kind: "list",
    metavar: "<author>",
    // `explain` takes it because the factor table is where a `--without`
    // reading is actually checked: the card says a file crossed, and this is
    // the surface that shows which factor moved and by how much. `offboard`
    // takes it because the two compose — the simulation is then "additionally
    // without this person", with the baseline removed from BOTH readings.
    scope: ["read", "explain", "fade", "check", "offboard", "paydown"],
    help: "read as if this person had never been here (repeatable)",
  },
  {
    name: "full",
    kind: "boolean",
    scope: ["read", "offboard", "team", "paydown"],
    // The reading card carries NO file list — the sections are the argument,
    // and a hundred paths bury them — so on `read` this ADDS one rather than
    // lengthening it. `offboard`, `team` and `paydown` do print a capped list,
    // and there the same flag prints the rest of it. One flag, one promise: the
    // whole list instead of the part that fits.
    help: "the whole list: every dark path, crossing and name",
  },
  {
    name: "no-interactive",
    kind: "boolean",
    scope: ["read"],
    // The picker only ever appears on a terminal with a person at it, so this
    // is not a CI flag — CI is already gated. It is for the person whose
    // terminal is a terminal and who still wants the card and nothing else.
    help: "never offer the picker under the card",
  },
  {
    name: "horizon",
    kind: "days",
    metavar: "<days>",
    scope: ["fade"],
    help: "how far ahead to look for crossings (default: 90d)",
  },
  {
    name: "max-blind",
    kind: "percent",
    metavar: "<pct>",
    // `paydown` takes it because the ladder can then say which rung the
    // reader's OWN gate starts passing at — one line, answered through
    // `check`'s own comparison. It stays required on `check` and optional
    // here: a gate needs a limit, a ladder only gains one.
    scope: ["check", "paydown"],
    help: "how much of the repo may sit below the line (0–100)",
  },
  {
    name: "format",
    kind: "text",
    metavar: "<text|markdown>",
    // `check` only. The markdown form is a verdict somebody PASTES — into a
    // pull request, an incident note, a weekly update — while every other
    // command prints a card whose columns are the argument. `--json` is
    // unchanged and stays the machine's form; naming both at once is refused
    // rather than silently resolved.
    scope: ["check"],
    help: "the gate as text (default) or as pasteable markdown",
  },
  {
    name: "scope",
    kind: "text",
    metavar: "<dir>",
    // NOT `check`. See `wrongCommandFlag`, which says why in the error itself
    // rather than in a comment the reader who typed it will never see.
    scope: SCOPED_COMMANDS,
    help: "read one subdirectory — its own denominator",
  },
  {
    name: "pessimistic",
    kind: "boolean",
    scope: ["check", "paydown"],
    help: "measure the limit against the floor, not the ceiling",
  },
  {
    name: "out",
    kind: "text",
    metavar: "<file>",
    scope: ["map"],
    help: "write the treemap here (default: fathohm-map.html)",
  },
];

interface CommandCopy {
  readonly usage: string;
  /** One line in the root command list — kept short enough for 80 columns. */
  readonly blurb: string;
  /** The opening line of the command's own help. */
  readonly summary: string;
}

const COMMAND_HELP: Record<Command, CommandCopy> = {
  read: {
    usage: "fathohm read [path] [options]",
    blurb: "the reading card for a repository (default)",
    summary: "The reading card: what has gone dark, where it is, and the tide.",
  },
  explain: {
    usage: "fathohm explain <path|n> [options]",
    blurb: "one file, factor by factor (a path, or a row number)",
    summary: "One file, factor by factor — what the score is made of, and when it fades.",
  },
  fade: {
    usage: "fathohm fade [path] [options]",
    blurb: "the files that cross the line next",
    summary: "The files that cross the line next, soonest first.",
  },
  check: {
    usage: "fathohm check [path] [options]",
    blurb: "gate a build on the reading",
    summary: "Gate a build on the reading — exits 1 when too much sits below the line.",
  },
  map: {
    usage: "fathohm map [path] [options]",
    blurb: "write a self-contained treemap of the reading",
    summary: "Write a self-contained treemap of the reading — one HTML file, no requests.",
  },
  offboard: {
    usage: "fathohm offboard <author> [path] [options]",
    blurb: "the reading the day one person leaves",
    summary: "The reading the day somebody leaves — the same scorer, run without them.",
  },
  team: {
    usage: "fathohm team [path] [options]",
    blurb: "the humans in this history, and the code with one name on it",
    summary: "The humans in this history, and how much code carries one name.",
  },
  paydown: {
    usage: "fathohm paydown [path] [options]",
    blurb: "what a recorded review would return, rung by rung",
    summary: "What a recorded, commented review would return \u2014 the scorer, run again.",
  },
};

/** Commands whose positional is optional (the repo dir, default `.`). */
const OPTIONAL_TARGET: readonly Command[] = [
  "read",
  "fade",
  "check",
  "map",
  "offboard",
  "team",
  "paydown",
];

/**
 * What a command's positional actually is, where it is not "the repository".
 *
 * `explain` takes a file — or the number of a row the card just printed, which
 * is the only argument on this surface a reader can type without looking
 * anything up. The help says both, because a shorthand nobody is told about is
 * a shorthand nobody uses.
 */
const POSITIONAL_NOTES: Partial<Record<Command, readonly string[]>> = {
  explain: [
    "  <path> is any file in the reading — a full path, or an unambiguous tail.",
    "  <n> is a row of GONE DARK, counting from 1: `fathohm explain 3` is the",
    "  third file that section lists. A real path always wins first.",
    "  NOT the third-BIGGEST: the order is group, then tier, then bytes, so a",
    "  9KB route outranks a 30KB stylesheet. The card prints the rule beside",
    "  the rows.",
  ],
  offboard: [
    "  <author> is a name, an email, or the address they commit from — exactly",
    "  what `--without` matches on. A name that finds nobody says so and leaves",
    "  the reading alone; `fathohm team` lists the names this history has.",
  ],
};

/**
 * WHAT IT READS, AND WHAT IT NEVER DOES — on every help screen, not just the
 * root one.
 *
 * A promise that appears once, at the top level, is a promise the person
 * evaluating `fathohm check` in a CI config never sees. These three facts are
 * the reason this tool is installable inside a company at all — it reads git
 * metadata and not your source, it opens no socket, and it leaves the
 * repository exactly as it found it — so every command states them itself.
 *
 * `map` is the one exception to the third, and it says its own version rather
 * than being quietly excused from the sentence: it writes exactly one file,
 * the one the caller named.
 */
const READS_LINE =
  "Reads git metadata only — messages, authors, dates, paths and blob sizes,";
const NEVER_LINES: readonly string[] = [
  "never your file contents. Opens no network connection and writes nothing.",
];
const MAP_NEVER_LINES: readonly string[] = [
  "never your file contents. Opens no network connection, and writes only",
  "the one file you name.",
];

function promises(command: Command | null): string[] {
  return [READS_LINE, ...(command === "map" ? MAP_NEVER_LINES : NEVER_LINES)];
}

const FLAG_BY_NAME = new Map(FLAGS.map((spec) => [spec.name, spec]));
const FLAG_BY_ALIAS = new Map(
  FLAGS.filter((spec): spec is FlagSpec & { alias: string } => spec.alias !== undefined).map(
    (spec) => [spec.alias, spec],
  ),
);

interface ParsedToken {
  /** The token as typed, for error copy. */
  readonly raw: string;
  /** The long name without dashes, or the alias including its dash. */
  readonly lookup: string;
  readonly value: string | null;
  readonly spec: FlagSpec | null;
}

interface MutableFlags {
  now: string | null;
  since: string | null;
  json: boolean;
  noColor: boolean;
  ascii: boolean;
  ground: Ground | null;
  quiet: boolean;
  debug: boolean;
  help: boolean;
  version: boolean;
  at: string | null;
  without: string[];
  full: boolean;
  noInteractive: boolean;
  horizonDays: number | null;
  maxBlind: number | null;
  format: CheckFormat | null;
  scope: string | null;
  pessimistic: boolean;
  out: string | null;
}

function emptyFlags(): MutableFlags {
  return {
    now: null,
    since: null,
    json: false,
    noColor: false,
    ascii: false,
    ground: null,
    quiet: false,
    debug: false,
    help: false,
    version: false,
    at: null,
    without: [],
    full: false,
    noInteractive: false,
    horizonDays: null,
    maxBlind: null,
    format: null,
    scope: null,
    pessimistic: false,
    out: null,
  };
}

/**
 * Parses `process.argv.slice(2)`.
 *
 * Order matters and is deliberate:
 *   1. `--version` short-circuits everything — it is a contract, not a feature.
 *   2. the command is resolved (a near-miss is a typo; anything else is a path).
 *   3. flags are validated against that command.
 *   4. `--help` short-circuits, so `fathohm explain --help` need not name a file.
 *   5. the positionals are counted.
 */
export function parseArgs(argv: readonly string[]): CliInvocation {
  const { tokens, positionals } = tokenize(argv);

  if (tokens.some((token) => token.spec !== null && token.spec.name === "version")) {
    const flags = emptyFlags();
    flags.version = true;
    return {
      command: DEFAULT_COMMAND,
      target: ".",
      author: null,
      flags: freeze(flags),
      explicitCommand: false,
    };
  }

  const resolved = resolveCommand(positionals[0]);
  const rest = resolved.consumed ? positionals.slice(1) : positionals;

  const flags = emptyFlags();
  for (const token of tokens) applyToken(flags, token, resolved.command);

  if (flags.help) {
    return {
      command: resolved.command,
      target: rest[0] ?? ".",
      author: null,
      flags: freeze(flags),
      explicitCommand: resolved.explicit,
    };
  }

  // TWO FORMATS NAMED AT ONCE IS A QUESTION, NOT A PREFERENCE. Silently
  // letting one win would print a document the caller did not ask for on the
  // one command whose output somebody pastes into an argument — and whichever
  // rule was chosen, half the people who typed both would be surprised by it.
  if (flags.json && flags.format !== null) {
    throw new CliError(
      EXIT.usage,
      "check takes --json or --format, not both",
      "`--json` is the machine-readable document; `--format markdown` is the " +
        "pasteable verdict. Pick the one you meant.",
    );
  }

  return {
    command: resolved.command,
    ...resolvePositionals(resolved.command, rest),
    flags: freeze(flags),
    explicitCommand: resolved.explicit,
  };
}

function tokenize(argv: readonly string[]): {
  tokens: ParsedToken[];
  positionals: string[];
} {
  const tokens: ParsedToken[] = [];
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (onlyPositionals || arg === "-" || !arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      onlyPositionals = true;
      continue;
    }

    const isLong = arg.startsWith("--");
    const equals = arg.indexOf("=");
    const head = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? null : arg.slice(equals + 1);
    const lookup = isLong ? head.slice(2) : head;
    const spec = (isLong ? FLAG_BY_NAME.get(lookup) : FLAG_BY_ALIAS.get(lookup)) ?? null;

    let value = inlineValue;
    if (spec !== null && spec.kind !== "boolean" && value === null) {
      const next = index + 1 < argv.length ? argv[index + 1] : undefined;
      // A value that starts with a dash is almost always a forgotten argument,
      // not a value. `--name=-x` is the escape hatch, and the hint says so.
      if (next === undefined || (next.startsWith("-") && next !== "-")) {
        throw new CliError(
          EXIT.usage,
          `${head} expects ${spec.metavar ?? "<value>"}`,
          `try \`${head} ${spec.metavar ?? "<value>"}\` or \`${head}=${spec.metavar ?? "<value>"}\`.`,
        );
      }
      value = next;
      index += 1;
    }

    tokens.push({ raw: head, lookup, value, spec });
  }

  return { tokens, positionals };
}

function resolveCommand(first: string | undefined): {
  command: Command;
  explicit: boolean;
  consumed: boolean;
} {
  if (first === undefined) {
    return { command: DEFAULT_COMMAND, explicit: false, consumed: false };
  }

  const named = COMMANDS.find((command) => command === first);
  if (named !== undefined) return { command: named, explicit: true, consumed: true };

  // An unrecognized first word is a PATH, not a typo — `fathohm ../other-repo`
  // has to work. Only a word that could not be a path AND is within two edits
  // of a command is treated as a mistyped command.
  if (!looksLikePath(first)) {
    const near = nearestMatch(first, COMMANDS, 2);
    if (near !== null) {
      throw new CliError(
        EXIT.usage,
        `unknown command: ${first}`,
        `did you mean \`fathohm ${near}\`? Run \`fathohm --help\` for the whole surface.`,
      );
    }
  }

  return { command: DEFAULT_COMMAND, explicit: false, consumed: false };
}

function looksLikePath(word: string): boolean {
  return (
    word.includes("/") ||
    word.includes("\\") ||
    word.startsWith(".") ||
    word.startsWith("~")
  );
}

function applyToken(flags: MutableFlags, token: ParsedToken, command: Command): void {
  const spec = token.spec;
  if (spec === null) throw unknownFlag(token, command);
  if (!appliesTo(spec, command)) throw wrongCommandFlag(token, spec, command);

  switch (spec.name) {
    case "now":
      flags.now = isoValue(token, spec);
      return;
    case "since":
      flags.since = isoValue(token, spec);
      return;
    case "json":
      flags.json = true;
      return;
    case "no-color":
      flags.noColor = true;
      return;
    case "ascii":
      flags.ascii = true;
      return;
    // Last one wins rather than erroring on `--light --dark`. Both are pure
    // presentation, neither can produce a wrong reading, and a hard failure on
    // a contradictory pair of display flags costs a run to teach nothing.
    case "light":
      flags.ground = "light";
      return;
    case "dark":
      flags.ground = "dark";
      return;
    case "quiet":
      flags.quiet = true;
      return;
    case "debug":
      flags.debug = true;
      return;
    case "version":
      flags.version = true;
      return;
    case "help":
      flags.help = true;
      return;
    case "at":
      flags.at = textValue(token, spec);
      return;
    case "without":
      flags.without.push(textValue(token, spec));
      return;
    case "full":
      flags.full = true;
      return;
    case "no-interactive":
      flags.noInteractive = true;
      return;
    case "horizon":
      flags.horizonDays = daysValue(token, spec);
      return;
    case "max-blind":
      flags.maxBlind = percentValue(token, spec);
      return;
    case "format":
      flags.format = formatValue(token, spec);
      return;
    case "scope":
      flags.scope = scopeValue(token, spec);
      return;
    case "pessimistic":
      flags.pessimistic = true;
      return;
    case "out":
      flags.out = textValue(token, spec);
      return;
    default:
      throw new CliError(
        EXIT.internal,
        `flag \`${spec.name}\` is declared but not wired up`,
        "this is a bug in fathohm.",
      );
  }
}

function appliesTo(spec: FlagSpec, command: Command): boolean {
  return spec.scope === "global" || spec.scope.includes(command);
}

function unknownFlag(token: ParsedToken, command: Command): CliError {
  const isLong = token.raw.startsWith("--");
  const candidates = FLAGS.flatMap((spec) => {
    if (isLong) return appliesTo(spec, command) ? [`--${spec.name}`] : [];
    return spec.alias === undefined ? [] : [spec.alias];
  });
  // Short flags get one edit of slack, long flags two: on a two-character
  // token, two edits is not a suggestion, it is a guess.
  const near = nearestMatch(token.raw, candidates, isLong ? 2 : 1);
  return new CliError(
    EXIT.usage,
    `unknown flag for \`${command}\`: ${token.raw}`,
    near !== null
      ? `did you mean \`${near}\`?`
      : `run \`fathohm ${command} --help\` for the flags this command takes.`,
  );
}

function wrongCommandFlag(token: ParsedToken, spec: FlagSpec, command: Command): CliError {
  // THE ONE ABSENCE THAT NEEDS A REASON. Every other rejection here is somebody
  // reaching for a flag that lives next door, and naming the neighbour is the
  // whole answer. `check --scope` is somebody asking this command to do
  // something it must not: the exit code is a claim about a repository, and a
  // gate that could be pointed at a tended corner of one would go green over a
  // codebase nobody read. So the error says that, and names the two commands
  // that answer the two questions separately.
  if (spec.name === "scope" && command === "check") {
    return new CliError(
      EXIT.usage,
      "check takes no --scope: a gate is a contract about the whole repository",
      "read a subtree with `fathohm read --scope <dir>`, and gate the repository " +
        "with `fathohm check --max-blind <pct>`.",
    );
  }
  const owners = spec.scope === "global" ? [] : [...spec.scope];
  return new CliError(
    EXIT.usage,
    `unknown flag for \`${command}\`: ${token.raw}`,
    owners.length > 0
      ? `\`--${spec.name}\` belongs to ${owners.map((owner) => `\`fathohm ${owner}\``).join(" and ")}.`
      : `run \`fathohm ${command} --help\` for the flags this command takes.`,
  );
}

function requireValue(token: ParsedToken, spec: FlagSpec): string {
  if (token.value === null || token.value === "") {
    throw new CliError(
      EXIT.usage,
      `${token.raw} expects ${spec.metavar ?? "<value>"}`,
      `try \`${token.raw} ${spec.metavar ?? "<value>"}\`.`,
    );
  }
  return token.value;
}

function textValue(token: ParsedToken, spec: FlagSpec): string {
  return requireValue(token, spec);
}

function isoValue(token: ParsedToken, spec: FlagSpec): string {
  const raw = requireValue(token, spec);
  if (Number.isNaN(Date.parse(raw))) {
    throw new CliError(
      EXIT.usage,
      `${token.raw} expects an ISO timestamp, got "${raw}"`,
      `try \`${token.raw} 2026-07-31T00:00:00Z\`.`,
    );
  }
  return raw;
}

/**
 * `90d`, or `90`, in whole days — or null when it is neither.
 *
 * Exported because `.fathohm.toml`'s `horizon` takes the same value, and it
 * takes it through THIS function. A config that accepted a spelling the flag
 * rejects (or the other way round) would be two products with one name, and
 * the one people would discover the difference in is CI.
 */
export function parseDurationDays(raw: string): number | null {
  const match = /^(\d+)d?$/.exec(raw.trim());
  if (match === null) return null;
  const days = Number.parseInt(match[1], 10);
  return Number.isFinite(days) && days > 0 ? days : null;
}

/** A percentage in 0–100, with an optional `%`, or null. Shared with the
 *  config file's `max-blind` for the same reason as above. */
export function parsePercent(raw: string): number | null {
  const trimmed = raw.trim();
  const body = trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;
  if (body === "") return null;
  const percent = Number(body);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return percent;
}

function daysValue(token: ParsedToken, spec: FlagSpec): number {
  const raw = requireValue(token, spec);
  const days = parseDurationDays(raw);
  if (days === null) {
    throw new CliError(
      EXIT.usage,
      `${token.raw} expects a positive number of days, got "${raw}"`,
      `try \`${token.raw} 90d\`.`,
    );
  }
  return days;
}

function percentValue(token: ParsedToken, spec: FlagSpec): number {
  const raw = requireValue(token, spec);
  const percent = parsePercent(raw);
  if (percent === null) {
    throw new CliError(
      EXIT.usage,
      `${token.raw} expects a percentage between 0 and 100, got "${raw}"`,
      `try \`${token.raw} 40\` — the share of the repo you are willing to leave below the line.`,
    );
  }
  return percent;
}

function formatValue(token: ParsedToken, spec: FlagSpec): CheckFormat {
  const raw = requireValue(token, spec).trim().toLowerCase();
  const found = CHECK_FORMATS.find((format) => format === raw);
  if (found === undefined) {
    throw new CliError(
      EXIT.usage,
      `${token.raw} expects ${CHECK_FORMATS.join(" or ")}, got "${raw}"`,
      `try \`${token.raw} markdown\` — or \`--json\` for the machine-readable form.`,
    );
  }
  return found;
}

/**
 * `--scope <dir>`, normalized to a repository-root-relative directory.
 *
 * Three spellings of one directory (`lib`, `./lib`, `lib/`) become one string,
 * because that string is both printed in the header and compared against tree
 * paths — and a reading whose header spelled the subtree differently than the
 * filter did would be two claims about one number.
 *
 * An absolute path and a `..` segment are refused rather than resolved. Every
 * path in a reading is repository-relative, so neither has a meaning here that
 * is not a guess, and a guess inside a denominator is the one place this tool
 * cannot afford one.
 */
export function parseScopeDir(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (trimmed === "" || trimmed.startsWith("/")) return null;
  const parts = trimmed.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return parts.join("/");
}

function scopeValue(token: ParsedToken, spec: FlagSpec): string {
  const dir = parseScopeDir(requireValue(token, spec));
  if (dir === null) {
    throw new CliError(
      EXIT.usage,
      `${token.raw} expects a directory inside the repository, got "${token.value ?? ""}"`,
      `try \`${token.raw} lib\` — a path from the repository root, never absolute.`,
    );
  }
  return dir;
}

/**
 * The positionals, per command: a repository, a file, or a person and then a
 * repository.
 *
 * `offboard` is the only command that takes two, and the ORDER is the subject
 * first. `fathohm offboard priya` in a repository is the whole invocation
 * anybody types; the directory is the same optional trailing argument every
 * other command takes, and it goes second because the person is what the
 * command is about.
 */
function resolvePositionals(
  command: Command,
  positionals: readonly string[],
): { target: string; author: string | null } {
  if (command === "explain") {
    if (positionals.length === 0) {
      throw new CliError(
        EXIT.usage,
        "explain needs a file path",
        "try `fathohm explain path/to/file.ts` — `fathohm read` lists the deepest paths.",
      );
    }
    if (positionals.length > 1) {
      throw new CliError(
        EXIT.usage,
        `explain reads one file at a time, got ${positionals.length}`,
        "run it once per path.",
      );
    }
    return { target: positionals[0], author: null };
  }

  if (command === "offboard") {
    if (positionals.length === 0) {
      throw new CliError(
        EXIT.usage,
        "offboard needs somebody to remove",
        "try `fathohm offboard ada@example.dev` — `fathohm team` lists the names " +
          "this history has.",
      );
    }
    if (positionals.length > 2) {
      throw new CliError(
        EXIT.usage,
        `offboard takes one person and at most one path, got ${positionals.length} arguments`,
        "run it once per person — `--without` is how you remove more than one at a time.",
      );
    }
    return { target: positionals[1] ?? ".", author: positionals[0] };
  }

  if (positionals.length > 1) {
    throw new CliError(
      EXIT.usage,
      `${command} takes at most one path, got ${positionals.length}`,
      `run \`fathohm ${command} ${positionals[0]}\` — one repository at a time.`,
    );
  }
  return { target: positionals[0] ?? ".", author: null };
}

function freeze(flags: MutableFlags): CliFlags {
  return { ...flags, without: [...flags.without] };
}

/**
 * Levenshtein distance, iterative, two rows. Small inputs (flag names), so the
 * naive version is the right version.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The nearest candidate within `maxDistance`, or null. Ties break by distance,
 * then length, then lexicographically — a suggestion that moved between runs
 * would make the error copy untestable.
 */
export function nearestMatch(
  input: string,
  candidates: readonly string[],
  maxDistance: number,
): string | null {
  let best: { candidate: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance > maxDistance) continue;
    if (best === null || isBetterSuggestion({ candidate, distance }, best)) {
      best = { candidate, distance };
    }
  }
  return best === null ? null : best.candidate;
}

function isBetterSuggestion(
  next: { candidate: string; distance: number },
  best: { candidate: string; distance: number },
): boolean {
  if (next.distance !== best.distance) return next.distance < best.distance;
  if (next.candidate.length !== best.candidate.length) {
    return next.candidate.length < best.candidate.length;
  }
  return next.candidate < best.candidate;
}

/**
 * `--help`. Plain text, no colour, no width dependence: help is the one output
 * that must read the same in every terminal and every CI log.
 */
export function helpText(command: Command | null): string {
  return command === null ? rootHelp() : commandHelp(command);
}

function rootHelp(): string {
  const lines = [
    "FATHOHM — a git-only reading of how much of this codebase no human has",
    `written or prompted in the last ${DARK_WINDOW_DAYS} days.`,
    "",
    "usage",
    "  npx fathohm [command] [path] [options]",
    "",
    "commands",
  ];
  for (const command of COMMANDS) {
    lines.push(`  ${pad(command, 10)}${COMMAND_HELP[command].blurb}`);
  }
  lines.push("", "global options", ...flagLines(globalFlags()));
  lines.push(
    "",
    "configuration (optional)",
    "  .fathohm.toml, read from the repository root and never written:",
    "",
    "    max-blind = 40                 # what `check` will tolerate below the line",
    '    exclude   = ["dist/**"]        # globs that leave the reading entirely',
    '    horizon   = "90d"              # how far ahead to look for crossings',
    "",
    "  A TOML SUBSET: top-level `key = value` only, `#` comments, no tables.",
    "  A command-line flag always beats the file. Unknown keys warn, never fail.",
  );
  lines.push(
    "",
    "exit codes",
    "  0  the reading completed, or the check passed",
    "  1  the check failed",
    "  2  usage",
    "  3  cannot read honestly (no git, not a repo, truncated history)",
    "  4  internal error",
    "",
    ...promises(null),
    "Run `fathohm <command> --help` for a command's own options.",
  );
  return lines.join("\n");
}

function commandHelp(command: Command): string {
  const own = FLAGS.filter((spec) => spec.scope !== "global" && appliesTo(spec, command));
  const lines = [
    COMMAND_HELP[command].summary,
    "",
    "usage",
    `  ${COMMAND_HELP[command].usage}`,
  ];
  if (OPTIONAL_TARGET.includes(command)) {
    lines.push("", "  [path] is the repository to read (default: the working directory).");
  }
  const positional = POSITIONAL_NOTES[command];
  if (positional !== undefined) lines.push("", ...positional);
  if (own.length > 0) lines.push("", `options for \`${command}\``, ...flagLines(own));
  lines.push("", "global options", ...flagLines(globalFlags()));
  lines.push("", ...promises(command));
  return lines.join("\n");
}

function globalFlags(): readonly FlagSpec[] {
  return FLAGS.filter((spec) => spec.scope === "global");
}

function flagLines(specs: readonly FlagSpec[]): string[] {
  return specs.map((spec) => {
    const alias = spec.alias === undefined ? "" : `, ${spec.alias}`;
    const invocation = `--${spec.name}${spec.metavar === undefined ? "" : ` ${spec.metavar}`}${alias}`;
    return `  ${pad(invocation, 22)}${spec.help}`;
  });
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text + " ".repeat(width - text.length);
}
