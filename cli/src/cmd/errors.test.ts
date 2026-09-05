import { describe, expect, it } from "vitest";
import { CliError, EXIT, formatFailure, isCliError, reportFailure } from "./errors";

describe("EXIT", () => {
  // CI pipelines branch on these numbers; they are a published interface.
  it("pins the exit-code contract", () => {
    expect(EXIT).toEqual({ ok: 0, checkFailed: 1, usage: 2, cannotRead: 3, internal: 4 });
  });
});

describe("CliError", () => {
  it("is an Error carrying its exit code and hint", () => {
    const error = new CliError(EXIT.cannotRead, "not a git repository", "run `git init` first.");
    expect(error).toBeInstanceOf(Error);
    expect(isCliError(error)).toBe(true);
    expect(error.exitCode).toBe(EXIT.cannotRead);
    expect(error.message).toBe("not a git repository");
    expect(error.hint).toBe("run `git init` first.");
  });

  it("does not mistake a plain Error for a CliError", () => {
    expect(isCliError(new Error("boom"))).toBe(false);
  });
});

describe("formatFailure", () => {
  const cases = [
    {
      name: "prints the message and the hint on their own lines",
      error: new CliError(EXIT.usage, "unknown flag: --nope", "did you mean `--now`?"),
      debug: false,
      exitCode: EXIT.usage,
      text: "error: unknown flag: --nope\nhint: did you mean `--now`?\n",
    },
    {
      name: "omits the hint line when there is no next step to offer",
      error: new CliError(EXIT.checkFailed, "the check failed"),
      debug: false,
      exitCode: EXIT.checkFailed,
      text: "error: the check failed\n",
    },
    {
      name: "treats an unexpected throw as internal",
      error: new Error("cannot read property of undefined"),
      debug: false,
      exitCode: EXIT.internal,
      text:
        "error: internal failure: cannot read property of undefined\n" +
        "hint: this is a bug in fathohm — re-run with --debug for the stack trace.\n",
    },
    {
      name: "survives a thrown non-Error",
      error: "a string, somehow",
      debug: false,
      exitCode: EXIT.internal,
      text:
        "error: internal failure: a string, somehow\n" +
        "hint: this is a bug in fathohm — re-run with --debug for the stack trace.\n",
    },
  ] as const;

  for (const testCase of cases) {
    it(testCase.name, () => {
      const formatted = formatFailure(testCase.error, { debug: testCase.debug });
      expect(formatted.exitCode).toBe(testCase.exitCode);
      expect(formatted.text).toBe(testCase.text);
    });
  }

  it("keeps stack traces out of the output unless --debug asked for them", () => {
    const error = new CliError(EXIT.usage, "unknown flag: --nope", "did you mean `--now`?");
    const quiet = formatFailure(error, { debug: false });
    const loud = formatFailure(error, { debug: true });

    expect(quiet.text).not.toContain("errors.test.ts");
    expect(loud.text.startsWith(quiet.text.trimEnd())).toBe(true);
    expect(loud.text).toContain("errors.test.ts");
    expect(loud.exitCode).toBe(quiet.exitCode);
  });

  it("always ends in exactly one newline", () => {
    for (const testCase of cases) {
      const { text } = formatFailure(testCase.error, { debug: false });
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
    }
  });
});

describe("reportFailure", () => {
  it("writes the block to stderr and returns the code", () => {
    const written: string[] = [];
    const code = reportFailure(new CliError(EXIT.cannotRead, "no git on PATH", "install git."), {
      debug: false,
      stderr: (chunk) => written.push(chunk),
    });

    expect(code).toBe(EXIT.cannotRead);
    expect(written.join("")).toBe("error: no git on PATH\nhint: install git.\n");
  });
});
