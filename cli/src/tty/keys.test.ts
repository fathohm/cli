import { describe, expect, it } from "vitest";

import { parseKeys, type KeyEvent } from "./keys";

/**
 * The parser is the only place a byte means anything, so this is where the
 * keyboard is specified. Sequences are built from character codes rather than
 * written as literals: a raw escape in a source file is invisible in review,
 * and the one thing a reviewer of this file needs to be able to see is which
 * bytes are being claimed.
 */
const ESC = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);

function kinds(chunk: string, pending = ""): string[] {
  return parseKeys(chunk, pending).events.map((event: KeyEvent) => event.kind);
}

describe("the keys that move", () => {
  it("reads both arrow encodings — CSI and the application-mode SS3", () => {
    // A terminal in application cursor mode sends `ESC O A`; the same key in
    // normal mode sends `ESC [ A`. Binding one and not the other is the bug
    // where arrows work in one shell and not another.
    expect(kinds(`${ESC}[A`)).toEqual(["up"]);
    expect(kinds(`${ESC}[B`)).toEqual(["down"]);
    expect(kinds(`${ESC}OA`)).toEqual(["up"]);
    expect(kinds(`${ESC}OB`)).toEqual(["down"]);
  });

  it("reads j and k, and leaves their neighbours alone", () => {
    expect(kinds("kj")).toEqual(["up", "down"]);
    expect(kinds("hl")).toEqual(["other", "other"]);
  });

  it("consumes a modified arrow whole rather than spilling its parameters", () => {
    // `ESC [ 1 ; 5 A` is Ctrl-Up. A parser that stopped at `[` would emit
    // `1`, `;` and `5` as keystrokes.
    expect(kinds(`${ESC}[1;5A`)).toEqual(["up"]);
    // And a sequence this surface does not bind is one event, not four.
    expect(kinds(`${ESC}[3~`)).toEqual(["other"]);
    expect(kinds(`${ESC}[200~`)).toEqual(["other"]);
  });

  it("reads left and right as keys with no meaning here", () => {
    expect(kinds(`${ESC}[C${ESC}[D`)).toEqual(["other", "other"]);
  });
});

describe("the keys that act", () => {
  it("takes either newline as enter", () => {
    expect(kinds("\r")).toEqual(["enter"]);
    expect(kinds("\n")).toEqual(["enter"]);
  });

  it("quits on q, Q, Ctrl-C and Ctrl-D", () => {
    // Ctrl-C is the one that matters: in raw mode it arrives as a byte and
    // raises no signal, so a picker that did not bind it would be a picker
    // you cannot leave.
    expect(kinds("q")).toEqual(["quit"]);
    expect(kinds("Q")).toEqual(["quit"]);
    expect(kinds(CTRL_C)).toEqual(["quit"]);
    expect(kinds(CTRL_D)).toEqual(["quit"]);
  });

  it("quits on a lone escape", () => {
    expect(kinds(ESC)).toEqual(["quit"]);
  });
});

describe("escape sequences that arrive in pieces", () => {
  it("holds a sequence cut before its final byte, and finishes it next read", () => {
    const first = parseKeys(`${ESC}[`);
    expect(first.events).toEqual([]);
    expect(first.pending).toBe(`${ESC}[`);

    const second = parseKeys("A", first.pending);
    expect(second.events.map((event) => event.kind)).toEqual(["up"]);
    expect(second.pending).toBe("");
  });

  it("holds only the incomplete tail, and emits everything before it", () => {
    const read = parseKeys(`jk${ESC}[1`);
    expect(read.events.map((event) => event.kind)).toEqual(["down", "up"]);
    expect(read.pending).toBe(`${ESC}[1`);
    expect(parseKeys("B", read.pending).events.map((e) => e.kind)).toEqual(["down"]);
  });

  it("treats an escape alone at the end of a read as the Escape key", () => {
    // The documented trade: no timer, so the position of the ESC in the read
    // decides. Quitting is the conservative outcome — it restores the
    // terminal, which is the failure this feature is not allowed to have.
    expect(kinds(`j${ESC}`)).toEqual(["down", "quit"]);
    expect(parseKeys(`j${ESC}`).pending).toBe("");
  });

  it("treats Alt-something as a quit rather than as a binding", () => {
    expect(kinds(`${ESC}x`)).toEqual(["quit", "other"]);
  });
});

describe("the parser is a pure function", () => {
  const chunks = ["q", "\r", `${ESC}[A`, `${ESC}[B`, "kj", `${ESC}`, `${ESC}[1;5B`, "zz"];

  it("returns the same events for the same bytes, every time", () => {
    for (const chunk of chunks) {
      expect(parseKeys(chunk)).toEqual(parseKeys(chunk));
    }
  });

  it("never holds anything back from a complete read", () => {
    for (const chunk of chunks) {
      if (chunk === ESC) continue;
      expect(parseKeys(chunk).pending).toBe("");
    }
  });

  it("emits nothing at all for an empty read", () => {
    expect(parseKeys("")).toEqual({ events: [], pending: "" });
  });

  it("reads a burst of keys in the order they were typed", () => {
    // Held-down arrows arrive coalesced. Order is the whole meaning.
    expect(kinds(`${ESC}[B${ESC}[B${ESC}[A\r`)).toEqual(["down", "down", "up", "enter"]);
  });
});
