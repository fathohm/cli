import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * `npm run cli:build`, run at most once per process and never by two processes
 * at the same time.
 *
 * Two test files need the built artifact — the packaging gate and the
 * no-network assertion — and vitest runs test files in parallel workers. Both
 * of them building into `cli/dist/fathohm.cjs` concurrently is a torn read
 * waiting to happen: esbuild opens the output with `O_TRUNC`, so a reader that
 * arrives mid-write sees a file that is genuinely half a bundle. That failure
 * would be intermittent, would look like a real finding, and would be blamed on
 * the assertion rather than on the harness.
 *
 * So: a directory as a mutex. `mkdir` is atomic on every filesystem this runs
 * on — it either creates or it fails EEXIST, with no window in between — and it
 * needs no cleanup handler to be correct, only to be prompt. A lock older than
 * {@link STALE_MS} is assumed to belong to a worker that died and is taken.
 *
 * The lock lives in the system temp directory rather than beside the bundle:
 * the packaging gate asserts that `cli/dist` holds exactly one file, and a test
 * harness that puts scaffolding inside the directory under inspection is a test
 * that measures itself.
 */

const REPO_ROOT = process.cwd();
export const BUNDLE_PATH = path.join(REPO_ROOT, "cli", "dist", "fathohm.cjs");
export const DIST_DIR = path.dirname(BUNDLE_PATH);

const LOCK_DIR = path.join(
  os.tmpdir(),
  `fathohm-cli-build-${REPO_ROOT.replace(/[^A-Za-z0-9]+/g, "-")}.lock`,
);
const STALE_MS = 180_000;
const POLL_MS = 100;

let cached: string | null = null;

/** Builds if this process has not already, and returns the bundle as text. */
export function buildBundle(): string {
  if (cached !== null) return cached;
  const text = withLock(() => {
    execFileSync("npm", ["run", "cli:build"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
      encoding: "utf8",
    });
    return readFileSync(BUNDLE_PATH, "utf8");
  });
  cached = text;
  return text;
}

function withLock<T>(body: () => T): T {
  const deadline = Date.now() + STALE_MS;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR, { recursive: false });
      break;
    } catch {
      if (isStale() || Date.now() > deadline) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      sleep(POLL_MS);
    }
  }
  try {
    return body();
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

function isStale(): boolean {
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs > STALE_MS;
  } catch {
    // It disappeared between the failed mkdir and this stat: the holder
    // finished, and the next attempt will take it.
    return false;
  }
}

/** A synchronous sleep. `Atomics.wait` is the only one node has that does not
 *  need an event-loop turn, and a spin loop would burn a core per worker. */
function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
