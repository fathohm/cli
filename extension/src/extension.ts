import * as vscode from "vscode";

import { loadConfig } from "../../cli/src/cmd/config";
import { eventCollector } from "../../cli/src/repo/events";
import { extractRepo } from "../../cli/src/repo/extract";
import { DEFAULT_HORIZON_DAYS, scoreRepo, type RepoReading } from "../../cli/src/reading/scoring";
import {
  explainCommandLine,
  fileInReading,
  fileStatusColor,
  fileStatusText,
  fileTooltip,
  hasReading,
  relativeRepoPath,
  repoStatusColor,
  repoStatusText,
  repoTooltip,
} from "./status";

/**
 * fathohm, in the editor — a thin shell over the CLI's own pipeline.
 *
 * `extractRepo` → `scoreRepo` is the same path `npx fathohm` takes, imported
 * rather than re-implemented, so the number in the status bar and the card in
 * the terminal are one reading. There is no scorer here, no server, and no
 * second opinion about anything.
 *
 * ── THE BRIGHT LINES THIS FILE IS THE ENFORCEMENT POINT FOR ─────────────────
 *
 * **Per FILE, never per line.** No decorations, no gutter icons, no CodeLens,
 * no diagnostics. Per-line colouring would imply a content-level claim the
 * evidence cannot support and would read as blame; GitLens owns per-line, and
 * fathohm owns per-file honesty. A "problems" entry would frame comprehension
 * debt as an error, which is the wrong register for a fact about a record.
 *
 * **No network, no telemetry, no content read.** Extraction opens git and never
 * a blob in the working tree. Nothing in this extension has a socket in it.
 *
 * **Nobody is scored.** No person is named, ranked or counted-against
 * anywhere on either surface.
 *
 * ── THE CLOCK ──────────────────────────────────────────────────────────────
 *
 * Read exactly once, in {@link refresh}, and threaded into `scoreRepo` from
 * there. The reading carries it; the pure helpers in `./status` take it off the
 * reading and never ask the machine. A surface that consulted its own clock
 * could not be reproduced by running the CLI in a terminal next to it.
 */

const EXPLAIN_COMMAND = "fathohm.explainFile";
const MAP_COMMAND = "fathohm.openMap";

/**
 * The hosted Map, handed to the OS to open.
 *
 * `openExternal` is not a network call by this extension: it asks the editor to
 * ask the desktop to open a browser, and the browser — not this process — is
 * what connects. Nothing here has a socket, sends a byte, or learns whether the
 * page loaded. The extension still reads git and only git.
 */
const MAP_URL = "https://fathohm.dev/dashboard";

/**
 * Long enough that a rebase's flurry of HEAD writes costs one reading rather
 * than thirty, short enough that the number is right by the time a person has
 * finished looking away from the checkout they just did.
 */
const DEBOUNCE_MS = 750;

export function activate(context: vscode.ExtensionContext): void {
  const repoItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  repoItem.name = "Fathohm — this repository";
  const fileItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  fileItem.name = "Fathohm — this file";

  let reading: RepoReading | null = null;
  let root: string | null = null;
  let repoName = "";
  let pending: ReturnType<typeof setTimeout> | undefined;
  let watching: vscode.Disposable[] = [];
  let terminal: vscode.Terminal | undefined;

  /** The folder a reading can be taken of: the first one, on disk. A remote or
   *  virtual workspace has no `.git` to read, and saying nothing is the honest
   *  answer to a question this extension cannot ask. */
  function workspace(): vscode.WorkspaceFolder | null {
    const first = vscode.workspace.workspaceFolders?.[0];
    return first !== undefined && first.uri.scheme === "file" ? first : null;
  }

  async function refresh(): Promise<void> {
    const folder = workspace();
    if (folder === null) {
      reading = null;
      root = null;
      render();
      return;
    }

    root = folder.uri.fsPath;
    repoName = folder.name;
    try {
      // The same `.fathohm.toml` the CLI honours. A repository that excluded
      // its generated code from the terminal card and not from the status bar
      // would be two readings of one repository — which is also why `exclude`
      // has to reach the sink, not just the scorer: events are built as the
      // history streams past, so an excluded path is gone before scoring.
      const { config } = loadConfig(root);
      const extract = await extractRepo(root, {
        sink: () => eventCollector(config.exclude),
      });
      // ── THE ONE CALL SITE. Nothing below reads a clock. ──
      const now = new Date();
      reading = scoreRepo(extract, {
        now,
        without: [],
        horizonDays: config.horizonDays ?? DEFAULT_HORIZON_DAYS,
        exclude: config.exclude,
      });
    } catch {
      // Not a git repository, a history git cannot walk, an unreadable config:
      // every one of them means there is no true number to show, and an empty
      // status bar is what that looks like. The CLI is where an error belongs —
      // it can print the command it ran and what git said back.
      reading = null;
    }
    render();
  }

  function render(): void {
    if (reading === null || !hasReading(reading)) {
      repoItem.hide();
      fileItem.hide();
      return;
    }
    repoItem.text = repoStatusText(reading);
    repoItem.color = repoStatusColor(reading);
    repoItem.tooltip = markdown([
      ...repoTooltip(reading, repoName),
      `_click to open the hosted Map at fathohm.dev — where the same reading is drawn per file_`,
    ]);
    repoItem.command = MAP_COMMAND;
    repoItem.show();
    renderFile();
  }

  /**
   * The active-file chip, from the CACHED reading — no recompute on focus. A
   * file the reading did not score has no chip at all: prose, lockfiles,
   * untracked scratch files and anything a config excluded are legitimately
   * outside the denominator, and a number beside them would be about something
   * else.
   */
  function renderFile(): void {
    const current = reading;
    const editor = vscode.window.activeTextEditor;
    if (
      current === null ||
      root === null ||
      editor === undefined ||
      editor.document.uri.scheme !== "file"
    ) {
      fileItem.hide();
      return;
    }

    const relative = relativeRepoPath(root, editor.document.uri.fsPath);
    const file = relative === null ? null : fileInReading(current, relative);
    if (file === null) {
      fileItem.hide();
      return;
    }

    fileItem.text = fileStatusText(current, file);
    fileItem.color = fileStatusColor(file);
    fileItem.tooltip = markdown(fileTooltip(current, file));
    fileItem.command = EXPLAIN_COMMAND;
    fileItem.show();
  }

  /** Untrusted, and never made trusted: a tooltip that could carry a command
   *  link is a tooltip that could run whatever a path happened to spell. */
  function markdown(blocks: readonly string[]): vscode.MarkdownString {
    return new vscode.MarkdownString(blocks.join("\n\n"), false);
  }

  function schedule(): void {
    if (pending !== undefined) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      void refresh();
    }, DEBOUNCE_MS);
  }

  /**
   * `.git/HEAD`, and nothing else. A commit, a checkout, a rebase step, a reset
   * and a merge all rewrite that one file, which is very nearly the definition
   * of "the reading changed" — and watching one path costs nothing on a
   * repository with a hundred thousand files in it.
   */
  function watchHead(): void {
    for (const disposable of watching) disposable.dispose();
    watching = [];
    const folder = workspace();
    if (folder === null) return;

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, ".git/HEAD"),
    );
    watching = [
      watcher,
      watcher.onDidChange(schedule),
      watcher.onDidCreate(schedule),
      watcher.onDidDelete(schedule),
    ];
  }

  /**
   * The command that does the reading's work. It runs the real binary in a
   * real terminal and redraws nothing: the card is already the best rendering of a reading this product
   * has, and a second renderer of the same numbers is a second renderer to
   * disagree with.
   */
  const explain = vscode.commands.registerCommand(EXPLAIN_COMMAND, () => {
    const editor = vscode.window.activeTextEditor;
    const relative =
      root === null || editor === undefined || editor.document.uri.scheme !== "file"
        ? null
        : relativeRepoPath(root, editor.document.uri.fsPath);
    if (root === null || relative === null) {
      void vscode.window.showInformationMessage(
        "Fathohm explains a file inside the open folder's git repository — open one first.",
      );
      return;
    }

    if (terminal === undefined || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({ name: "fathohm", cwd: root });
    }
    terminal.show();
    terminal.sendText(explainCommandLine(relative, process.platform === "win32"));
  });

  /** The hosted Map, in the user's own browser. See {@link MAP_URL}. */
  const openMap = vscode.commands.registerCommand(MAP_COMMAND, () => {
    void vscode.env.openExternal(vscode.Uri.parse(MAP_URL));
  });

  context.subscriptions.push(
    repoItem,
    fileItem,
    explain,
    openMap,
    vscode.window.onDidChangeActiveTextEditor(() => {
      renderFile();
    }),
    vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) terminal = undefined;
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      watchHead();
      schedule();
    }),
    {
      dispose: () => {
        if (pending !== undefined) clearTimeout(pending);
        for (const disposable of watching) disposable.dispose();
        watching = [];
      },
    },
  );

  watchHead();
  void refresh();
}

export function deactivate(): void {
  // Everything this extension owns is a disposable on the context, and the
  // host disposes them. There is no cache on disk, nothing in flight, and
  // nothing anywhere to tell.
}
