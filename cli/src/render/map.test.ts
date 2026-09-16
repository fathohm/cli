import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT, isCliError } from "../cmd/errors";
import { DEFAULT_MAP_OUT, resolveMapTarget, writeMapFile } from "./map";

/**
 * THE ONE PATH FATHOHM WRITES, and the repository is a hostile input to it.
 *
 * Everything else the CLI does is a read, which is why this file exists: the
 * write is the only thing a repo can aim somewhere it was never pointed. It
 * could, until this was fixed — a committed symlink named `fathohm-map.html`
 * sent the default `fathohm map`, with no arguments, straight through to
 * whatever it pointed at.
 */

function scratch(): string {
  return mkdtempSync(path.join(os.tmpdir(), "fathohm-map-"));
}

describe("writeMapFile", () => {
  it("writes the page and reports its byte length", () => {
    const dir = scratch();
    const target = path.join(dir, DEFAULT_MAP_OUT);
    const html = "<!doctype html><title>map</title>";
    expect(writeMapFile(target, html)).toBe(Buffer.byteLength(html, "utf8"));
    expect(readFileSync(target, "utf8")).toBe(html);
  });

  it("refuses to write through a symlink, leaving the target untouched", () => {
    // The attack: a public repo commits `fathohm-map.html` as a link to
    // something the user can write. `fathohm map` takes no arguments to reach
    // this, so the default invocation is the dangerous one.
    const dir = scratch();
    const victim = path.join(dir, "authorized_keys");
    writeFileSync(victim, "ssh-ed25519 AAAA...\n", "utf8");
    const link = path.join(dir, DEFAULT_MAP_OUT);
    symlinkSync(victim, link);

    const failure = (() => {
      try {
        writeMapFile(link, "<!doctype html>");
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(isCliError(failure)).toBe(true);
    if (!isCliError(failure)) return;
    expect(failure.exitCode).toBe(EXIT.usage);
    expect(failure.message).toContain("symlink");
    // The whole point: the file behind the link is exactly as it was.
    expect(readFileSync(victim, "utf8")).toBe("ssh-ed25519 AAAA...\n");
  });

  it("refuses a symlink that points into .git, which the string guard cannot see", () => {
    const dir = scratch();
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    const config = path.join(dir, ".git", "config");
    writeFileSync(config, "[core]\n", "utf8");
    const link = path.join(dir, "gitcfg.html");
    symlinkSync(config, link);

    // `resolveMapTarget` is happy: the string names no `.git` segment.
    expect(resolveMapTarget(dir, "gitcfg.html")).toBe(link);

    expect(() => writeMapFile(link, "<!doctype html>")).toThrow(/symlink/);
    expect(readFileSync(config, "utf8")).toBe("[core]\n");
  });

  it("refuses a parent directory that links into .git", () => {
    const dir = scratch();
    mkdirSync(path.join(dir, ".git", "objects"), { recursive: true });
    symlinkSync(path.join(dir, ".git", "objects"), path.join(dir, "out"));

    expect(() => writeMapFile(path.join(dir, "out", "map.html"), "<!doctype html>")).toThrow(
      /\.git/,
    );
  });

  it("refuses a directory that already exists", () => {
    const dir = scratch();
    const target = path.join(dir, "build");
    mkdirSync(target);
    expect(() => writeMapFile(target, "<!doctype html>")).toThrow(/directory/);
  });
});

describe("resolveMapTarget", () => {
  it("refuses a path inside .git, however it is spelled", () => {
    const dir = scratch();
    for (const out of [".git/map.html", "./src/../.git/y.html", path.join(dir, ".git", "z.html")]) {
      expect(() => resolveMapTarget(dir, out), out).toThrow(/\.git/);
    }
  });

  it("defaults to the working directory, and takes an explicit path as given", () => {
    const dir = scratch();
    expect(resolveMapTarget(dir, null)).toBe(path.join(dir, DEFAULT_MAP_OUT));
    expect(resolveMapTarget(dir, "reports/map.html")).toBe(path.join(dir, "reports", "map.html"));
  });
});
