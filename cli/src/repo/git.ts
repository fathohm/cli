import { execFile, spawn } from "node:child_process";
import { statSync } from "node:fs";

import { CliError, EXIT } from "../cmd/errors";

/**
 * The only way fathohm talks to a repository: `git`, spawned directly, never
 * through a shell. There is no other reader in the CLI — no `fs.readFile` of
 * anything inside the target tree — so "we never read your source" is a
 * property of this file's surface area, not a promise in a README.
 *
 * Every failure here becomes a `CliError(3)`: the tool could not read the repo
 * honestly. Exit 3 is neither a pass nor a failure, and each error owes the
 * reader the same three things — the git command that failed, what fathohm
 * needed from it, and one next step.
 */

/**
 * A gigabyte. The buffered path (`rev-parse`, `ls-tree`) is bounded by the
 * repository's *file count*, not its history, so it fits in memory; the log —
 * the unbounded one — goes through `streamGit` instead and is never buffered.
 */
export const GIT_MAX_BUFFER = 1024 * 1024 * 1024;

/**
 * Config the reading refuses to inherit from the machine it runs on. A user's
 * `~/.gitconfig` must not be able to change what fathohm reports: mailmap
 * rewrites authors, `log.showSignature` injects verification prose into the
 * middle of the pretty format, `core.quotePath` re-encodes non-ASCII paths.
 * These are `-c` overrides rather than a scrubbed `GIT_CONFIG_GLOBAL` on
 * purpose — clearing global config would also clear `safe.directory`, which
 * plenty of CI containers genuinely need.
 */
const HERMETIC_CONFIG: readonly string[] = [
  "-c",
  "core.quotePath=false",
  "-c",
  "i18n.logOutputEncoding=UTF-8",
  "-c",
  "log.mailmap=false",
  "-c",
  "log.showSignature=false",
  "-c",
  "diff.renames=false",
];

/**
 * The variables git may inherit, and nothing else.
 *
 * The whole environment used to pass through, and it cost two things: a hook's
 * `GIT_DIR` made fathohm read the HOOK's repository under the target's name,
 * and every API key on the machine rode along to a child process. The first is
 * the serious one — none of the four read-only subcommands fathohm runs can
 * transmit or execute anything (no fetch, no patch generation, so no
 * `GIT_EXTERNAL_DIFF`/textconv, no pager, no hooks), but a `GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_NAMESPACE` or `GIT_CONFIG_PARAMETERS`
 * inherited from whatever invoked fathohm silently changes WHICH repository or
 * history gets reported. A wrong number presented as true is the failure this
 * product cannot have. None of them is named below, so none of them arrives.
 *
 * What survives is the narrowest set that keeps a reading honest:
 *   PATH                   — finding the user's git. With no PATH the C library
 *                            falls back to `/usr/bin:/bin`, which on a Homebrew
 *                            or nvm machine is a DIFFERENT git than the one the
 *                            user's own `git log` runs.
 *   HOME, XDG_CONFIG_HOME  — where `~/.gitconfig` lives, which is the only way
 *   GIT_CONFIG_GLOBAL        git can see the `safe.directory` a CI container
 *   GIT_CONFIG_SYSTEM        needs in order to read the repo at all. These can
 *   GIT_CONFIG_NOSYSTEM      point git at a config FILE; they cannot point it
 *                            at another repository, and HERMETIC_CONFIG's `-c`
 *                            overrides beat anything such a file says.
 *   the Windows block      — a process there needs its own startup variables,
 *                            and git synthesises HOME from USERPROFILE or
 *                            HOMEDRIVE+HOMEPATH. UNPROVEN: nobody here can run
 *                            Windows, so the list is kept wide deliberately. A
 *                            missing name fails loudly (exit 3, "could not be
 *                            started"); a spare one costs nothing but audit
 *                            surface. It is pruned when a Windows CI job can
 *                            prove each drop.
 *
 * Dropped after being tested rather than reasoned about: `TZ` (every timestamp
 * fathohm passes git carries an explicit offset — see `isoValue` — and `%aI`
 * returns the commit's own, so no reading moves with the zone), `GIT_EXEC_PATH`
 * and `TMPDIR` (all four subcommands are builtins that write no temp file, and
 * both pointed at nothing changes nothing).
 */
export const INHERITED_ENV_NAMES: readonly string[] = [
  "PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  // Windows.
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PROGRAMDATA",
  "TEMP",
  "TMP",
];

/**
 * `GIT_CONFIG_COUNT=N` + `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`: how CI
 * runners hand git a `safe.directory` without touching a config file.
 *
 * The count names the pairs, so they are looked up BY NAME rather than found by
 * scanning. Reading them out of `Object.entries(process.env)` copied only these
 * — and still had to walk every variable on the machine to do it, which is
 * indistinguishable from harvesting to anything auditing the published bundle,
 * and was reported as exactly that against 1.6.1.
 */
const GIT_CONFIG_PAIR_LIMIT = 1000;

function inheritGitConfigPairs(env: Record<string, string>): void {
  const declared = process.env.GIT_CONFIG_COUNT;
  if (declared === undefined) return;
  const count = Number.parseInt(declared, 10);
  if (!Number.isInteger(count) || count <= 0) return;
  env.GIT_CONFIG_COUNT = declared;
  // git itself refuses a count it cannot walk; the cap is only so a junk value
  // cannot turn a read into a million lookups.
  for (let index = 0; index < Math.min(count, GIT_CONFIG_PAIR_LIMIT); index += 1) {
    for (const name of [`GIT_CONFIG_KEY_${index}`, `GIT_CONFIG_VALUE_${index}`]) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
  }
}

/**
 * The environment every spawn gets. `LC_ALL=C` keeps git's *diagnostics*
 * predictable (fathohm never parses them, but it does quote them back at the
 * user); `GIT_OPTIONAL_LOCKS=0` keeps a read from touching the index; the two
 * terminal variables stop git from ever blocking a CI job on a prompt or a
 * pager.
 */
function gitEnv(): NodeJS.ProcessEnv {
  // Spelled out one property at a time rather than looped over
  // INHERITED_ENV_NAMES: the published bundle is read as TEXT by whoever is
  // deciding whether to install this, and `process.env[name]` inside a loop
  // reads as "takes whatever is there". `git.test.ts` pins the two in
  // agreement, so the list above stays the documentation of this function.
  const source: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    SYSTEMROOT: process.env.SYSTEMROOT,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    WINDIR: process.env.WINDIR,
    COMSPEC: process.env.COMSPEC,
    PATHEXT: process.env.PATHEXT,
    PROGRAMDATA: process.env.PROGRAMDATA,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined) env[name] = value;
  }
  inheritGitConfigPairs(env);
  env.LC_ALL = "C";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_PAGER = "cat";
  env.GIT_TERMINAL_PROMPT = "0";
  return env as NodeJS.ProcessEnv;
}

/**
 * The `hint:` line, or a function that composes it from what git said on
 * stderr. The function form exists because one command can fail for reasons
 * that need different next steps — a `git log` that fails because this git is
 * too old to understand a flag wants "upgrade git", not "look at your
 * history" — and only git's own complaint can tell them apart.
 */
export type GitHint = string | ((stderr: string) => string);

export interface RunGitOptions {
  readonly maxBuffer?: number;
  /** What the caller needed from this command, in the reader's words. */
  readonly expected?: string;
  /** The one next step, printed as the `hint:` line. */
  readonly hint?: GitHint;
}

export interface GitOutcome {
  readonly stdout: Buffer;
  readonly stderr: string;
  /** The process exit status. Non-zero is data here, not an exception. */
  readonly code: number;
}

/**
 * Runs git and hands back the exit status *as a value*. Callers that treat a
 * non-zero status as information (a ref that does not resolve is a fact about
 * the repo, not a crash) use this; callers that need the output use `runGit`.
 *
 * Only two things throw: git not being on PATH at all, and output that blows
 * past `maxBuffer` — neither is a status code.
 */
export function runGitOutcome(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<GitOutcome> {
  const maxBuffer = options.maxBuffer ?? GIT_MAX_BUFFER;
  return new Promise((resolve, reject) => {
    // ENOTDIR (a cwd that is a file) throws synchronously.
    try {
    execFile(
      "git",
      [...HERMETIC_CONFIG, ...args],
      { cwd, encoding: "buffer", maxBuffer, env: gitEnv(), windowsHide: true },
      (error, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
        const err = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : "";
        if (error === null) {
          resolve({ stdout: out, stderr: err, code: 0 });
          return;
        }
        const spawnError = error as NodeJS.ErrnoException & {
          code?: number | string;
        };
        if (spawnError.code === "ENOENT") {
          reject(spawnFailed(cwd, args));
          return;
        }
        if (typeof spawnError.code === "number") {
          resolve({ stdout: out, stderr: err, code: spawnError.code });
          return;
        }
        reject(spawnCrashed(cwd, args, error, options));
      },
    );
    } catch {
      reject(spawnFailed(cwd, args));
    }
  });
}

/**
 * Runs git and returns stdout, turning any non-zero status into the exit-3
 * error block. `Promise<Buffer>` and not `Promise<string>` because paths are
 * byte strings: decoding is the parser's decision, not the runner's.
 */
export async function runGit(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<Buffer> {
  const outcome = await runGitOutcome(cwd, args, options);
  if (outcome.code !== 0) {
    throw gitFailed(cwd, args, outcome.code, outcome.stderr, options);
  }
  return outcome.stdout;
}

export interface StreamGitOptions extends RunGitOptions {
  /** Called with each stdout chunk, in order. Throwing aborts the read. */
  readonly onStdout: (chunk: Buffer) => void;
}

/**
 * Runs git and feeds stdout to `onStdout` as it arrives. The commit log of a
 * large repository is hundreds of megabytes of text that fathohm reduces to a
 * few numbers per path — buffering it whole would make peak memory a function
 * of history length, which is exactly the budget the perf gate defends.
 */
export function streamGit(
  cwd: string,
  args: readonly string[],
  options: StreamGitOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = (() => {
      try {
        return spawn("git", [...HERMETIC_CONFIG, ...args], {
          cwd,
          env: gitEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch {
        return null;
      }
    })();
    if (child === null) {
      reject(spawnFailed(cwd, args));
      return;
    }

    // Bounded: a repository that fails loudly must not be able to make
    // fathohm's own memory the next problem.
    const stderrParts: string[] = [];
    let stderrLength = 0;
    let consumerError: unknown = null;
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      fail(error.code === "ENOENT" ? spawnFailed(cwd, args) : spawnCrashed(cwd, args, error, options));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrLength >= 64 * 1024) return;
      stderrLength += chunk.length;
      stderrParts.push(chunk.toString("utf8"));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (consumerError !== null) return;
      try {
        options.onStdout(chunk);
      } catch (error) {
        consumerError = error;
        child.kill("SIGTERM");
      }
    });

    child.on("close", (code, signal) => {
      if (consumerError !== null) {
        fail(consumerError);
        return;
      }
      if (code === 0) {
        if (settled) return;
        settled = true;
        resolve();
        return;
      }
      fail(
        gitFailed(
          cwd,
          args,
          code ?? -1,
          stderrParts.join(""),
          options,
          signal ?? undefined,
        ),
      );
    });
  });
}

/**
 * The command as the *user* can re-run it. The hermetic `-c` prefix is
 * deliberately not shown: it never changes whether git succeeds, and thirteen
 * tokens of fathohm's own hygiene between the reader and the failing command
 * would bury the thing they need to see.
 */
export function gitCommandLine(args: readonly string[]): string {
  return `git ${args.join(" ")}`;
}

function firstStderrLine(stderr: string): string {
  const line = stderr
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line ?? "";
}

/**
 * `ENOENT` from a spawn has TWO causes and the error has to tell them apart.
 *
 * Node reports the same code whether the BINARY could not be found or the
 * WORKING DIRECTORY could not be entered, and the difference is the whole
 * message: one of them means "install git", the other means "that directory
 * is not there". Reported as the first when it was the second, the tool tells
 * somebody whose git is working perfectly to go install git — and they will
 * believe it, because the tool is the thing that would know.
 *
 * This is not hypothetical. It cost three wrong turns during the dark index's
 * own build, on a machine where `git --version` answered instantly the whole
 * time, and it will land on the first person who types a directory name wrong
 * after `npx fathohm read`.
 *
 * The cwd is checked rather than assumed: a readable directory that still
 * ENOENTs really is a missing git, and saying so remains correct.
 */
function spawnFailed(cwd: string, args: readonly string[]): CliError {
  let directoryReadable = false;
  try {
    directoryReadable = statSync(cwd).isDirectory();
  } catch {
    directoryReadable = false;
  }
  if (!directoryReadable) {
    return new CliError(
      EXIT.cannotRead,
      `\`${gitCommandLine(args)}\` could not be started — expected \`${cwd}\` to be a directory fathohm can enter, and it is not one.`,
      `check the path — \`ls ${cwd}\` — and re-run fathohm against a directory that exists. (git itself is fine; this is the directory, not the tool.)`,
    );
  }
  return gitMissing(args);
}

function gitMissing(args: readonly string[]): CliError {
  return new CliError(
    EXIT.cannotRead,
    `\`${gitCommandLine(args)}\` could not be started — expected a runnable git, and there is no \`git\` on PATH.`,
    "install git (or add it to PATH) and re-run — fathohm reads a repository through git and has no other source.",
  );
}

/** Resolves the caller's hint against what git said. */
function hintFor(options: RunGitOptions, stderr: string): string | undefined {
  return typeof options.hint === "function"
    ? options.hint(stderr)
    : options.hint;
}

function spawnCrashed(
  cwd: string,
  args: readonly string[],
  error: Error,
  options: RunGitOptions,
): CliError {
  const expected = options.expected ?? "output from git";
  return new CliError(
    EXIT.cannotRead,
    `\`${gitCommandLine(args)}\` could not be completed in ${cwd} — expected ${expected}, got ${error.message}.`,
    hintFor(options, "") ??
      `re-run \`${gitCommandLine(args)}\` in ${cwd} yourself; fathohm reports what git reports.`,
  );
}

function gitFailed(
  cwd: string,
  args: readonly string[],
  code: number,
  stderr: string,
  options: RunGitOptions,
  signal?: NodeJS.Signals,
): CliError {
  const expected = options.expected ?? "output from git";
  const said = firstStderrLine(stderr);
  const ending =
    signal !== undefined ? `was killed by ${signal}` : `exited ${code}`;
  const message =
    `\`${gitCommandLine(args)}\` ${ending} in ${cwd} — expected ${expected}.` +
    (said === "" ? "" : ` git said: ${said}`);
  return new CliError(
    EXIT.cannotRead,
    message,
    hintFor(options, stderr) ??
      `run \`${gitCommandLine(args)}\` in ${cwd} to see the failure in full, then re-run fathohm.`,
  );
}
