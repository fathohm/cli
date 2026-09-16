import path from "node:path";

import { helpText, parseArgs, type CliInvocation, type CliFlags } from "./cmd/args";
import { checkExit, evaluateCheck, requireThreshold } from "./reading/check";
import { loadConfig } from "./cmd/config";
import { CliError, EXIT, reportFailure, type ExitCode } from "./cmd/errors";
import { eventCollector, type CliEvent } from "./repo/events";
import { extractRepo, type RepoExtract } from "./repo/extract";
import { runSelector, type MountSelector } from "./interactive";
import { resolveMapTarget, writeMapFile } from "./render/map";
import { offboardReading } from "./reading/offboard";
import { paydownReading } from "./reading/paydown";
import { darkRows } from "./render/below";
import { renderCard } from "./render/card";
import { renderCheck, renderCheckMarkdown } from "./render/check";
import { renderExplain, selectFile } from "./render/explain";
import { crossingFiles, renderFade } from "./render/fade";
import { renderMapNote, renderMapPage } from "./render/html-map";
import {
  checkDocument,
  explainDocument,
  fadeDocument,
  offboardDocument,
  paydownDocument,
  readDocument,
  serializeJson,
  teamDocument,
  validateJson,
  type JsonDocument,
} from "./render/json";
import { renderOffboard } from "./render/offboard";
import { renderPaydown } from "./render/paydown";
import { renderTeam } from "./render/team";
import { teamReading } from "./reading/team";
import type { RenderMeta } from "./render/meta";
import {
  DEFAULT_HORIZON_DAYS,
  isDegenerate,
  readingEvents,
  refClock,
  scoreRepo,
  type RepoReading,
} from "./reading/scoring";
import { interactiveAllowed } from "./tty/selector";
import { createTerm, type EnvLike, type Term } from "./render/term";
import { tideSeries, type TideSeries } from "./reading/tide";
import { SCORER_VERSION, versionLine } from "./version";

/**
 * Every byte the CLI emits goes through this handle. Nothing below reaches for
 * `process.stdout` directly, which is what lets the golden-file tests run the
 * whole binary in-process and compare bytes.
 */
export interface CliIo {
  readonly stdout: (chunk: string) => void;
  readonly stderr: (chunk: string) => void;
  readonly env: EnvLike;
  readonly isTTY: boolean;
  readonly columns?: number;
  readonly cwd: string;
  /**
   * Whether STDIN is a terminal — the second half of the interactive gate, and
   * optional so that its default is the non-interactive program. A caller that
   * does not say is a caller with nobody at a keyboard, which is the only safe
   * assumption a determinism contract can make.
   */
  readonly stdinIsTTY?: boolean;
  /**
   * Where the picker mounts. Injected only so the gates can be exercised end
   * to end from a test runner, which cannot supply a raw-mode terminal; the
   * real binary uses {@link runSelector}.
   */
  readonly mountSelector?: MountSelector;
}

export interface CommandContext {
  readonly io: CliIo;
  readonly term: Term;
}

export function processIo(): CliIo {
  return {
    stdout: (chunk) => {
      process.stdout.write(chunk);
    },
    stderr: (chunk) => {
      process.stderr.write(chunk);
    },
    env: process.env,
    isTTY: process.stdout.isTTY === true,
    stdinIsTTY: process.stdin.isTTY === true,
    columns: process.stdout.columns,
    cwd: process.cwd(),
  };
}

export async function main(
  argv: readonly string[],
  io: CliIo = processIo(),
): Promise<ExitCode> {
  // `--debug` has to be readable before the parser runs: a parser crash is
  // exactly the case where the stack is wanted.
  let debug = argv.includes("--debug");
  try {
    const invocation = parseArgs(argv);
    debug = invocation.flags.debug;

    if (invocation.flags.version) {
      io.stdout(`${versionLine()}\n`);
      return EXIT.ok;
    }

    if (invocation.flags.help) {
      io.stdout(`${helpText(invocation.explicitCommand ? invocation.command : null)}\n`);
      return EXIT.ok;
    }

    const term = createTerm({
      noColor: invocation.flags.noColor,
      ascii: invocation.flags.ascii,
      ground: invocation.flags.ground,
      env: io.env,
      isTTY: io.isTTY,
      columns: io.columns,
    });

    return await runCommand(invocation, { io, term });
  } catch (error) {
    return reportFailure(error, { debug, stderr: io.stderr });
  }
}

/**
 * The dispatch seam, and the ONE place a reading is composed.
 *
 * Extraction, config, scoring and the tide happen here; the renderers below
 * take data and return `string[]` (or, for the map, one HTML string). That
 * split is not tidiness — it is what makes the golden-file tests hermetic: a
 * card is a pure function of (reading, tide, term, meta), so a test can hand it
 * a fixture and compare bytes without a git repository, a clock, or a terminal
 * anywhere in the picture.
 *
 * `--json` composes rather than branching the program: every command computes
 * the same reading and then chooses a serialiser. A `--json` path that took a
 * different route to its numbers would eventually print different numbers.
 */
async function runCommand(
  invocation: CliInvocation,
  context: CommandContext,
): Promise<ExitCode> {
  const { io, term } = context;
  const { flags } = invocation;

  // The wall clock is read HERE, once, and threaded through everything below.
  // Nothing downstream calls `Date.now()`: a reading is a function of (repo
  // state, now, flags), and a renderer that consulted its own clock could not
  // be replayed, diffed or golden-tested. `--now` and `--at` are the only two
  // other things that set it.
  const wallClock = new Date();

  // `explain`'s positional is the FILE, so its repository is the working
  // directory. Every other command's positional is the repository itself.
  // Either way this is only WHERE TO START LOOKING — one hand-off into
  // extraction, and one subject comes back out of it for both.
  const repoDir =
    invocation.command === "explain" ? io.cwd : path.resolve(io.cwd, invocation.target);

  // Extraction first, config second: "this is not a git repository" is a more
  // useful thing to hear than a complaint about a config file in a directory
  // that was never going to be read anyway.
  //
  // And after extraction the subject is `extract.root`, never `repoDir` again.
  // git walks up from wherever it is started, so what was just read is the
  // whole REPOSITORY however deep the caller was standing — the pointed-at
  // directory only ever said where to start looking. Deriving anything else
  // from it splits one reading into two subjects: `read .` inside `cli/` would
  // head the card "cli" over the repository's file count, and — the serious
  // half — `check --max-blind` in CI, invoked from a subdirectory, would look
  // for `.fathohm.toml` beside itself, not find the root's, and gate on a
  // threshold and an exclude list nobody wrote. Silently, and green.
  // PROBE → CONFIG → WALK, and the sink is where that ordering is expressed.
  //
  // The config has to be loaded before the history is walked, because `exclude`
  // decides which paths an event carries and events are now built as commits
  // stream past rather than from a retained array. But the config is found from
  // the repository ROOT, which is what the probe at the top of `extractRepo`
  // discovers. So the sink is a factory: `extractRepo` calls it once, after the
  // root is known and before the first commit, and gets back the consumer.
  let loaded: ReturnType<typeof loadConfig> | null = null;
  const raw = await extractRepo<CliEvent>(repoDir, {
    atRef: flags.at,
    since: flags.since,
    sink: (root) => {
      loaded = loadConfig(root);
      return eventCollector(loaded.config.exclude);
    },
  });
  // Non-null by construction: the sink is called for every repository, empty
  // ones included, precisely so this cannot be conditional.
  const { config, warnings } = loaded as unknown as ReturnType<typeof loadConfig>;
  // Warnings go to stderr, always — stdout carries the reading, and a `--json`
  // consumer must never have to parse around a note about a typo'd key.
  for (const warning of warnings) io.stderr(`warning: ${warning}\n`);
  // A filename can carry a terminal escape. Everything below renders from
  // `extract`, so this is the one place it is made printable; JSON escapes its own.
  const extract = flags.json ? raw : printableExtract(raw);

  const now = resolveNow(flags, extract, wallClock);
  // The flag beats the file, everywhere. A config is a team's default; a flag
  // is this invocation's instruction, and an instruction that loses to a file
  // is not an instruction.
  const horizonDays = flags.horizonDays ?? config.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const exclude = config.exclude;
  // `--scope` is a flag and never a config key. An exclusion is a standing fact
  // about what the codebase IS and belongs in a file the whole team shares; a
  // subtree is one question one person is asking this once, and a file that
  // could silently narrow every reading in a repository is the config that
  // makes a gate green for a year.
  const scope = flags.scope;
  // One options object, threaded everywhere a reading is taken. `offboard` and
  // `team` re-run the scorer with one more name in `without`, and a second
  // literal here would be the two runs quietly disagreeing about the clock, the
  // horizon or the exclusions the first one used.
  const scoreOpts = { now, without: flags.without, horizonDays, exclude, scope };
  const reading = scoreRepo(extract, scoreOpts);
  requireScopedFiles(reading, scope);

  const repoName =
    path.basename(extract.root) === "" ? extract.root : path.basename(extract.root);

  const meta: RenderMeta = {
    // The header names what was actually read. A filesystem root has no
    // basename, so it keeps its own path rather than being called "".
    //
    // A SCOPED READING NAMES THE SUBTREE, not the repository. Every header on
    // every command is built from this string, so naming the repo over a
    // subtree's numbers would put the wrong subject on six cards at once —
    // and the denominator sentence under the header would be arguing with the
    // line above it.
    target: scope === null ? repoName : `${repoName}/${scope}`,
    quiet: flags.quiet,
    full: flags.full,
    horizonDays,
    scorerVersion: SCORER_VERSION,
  };
  const document = { reading, meta };

  if (invocation.command === "explain") {
    const file = selectFromCwd(reading, io.cwd, raw.root, invocation.target);
    return flags.json
      ? emitJson(io, explainDocument(document, file))
      : emit(io, renderExplain(reading, file, term, meta));
  }

  if (invocation.command === "fade") {
    return flags.json
      ? emitJson(io, fadeDocument(document, crossingFiles(reading)))
      : emit(io, renderFade(reading, term, meta));
  }

  if (invocation.command === "check") {
    const verdict = evaluateCheck(reading, {
      maxBlind: requireThreshold(flags.maxBlind, config.maxBlind),
      pessimistic: flags.pessimistic,
    });
    // Three renderings, ONE verdict — computed above, before anything chooses a
    // format. A gate whose exit code depended on which form was asked for
    // would be three gates wearing one name.
    if (flags.json) emitJson(io, checkDocument(document, verdict));
    else if (flags.format === "markdown") emit(io, renderCheckMarkdown(reading, verdict, meta));
    else emit(io, renderCheck(reading, verdict, term, meta));
    // The exit code is the command's real output. It is identical either way:
    // a gate that passed in text and failed in JSON would be two gates.
    return checkExit(verdict);
  }

  // The two people-shaped commands. Both take the reading already computed
  // above as their BEFORE — the repository as it stands, carrying whatever
  // `--without` baseline the caller asked for — and re-run the same scorer for
  // the after. Neither draws the tide: a strip of the past under a card about a
  // hypothetical future would be two clocks on one screen.
  if (invocation.command === "offboard") {
    const off = offboardReading(extract, scoreOpts, invocation.author ?? "", reading);
    return flags.json
      ? emitJson(io, offboardDocument(document, off))
      : emit(io, renderOffboard(off, term, meta));
  }

  if (invocation.command === "team") {
    const roster = teamReading(extract, scoreOpts, reading, { full: flags.full });
    return flags.json
      ? emitJson(io, teamDocument(document, roster))
      : emit(io, renderTeam(roster, term, meta));
  }

  // The ladder. It takes the reading and nothing else — no second scorer run,
  // because a rung changes a FACTOR rather than the history, which is also what
  // makes a `--without` baseline compose for free. The limit is read the same
  // way `check` reads it (flag over file) but never demanded: `check` needs a
  // threshold to have a verdict, and the ladder only gains a line from one.
  if (invocation.command === "paydown") {
    const paydown = paydownReading(reading, {
      maxBlind: flags.maxBlind ?? config.maxBlind,
      pessimistic: flags.pessimistic,
    });
    return flags.json
      ? emitJson(io, paydownDocument(document, paydown))
      : emit(io, renderPaydown(paydown, term, meta));
  }

  // Sixteen full readings is the most expensive thing a reading does, so the
  // strip is computed only where it is actually shown: not under `--quiet`,
  // not on a degenerate repository, and not for the map's HTML (which draws
  // the tree, not the tide) unless `--json` is going to carry it.
  const wantsTide =
    invocation.command === "map" ? flags.json : flags.json || !flags.quiet;
  const tide: TideSeries | null =
    !wantsTide || isDegenerate(reading)
      ? null
      : tideSeries(readingEvents(extract, flags.without).events, extract.tree, {
          now,
          forecastDays: horizonDays,
          exclude,
          // The strip draws the same file set the card counted — under a scope
          // as under an exclusion. A trend over the repository beneath a
          // headline about one directory would be two readings on one screen.
          scope,
        });

  if (invocation.command === "map") {
    const target = resolveMapTarget(io.cwd, flags.out);
    const bytes = writeMapFile(target, renderMapPage(reading, meta));
    return flags.json
      ? emitJson(io, readDocument(document, tide, { command: "map", out: target }))
      : emit(io, renderMapNote(reading, target, bytes, term, meta));
  }

  if (flags.json) return emitJson(io, readDocument(document, tide));

  const code = emit(io, renderCard(reading, tide, term, meta));
  // AFTER the card, never instead of it. The reading is on the terminal and in
  // the scrollback before a single byte of the picker is written, so a person
  // who quits — or whose terminal was never eligible — has exactly the output
  // this command has always produced. The exit code is the reading's, and the
  // picker does not get a vote.
  await offerPicker(invocation, context, reading, meta);
  return code;
}

/**
 * The picker, if every gate passes — and byte-for-byte nothing if any one of
 * them does not.
 *
 * The gate is a pure function in `selector.ts` so that it can be enumerated by
 * a test; this is the wiring that hands it the facts. Note what it is given:
 * the rows the card actually printed, not a fresh query. The list under the
 * card is the section above it, or it is a second list that will one day
 * disagree with the first.
 */
async function offerPicker(
  invocation: CliInvocation,
  context: CommandContext,
  reading: RepoReading,
  meta: RenderMeta,
): Promise<void> {
  const { io, term } = context;
  const { flags } = invocation;
  const rows = darkRows(reading, term);

  const allowed = interactiveAllowed({
    command: invocation.command,
    stdoutIsTTY: io.isTTY,
    stdinIsTTY: io.stdinIsTTY === true,
    json: flags.json,
    full: flags.full,
    quiet: flags.quiet,
    noInteractive: flags.noInteractive,
    env: io.env,
    rowCount: rows.length,
  });
  if (!allowed) return;

  const mount = io.mountSelector ?? runSelector;
  await mount({
    rows: rows.map((row) => ({ path: row.file.path, body: row.body })),
    term,
    write: io.stdout,
    explain: (path) => renderExplain(reading, selectFile(reading, path), term, meta),
  });
}

/**
 * `--scope <dir>` that named nothing: a usage error, never a reading.
 *
 * A mistyped directory would otherwise produce the honest-looking card an
 * empty repository gets — "nothing to fathom here yet", exit 0 — which is a
 * true sentence about the wrong subject and reads as good news. The same
 * reasoning `--without` follows: a filter that silently removes everything is
 * worse than one that fails, because the reader believes the answer.
 *
 * The exit code is 2 rather than 3: nothing about the repository could not be
 * read, the invocation named a directory that has no code in it.
 */
function requireScopedFiles(reading: RepoReading, scope: string | null): void {
  if (scope === null || reading.files.length > 0) return;
  throw new CliError(
    EXIT.usage,
    `--scope ${scope}: no code files under ${scope}/ in this reading`,
    "check the path (it is read from the repository root, not from where you are " +
      "standing), and remember `.fathohm.toml`'s `exclude` applies inside it too.",
  );
}

/**
 * The clock, in precedence order: an explicit `--now`, then `--at`'s own
 * commit date, then the wall.
 *
 * `--at <ref>` moves the history AND the clock. Scoring last year's tree
 * against today's date would report a year of decay that had not happened
 * yet — the past has to read as the past read, which is the whole retroactivity
 * claim. An explicit `--now` still wins: a caller who names both is asking a
 * deliberate question ("how did that ref look from here?").
 */
function resolveNow(flags: CliFlags, extract: RepoExtract<CliEvent>, wallClock: Date): Date {
  if (flags.now !== null) return new Date(flags.now);
  if (flags.at !== null) {
    const clock = refClock(extract);
    if (clock !== null) return clock;
  }
  return wallClock;
}

/** `explain <path>` relative to where the caller stands, then `selectFile`'s ladder. */
function selectFromCwd(reading: RepoReading, cwd: string, root: string, target: string) {
  const rel = path.relative(root, path.resolve(cwd, target)).split(path.sep).join("/");
  if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const hit = reading.files.find((file) => file.path === rel);
    if (hit !== undefined) return hit;
  }
  return selectFile(reading, target);
}

// C0, DEL and C1: the bytes a terminal acts on instead of printing.
// eslint-disable-next-line no-control-regex
const CONTROL = /[ --]/;
// eslint-disable-next-line no-control-regex
const CONTROL_ALL = /[ --]/g;

/** Visible and near-injective (`\x1b`), so two paths never merge into one row. */
function printable(text: string): string {
  return CONTROL.test(text)
    ? text.replace(CONTROL_ALL, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
    : text;
}

/** Copies only what needs it: the common repository allocates two arrays. */
function printableExtract(extract: RepoExtract<CliEvent>): RepoExtract<CliEvent> {
  return {
    ...extract,
    root: printable(extract.root),
    history: extract.history.map((event) =>
      CONTROL.test(event.actorId + event.actorName + event.actorEmail + event.paths.join(""))
        ? {
            ...event,
            actorId: printable(event.actorId),
            actorName: printable(event.actorName),
            actorEmail: printable(event.actorEmail),
            paths: event.paths.map(printable),
          }
        : event,
    ),
    tree: extract.tree.map((entry) =>
      CONTROL.test(entry.path) ? { ...entry, path: printable(entry.path) } : entry,
    ),
  };
}

/** One write, one trailing newline. Renderers never touch the stream. */
function emit(io: CliIo, lines: readonly string[]): ExitCode {
  io.stdout(`${lines.join("\n")}\n`);
  return EXIT.ok;
}

/**
 * The `--json` write, validated against the published schema on the way out.
 *
 * A document that does not match the schema is a bug in fathohm, and the place
 * to find it is here — not in the CI pipeline of somebody who built on the
 * shape six weeks ago.
 */
function emitJson(io: CliIo, document: JsonDocument): ExitCode {
  io.stdout(`${serializeJson(validateJson(document))}\n`);
  return EXIT.ok;
}

// Run only when this file IS the process entry (the bundled binary, or
// `tsx cli/src/index.ts`). The `typeof` guards keep the module importable from
// a test runner that does not provide the CommonJS wrapper.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
