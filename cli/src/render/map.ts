import { statSync, writeFileSync } from "node:fs";
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

/** Writes the page, turning every filesystem failure into an error that names
 *  the path and one next step. */
export function writeMapFile(target: string, html: string): number {
  let existing: ReturnType<typeof statSync> | null = null;
  try {
    existing = statSync(target);
  } catch {
    existing = null;
  }
  if (existing !== null && existing.isDirectory()) {
    throw new CliError(
      EXIT.usage,
      `--out names a directory that already exists: ${target}`,
      "pass a file path — fathohm writes one HTML file and never a tree.",
    );
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
