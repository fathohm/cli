import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CliError, EXIT } from "../cmd/errors";

/**
 * The ONE path fathohm ever writes.
 *
 * Everything else this tool does is a read: git metadata in, text out. `map
 * --out` is the single exception, and it is an exception the caller named — so
 * the rules around it are about making sure the file that appears is the file
 * they asked for, and nothing else moved.
 *
 * **Never inside `.git`.** A treemap written into the object store is at best
 * litter and at worst a corrupted repository, and `--out .git/map.html` is one
 * slip of a shell completion away. Refused as a usage error, before anything
 * is opened.
 *
 * **Never onto a directory.** `--out build` where `build/` exists is a typo,
 * not an instruction.
 *
 * **An existing file is overwritten without asking.** This runs in CI. A
 * prompt is a hang, and a hang in a pipeline is worse than a file that was
 * always going to be regenerated anyway.
 */

/** Where the map goes when `--out` was not given. Relative to the working
 *  directory — the same place a shell redirect would have put it. */
export const DEFAULT_MAP_OUT = "fathohm-map.html";

/** The absolute path the map will be written to, or a usage error. */
export function resolveMapTarget(cwd: string, out: string | null): string {
  const requested = out ?? DEFAULT_MAP_OUT;
  if (requested.trim() === "") {
    throw new CliError(
      EXIT.usage,
      "--out expects a file path",
      `try \`--out ${DEFAULT_MAP_OUT}\`.`,
    );
  }

  const target = path.resolve(cwd, requested);
  if (path.basename(target) === "") {
    throw new CliError(
      EXIT.usage,
      `--out expects a file, got a directory: ${requested}`,
      `try \`--out ${path.join(requested, DEFAULT_MAP_OUT)}\`.`,
    );
  }

  // Segment-wise, not a substring search: a directory legitimately called
  // `.github` or `my.gitignore-tools` is not the object store.
  const segments = target.split(path.sep);
  if (segments.includes(".git")) {
    throw new CliError(
      EXIT.usage,
      `refusing to write inside .git: ${requested}`,
      "the object store is not a place to put an HTML file — pick a path outside it, " +
        `for example \`--out ${DEFAULT_MAP_OUT}\`.`,
    );
  }

  return target;
}

/**
 * The same file, spelled the way `--json` may carry it: RELATIVE to where the
 * caller stood, with `/` separators on every platform.
 *
 * `resolveMapTarget` returns an absolute path because that is what a write
 * needs. Putting that string in the document put the machine in it too —
 * `/Users/<somebody>/work/acme/fathohm-map.html` names a person and their
 * directory layout, in the one output of this tool designed to be committed,
 * posted to a PR and kept as a CI artefact. Every other path in that document
 * is repo-relative; this was the single field that was not, which also meant
 * two runs of the same reading on two checkouts produced two documents that
 * differed in a field that says nothing about the repository.
 *
 * Relative, not the raw `--out` string: `--out ./map.html` and
 * `--out "$PWD/map.html"` are the same instruction, and a document that echoed
 * the spelling would disagree with itself about a file it wrote once. A
 * consumer resolves it against the working directory it invoked fathohm in,
 * which is the one directory it is guaranteed to know.
 *
 * A target outside the working directory keeps its `../` climb — correct, and
 * still carrying no names.
 *
 * THE ONE CASE THAT STAYS ABSOLUTE: a different Windows drive. There is no
 * relative path from `D:\repo` to `C:\tmp\map.html`, so `path.relative`
 * answers with the absolute one, which is the only correct answer available.
 * The round trip a consumer performs — resolve against the working directory —
 * holds either way, and that is what the field promises.
 */
export function relativeMapTarget(cwd: string, target: string): string {
  return path.relative(cwd, target).split(path.sep).join("/");
}

/** Writes the page, turning every filesystem failure into an error that names
 *  the path and one next step. */
export function writeMapFile(target: string, html: string): number {
  // `lstat`, never `stat`: the difference is the whole of the paragraph below.
  let existing: ReturnType<typeof lstatSync> | null = null;
  try {
    existing = lstatSync(target);
  } catch {
    existing = null;
  }

  /**
   * NEVER THROUGH A SYMLINK, and the repository is the attacker here.
   *
   * A repository can commit `fathohm-map.html` as a symlink to anything the
   * user can write — `~/.ssh/authorized_keys`, `~/.zshrc`, a CI artifact — and
   * `fathohm map` with NO ARGUMENTS writes to that name by default. Following
   * the link would destroy the target with 8KB of HTML, on the say-so of a repo
   * the user only meant to read. It also walked straight through the `.git`
   * refusal above, which inspects the string the caller typed and cannot see
   * where a link points.
   *
   * Refused rather than resolved: a link that a clone put there is not a path
   * anybody asked to write, and `--out` names the real one in the one case
   * where somebody did.
   */
  if (existing !== null && existing.isSymbolicLink()) {
    throw new CliError(
      EXIT.usage,
      `refusing to write through a symlink: ${target}`,
      "a symbolic link with this name is already there, and following it would " +
        "overwrite whatever it points at — delete it, or pass `--out` with the " +
        "path you actually want written.",
    );
  }
  if (existing !== null && existing.isDirectory()) {
    throw new CliError(
      EXIT.usage,
      `--out names a directory that already exists: ${target}`,
      "pass a file path — fathohm writes one HTML file and never a tree.",
    );
  }

  // And the same question about the PARENT: `out/` can itself be a link into
  // the object store, which the string-level guard also cannot see.
  try {
    const parent = realpathSync(path.dirname(target));
    if (parent.split(path.sep).includes(".git")) {
      throw new CliError(
        EXIT.usage,
        `refusing to write inside .git: ${target} resolves into ${parent}`,
        "a directory on this path is a link into the object store — pick a path outside it.",
      );
    }
  } catch (error) {
    // A parent that does not exist is the write's problem to report, below.
    if (error instanceof CliError) throw error;
  }

  try {
    writeFileSync(target, html, "utf8");
  } catch (error) {
    throw new CliError(
      EXIT.usage,
      `could not write ${target} — ${error instanceof Error ? error.message : String(error)}`,
      "check the directory exists and is writable; fathohm creates the file but never its parents.",
    );
  }
  return Buffer.byteLength(html, "utf8");
}
