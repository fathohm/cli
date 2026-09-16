import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  editDistance,
  helpText,
  nearestMatch,
  parseArgs,
  type CliFlags,
  type CliInvocation,
} from "./args";
import { CliError, EXIT, isCliError } from "./errors";
import { MIN_WIDTH } from "../render/term";

function parse(argv: string[]): CliInvocation {
  return parseArgs(argv);
}

function failure(argv: string[]): CliError {
  try {
    parseArgs(argv);
  } catch (error) {
    if (isCliError(error)) return error;
    throw error;
  }
  throw new Error(`expected \`fathohm ${argv.join(" ")}\` to be a usage error`);
}

describe("commands and targets", () => {
  const cases: Array<{
    name: string;
    argv: string[];
    command: CliInvocation["command"];
    target: string;
    explicit: boolean;
  }> = [
    { name: "bare invocation reads the working directory", argv: [], command: "read", target: ".", explicit: false },
    { name: "a bare path reads that path", argv: ["../other-repo"], command: "read", target: "../other-repo", explicit: false },
    { name: "a plain directory name is a path, not a command", argv: ["packages/api"], command: "read", target: "packages/api", explicit: false },
    { name: "read is namable", argv: ["read"], command: "read", target: ".", explicit: true },
    { name: "read takes a path", argv: ["read", "src"], command: "read", target: "src", explicit: true },
    { name: "explain takes the file it explains", argv: ["explain", "lib/scorer.ts"], command: "explain", target: "lib/scorer.ts", explicit: true },
    { name: "fade defaults to the working directory", argv: ["fade"], command: "fade", target: ".", explicit: true },
    { name: "check defaults to the working directory", argv: ["check"], command: "check", target: ".", explicit: true },
    { name: "map defaults to the working directory", argv: ["map"], command: "map", target: ".", explicit: true },
    { name: "flags may precede the command", argv: ["--json", "check"], command: "check", target: ".", explicit: true },
    { name: "everything after -- is a path", argv: ["read", "--", "--weird-dir"], command: "read", target: "--weird-dir", explicit: true },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const invocation = parse(testCase.argv);
      expect(invocation.command).toBe(testCase.command);
      expect(invocation.target).toBe(testCase.target);
      expect(invocation.explicitCommand).toBe(testCase.explicit);
    });
  }
});

describe("flags", () => {
  const cases: Array<{ name: string; argv: string[]; expected: Partial<CliFlags> }> = [
    { name: "--now", argv: ["--now", "2026-07-31T00:00:00Z"], expected: { now: "2026-07-31T00:00:00Z" } },
    { name: "--now=", argv: ["--now=2026-07-31T00:00:00Z"], expected: { now: "2026-07-31T00:00:00Z" } },
    { name: "--since", argv: ["--since", "2026-01-01"], expected: { since: "2026-01-01T00:00:00Z" } },
    { name: "--json", argv: ["--json"], expected: { json: true } },
    { name: "--no-color", argv: ["--no-color"], expected: { noColor: true } },
    { name: "--ascii", argv: ["--ascii"], expected: { ascii: true } },
    { name: "--quiet", argv: ["--quiet"], expected: { quiet: true } },
    { name: "--debug", argv: ["--debug"], expected: { debug: true } },
    { name: "--help", argv: ["--help"], expected: { help: true } },
    { name: "-h", argv: ["-h"], expected: { help: true } },
    { name: "--version", argv: ["--version"], expected: { version: true } },
    { name: "-V", argv: ["-V"], expected: { version: true } },
    { name: "read --at", argv: ["read", "--at", "v1.2.0"], expected: { at: "v1.2.0" } },
    { name: "read --full", argv: ["read", "--full"], expected: { full: true } },
    { name: "read --without", argv: ["read", "--without", "ada@example.com"], expected: { without: ["ada@example.com"] } },
    {
      name: "--without is repeatable — removing two people is two removals",
      argv: ["read", "--without", "ada@example.com", "--without", "Grace Hopper"],
      expected: { without: ["ada@example.com", "Grace Hopper"] },
    },
    { name: "fade --horizon 90d", argv: ["fade", "--horizon", "90d"], expected: { horizonDays: 90 } },
    { name: "fade --horizon 30", argv: ["fade", "--horizon", "30"], expected: { horizonDays: 30 } },
    { name: "check --max-blind", argv: ["check", "--max-blind", "40"], expected: { maxBlind: 40 } },
    { name: "check --max-blind with a percent sign", argv: ["check", "--max-blind=40%"], expected: { maxBlind: 40 } },
    { name: "check --max-blind accepts a fraction of a point", argv: ["check", "--max-blind", "12.5"], expected: { maxBlind: 12.5 } },
    { name: "check --pessimistic", argv: ["check", "--pessimistic"], expected: { pessimistic: true } },
    { name: "map --out", argv: ["map", "--out", "reading.html"], expected: { out: "reading.html" } },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const { flags } = parse(testCase.argv);
      for (const [key, value] of Object.entries(testCase.expected)) {
        expect({ [key]: flags[key as keyof CliFlags] }).toEqual({ [key]: value });
      }
    });
  }

  it("defaults every flag to off/absent", () => {
    expect(parse([]).flags).toEqual({
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
    });
  });

  it("takes the globals on every command", () => {
    for (const command of COMMANDS) {
      // The two commands with a required positional get one; the flags under
      // test are the globals, and a usage error would be measuring the parser's
      // arity instead.
      const positional =
        command === "explain" ? ["a.ts"] : command === "offboard" ? ["ada"] : [];
      const argv = [command, ...positional, "--json", "--ascii"];
      const { flags } = parse(argv);
      expect(flags.json).toBe(true);
      expect(flags.ascii).toBe(true);
    }
  });
});

describe("usage errors", () => {
  const cases: Array<{
    name: string;
    argv: string[];
    message: RegExp;
    hint: RegExp;
  }> = [
    {
      name: "a mistyped command suggests the nearest one",
      argv: ["raed"],
      message: /unknown command: raed/,
      hint: /fathohm read/,
    },
    {
      name: "a mistyped command two edits away still suggests",
      argv: ["chekc"],
      message: /unknown command: chekc/,
      hint: /fathohm check/,
    },
    {
      name: "a mistyped flag suggests the nearest one",
      argv: ["--acsii"],
      message: /unknown flag for `read`: --acsii/,
      hint: /--ascii/,
    },
    {
      name: "a flag from another command says where it lives",
      argv: ["read", "--pessimistic"],
      message: /unknown flag for `read`: --pessimistic/,
      hint: /fathohm check/,
    },
    {
      name: "a flag nobody has offers the command's help instead of a guess",
      argv: ["read", "--velocity"],
      message: /unknown flag for `read`: --velocity/,
      hint: /fathohm read --help/,
    },
    {
      name: "--format takes the two forms it documents, and says so",
      argv: ["check", "--format", "html", "--max-blind", "40"],
      message: /--format expects text or markdown, got "html"/,
      hint: /--json/,
    },
    {
      name: "--json and --format together is a question, not a preference",
      argv: ["check", "--json", "--format", "markdown", "--max-blind", "40"],
      message: /--json or --format, not both/,
      hint: /Pick the one you meant/,
    },
    {
      name: "check refuses a subtree, and says what each command is for",
      argv: ["check", "--scope", "lib", "--max-blind", "40"],
      message: /a gate is a contract about the whole repository/,
      hint: /fathohm read --scope <dir>/,
    },
    {
      name: "--scope will not resolve a path that means nothing here",
      argv: ["read", "--scope", "/etc"],
      message: /--scope expects a directory inside the repository, got "\/etc"/,
      hint: /from the repository root/,
    },
    {
      name: "a value flag with nothing after it names what it wanted",
      argv: ["--now"],
      message: /--now expects <iso>/,
      hint: /--now=<iso>/,
    },
    {
      name: "a value flag followed by another flag is a forgotten value",
      argv: ["--now", "--json"],
      message: /--now expects <iso>/,
      hint: /--now <iso>/,
    },
    {
      name: "--now must be a timestamp",
      argv: ["--now", "tomorrow"],
      message: /--now expects an ISO timestamp with a timezone \(Z or ±HH:MM\), got "tomorrow"/,
      hint: /2026-07-31T00:00:00Z/,
    },
    {
      name: "--since must be a timestamp",
      argv: ["--since=last-tuesday"],
      message: /--since expects an ISO timestamp/,
      hint: /2026-07-31T00:00:00Z/,
    },
    {
      name: "--horizon must be days",
      argv: ["fade", "--horizon", "3 months"],
      message: /--horizon expects a positive number of days, got "3 months"/,
      hint: /90d/,
    },
    {
      name: "--now must name its timezone",
      argv: ["--now", "2026-09-15T00:00:00"],
      message: /--now expects an ISO timestamp with a timezone/,
      hint: /2026-07-31T00:00:00Z/,
    },
    {
      name: "--now is ISO, not whatever Date.parse accepts",
      argv: ["--now", "Sep 15 2026"],
      message: /--now expects an ISO timestamp/,
      hint: /2026-07-31T00:00:00Z/,
    },
    {
      name: "--horizon has a ceiling",
      argv: ["fade", "--horizon", "99999999999"],
      message: /--horizon expects a positive number of days/,
      hint: /at most 36500d/,
    },
    {
      name: "--horizon must be positive",
      argv: ["fade", "--horizon", "0"],
      message: /--horizon expects a positive number of days/,
      hint: /90d/,
    },
    {
      name: "--max-blind must be a percentage",
      argv: ["check", "--max-blind", "140"],
      message: /--max-blind expects a percentage between 0 and 100, got "140"/,
      hint: /below the line/,
    },
    {
      name: "--max-blind rejects words",
      argv: ["check", "--max-blind", "loads"],
      message: /--max-blind expects a percentage between 0 and 100/,
      hint: /--max-blind 40/,
    },
    {
      name: "explain without a path says so",
      argv: ["explain"],
      message: /explain needs a file path/,
      hint: /fathohm explain path\/to\/file\.ts/,
    },
    {
      name: "explain reads one file at a time",
      argv: ["explain", "a.ts", "b.ts"],
      message: /explain reads one file at a time, got 2/,
      hint: /once per path/,
    },
    {
      name: "two repositories is a mistake, not a batch",
      argv: ["read", "one", "two"],
      message: /read takes at most one path, got 2/,
      hint: /one repository at a time/,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const error = failure(testCase.argv);
      // Every usage failure is exit 2 and every one of them offers a next step.
      expect(error.exitCode).toBe(EXIT.usage);
      expect(error.message).toMatch(testCase.message);
      expect(error.hint ?? "").toMatch(testCase.hint);
    });
  }

  it("never suggests a command that is more than two edits away", () => {
    // `status` is a git verb, not a fathohm one — treated as a path, and the
    // extraction layer will say honestly that it cannot read it.
    expect(parse(["status"]).command).toBe("read");
    expect(parse(["status"]).target).toBe("status");
  });
});

describe("--version and --help short-circuit", () => {
  it("--version wins over everything, including a broken invocation", () => {
    expect(parse(["--version", "--bogus"]).flags.version).toBe(true);
    expect(parse(["explain", "--version"]).flags.version).toBe(true);
  });

  it("--help does not require the arguments the command would otherwise need", () => {
    const invocation = parse(["explain", "--help"]);
    expect(invocation.flags.help).toBe(true);
    expect(invocation.command).toBe("explain");
  });

  it("--help still refuses a flag that does not exist", () => {
    expect(failure(["read", "--halp", "--help"]).exitCode).toBe(EXIT.usage);
  });
});

describe("helpText", () => {
  it("lists every command and every global flag at the root", () => {
    const text = helpText(null);
    for (const command of COMMANDS) expect(text).toContain(command);
    for (const flag of ["--now", "--since", "--json", "--no-color", "--ascii", "--quiet", "--debug", "--version", "--help"]) {
      expect(text).toContain(flag);
    }
    // The exit-code contract belongs in the help: it is what CI users need.
    for (const code of ["0", "1", "2", "3", "4"]) expect(text).toContain(`  ${code}  `);
  });

  it("shows a command only the flags that command accepts", () => {
    const read = helpText("read");
    expect(read).toContain("--at");
    expect(read).toContain("--full");
    expect(read).not.toContain("--pessimistic");
    expect(read).not.toContain("--max-blind");

    const check = helpText("check");
    expect(check).toContain("--max-blind");
    expect(check).toContain("--pessimistic");
    expect(check).not.toContain("--at");
  });

  it("documents every flag the parser accepts — help and parser share one table", () => {
    // A flag that parses but is undocumented is a trap; this holds because the
    // usage text is generated from the parser's own table.
    const everywhere = COMMANDS.map((command) => helpText(command)).join("\n");
    for (const flag of ["--at", "--without", "--full", "--horizon", "--max-blind", "--pessimistic", "--out"]) {
      expect(everywhere).toContain(flag);
    }
  });

  it("states what it reads and what it never does, on EVERY screen", () => {
    // Not just the root screen. The person who evaluates `fathohm check` in a
    // CI config reads `fathohm check --help` and nothing else, and these are
    // the three facts that decide whether the tool is installable at all.
    for (const text of [helpText(null), ...COMMANDS.map((command) => helpText(command))]) {
      expect(text).toContain("Reads git metadata only");
      expect(text).toContain("never your file contents");
      expect(text).toContain("Opens no network connection");
    }
    // `map` writes the one file it was asked for, and says so instead of
    // being quietly excused from the sentence.
    expect(helpText("map")).toContain("writes only");
    expect(helpText("map")).toContain("the one file you name");
    for (const command of ["read", "explain", "fade", "check"] as const) {
      expect(helpText(command)).toContain("writes nothing.");
    }
  });

  it("documents the row number `explain` accepts, at the root and on the command", () => {
    // A shorthand nobody is told about is a shorthand nobody uses, and the
    // root screen is the only one most readers open.
    expect(helpText(null)).toContain("a row number");
    const explain = helpText("explain");
    expect(explain).toContain("fathohm explain <path|n>");
    expect(explain).toContain("`fathohm explain 3`");
    expect(explain).toContain("A real path always wins first.");
  });

  it("gives paydown the two flags that let it name the reader's own gate", () => {
    // The limit is optional here and required on `check`: a gate needs a
    // threshold to have a verdict, and the ladder only gains a line from one.
    const paydown = helpText("paydown");
    expect(paydown).toContain("fathohm paydown [path] [options]");
    expect(paydown).toContain("--max-blind");
    expect(paydown).toContain("--pessimistic");
    expect(paydown).toContain("--without");
    expect(paydown).toContain("--full");
    expect(paydown).not.toContain("--horizon");
    expect(paydown).toContain("writes nothing.");
  });

  it("sends a misplaced --max-blind to both commands that own it", () => {
    expect(failure(["read", "--max-blind", "40"]).hint).toContain("fathohm paydown");
  });

  it("describes `--full` as the card actually behaves", () => {
    // The card carries no file list at all, so "not just the top" described a
    // surface nobody gets.
    const read = helpText("read");
    expect(read).toContain("every dark path");
    expect(read).not.toContain("not just the top");
  });

  it("fits the 80-column floor — help must read the same in any terminal", () => {
    const texts = [helpText(null), ...COMMANDS.map((command) => helpText(command))];
    for (const text of texts) {
      for (const line of text.split("\n")) {
        expect({ line, length: [...line].length }).toEqual({
          line,
          length: Math.min([...line].length, MIN_WIDTH),
        });
      }
    }
  });
});

describe("nearestMatch", () => {
  it("measures edits", () => {
    expect(editDistance("read", "read")).toBe(0);
    expect(editDistance("raed", "read")).toBe(2);
    expect(editDistance("", "map")).toBe(3);
  });

  it("returns null past the threshold", () => {
    expect(nearestMatch("status", COMMANDS, 2)).toBeNull();
  });

  it("breaks ties deterministically (distance, then length, then order)", () => {
    expect(nearestMatch("ap", ["map", "gap"], 1)).toBe("gap");
    expect(nearestMatch("ap", ["cap", "gap"], 1)).toBe("cap");
    expect(nearestMatch("mapp", ["map", "maps"], 1)).toBe("map");
  });
});
