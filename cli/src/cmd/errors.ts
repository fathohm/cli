/**
 * The exit-code contract. CI gates read these, so they are a published
 * interface: never renumber, only extend.
 *
 * 0 the reading completed / the check passed
 * 1 the check failed (an honest, contestable-by-nobody failure)
 * 2 usage — the invocation itself was wrong
 * 3 cannot read honestly (no git, not a repo, truncated history). Never a
 *   pass and never a failure: indeterminate is its own answer.
 * 4 internal — a bug in fathohm
 */
export const EXIT = {
  ok: 0,
  checkFailed: 1,
  usage: 2,
  cannotRead: 3,
  internal: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * An error the user is meant to read and act on. Every throw site owes the
 * reader three things: what failed, what was expected, and one next step —
 * the hint is the next step, and it is not optional in spirit even though the
 * type allows omitting it for the rare self-evident case.
 */
export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly hint: string | undefined;

  constructor(exitCode: ExitCode, message: string, hint?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

export interface FormattedFailure {
  readonly text: string;
  readonly exitCode: ExitCode;
}

/**
 * Renders a thrown value into the stderr block and the exit code that goes
 * with it. Stack traces appear only under `--debug`: a stack in a CI log is
 * noise for everyone who is not debugging fathohm itself.
 */
export function formatFailure(
  error: unknown,
  options: { readonly debug: boolean },
): FormattedFailure {
  const cliError = isCliError(error) ? error : null;
  const exitCode: ExitCode = cliError ? cliError.exitCode : EXIT.internal;

  const message = cliError
    ? cliError.message
    : `internal failure: ${describeUnknown(error)}`;
  const hint = cliError
    ? cliError.hint
    : "this is a bug in fathohm — re-run with --debug for the stack trace.";

  const lines = [`error: ${message}`];
  if (hint !== undefined && hint !== "") lines.push(`hint: ${hint}`);
  if (options.debug) {
    const stack = error instanceof Error ? error.stack : undefined;
    if (stack !== undefined && stack !== "") lines.push(stack);
  }

  return { text: `${lines.join("\n")}\n`, exitCode };
}

/**
 * Writes the failure block to stderr and returns the exit code. Failures never
 * touch stdout — a piped `--json` reading stays parseable even when the run
 * dies halfway.
 */
export function reportFailure(
  error: unknown,
  options: { readonly debug: boolean; readonly stderr: (chunk: string) => void },
): ExitCode {
  const formatted = formatFailure(error, { debug: options.debug });
  options.stderr(formatted.text);
  return formatted.exitCode;
}

function describeUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
