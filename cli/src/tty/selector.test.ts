import { describe, expect, it } from "vitest";

import type { KeyEvent } from "./keys";
import {
  initialSelector,
  interactiveAllowed,
  stepSelector,
  type InteractiveGates,
  type SelectorEffect,
  type SelectorRow,
  type SelectorState,
} from "./selector";

const ROWS: readonly SelectorRow[] = [
  { path: "components/Map.tsx", body: "0.08  components/Map.tsx  hand-written 300d ago" },
  { path: "app/page.tsx", body: "0.10  app/page.tsx  hand-written 400d ago" },
  { path: "lib/map-tree.ts", body: "0.17  lib/map-tree.ts  hand-written 220d ago" },
];

const UP: KeyEvent = { kind: "up" };
const DOWN: KeyEvent = { kind: "down" };
const ENTER: KeyEvent = { kind: "enter" };
const QUIT: KeyEvent = { kind: "quit" };
const OTHER: KeyEvent = { kind: "other" };

/** Replays a run of keys and hands back the final state with everything the
 *  picker asked its caller to do. */
function replay(
  events: readonly KeyEvent[],
  rows: readonly SelectorRow[] = ROWS,
): { state: SelectorState; effects: SelectorEffect[] } {
  let state = initialSelector(rows);
  const effects: SelectorEffect[] = [];
  for (const event of events) {
    const step = stepSelector(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

describe("where the cursor starts", () => {
  it("opens on the first row, picking", () => {
    // The first row is the biggest file below the line — the row the card's
    // own `factor by factor:` line already offers.
    const state = initialSelector(ROWS);
    expect(state.selected).toBe(0);
    expect(state.phase).toBe("picking");
    expect(state.rows).toEqual(ROWS);
  });
});

describe("moving", () => {
  it("goes down and back up again", () => {
    expect(replay([DOWN, DOWN]).state.selected).toBe(2);
    expect(replay([DOWN, DOWN, UP]).state.selected).toBe(1);
  });

  it("clamps at both ends — it never wraps", () => {
    // A five-row list is a list a reader can see all of, and a cursor that
    // teleported from the bottom to the top of a visible list reads as a bug.
    expect(replay([UP, UP, UP]).state.selected).toBe(0);
    expect(replay([DOWN, DOWN, DOWN, DOWN, DOWN]).state.selected).toBe(ROWS.length - 1);
  });

  it("asks for a redraw only when the cursor actually moved", () => {
    expect(replay([DOWN]).effects).toEqual([{ kind: "redraw" }]);
    // Already at the top: a repaint that changes nothing is a flicker.
    expect(replay([UP]).effects).toEqual([]);
    expect(replay([DOWN, DOWN, DOWN]).effects).toEqual([
      { kind: "redraw" },
      { kind: "redraw" },
    ]);
  });

  it("does nothing at all with no rows", () => {
    const empty = replay([UP, DOWN, ENTER], []);
    expect(empty.effects).toEqual([]);
    expect(empty.state.selected).toBe(0);
  });
});

describe("enter", () => {
  it("asks for the selected row's file, and leaves the cursor where it was", () => {
    const first = replay([ENTER]);
    expect(first.effects).toEqual([{ kind: "explain", path: ROWS[0].path }]);
    expect(first.state.selected).toBe(0);
    expect(first.state.phase).toBe("picking");

    expect(replay([DOWN, DOWN, ENTER]).effects).toContainEqual({
      kind: "explain",
      path: ROWS[2].path,
    });
  });

  it("can be pressed twice on the same row", () => {
    const twice = replay([ENTER, ENTER]).effects;
    expect(twice).toEqual([
      { kind: "explain", path: ROWS[0].path },
      { kind: "explain", path: ROWS[0].path },
    ]);
  });
});

describe("quitting", () => {
  it("marks the picker done and asks the caller to close", () => {
    const quit = replay([QUIT]);
    expect(quit.state.phase).toBe("done");
    expect(quit.effects).toEqual([{ kind: "quit" }]);
  });

  it("is absorbing — keys buffered behind a quit cannot reopen it", () => {
    // A held-down key can deliver several bytes in one read. Everything after
    // the quit is landing on a terminal that has already been restored.
    const after = replay([QUIT, DOWN, ENTER, QUIT]);
    expect(after.effects).toEqual([{ kind: "quit" }]);
    expect(after.state.phase).toBe("done");
  });
});

describe("keys with no binding", () => {
  it("change nothing and ask for nothing", () => {
    const state = replay([OTHER, OTHER]);
    expect(state.effects).toEqual([]);
    expect(state.state).toEqual(initialSelector(ROWS));
  });
});

/**
 * THE GATE — enumerated, because "the picker never appears in a pipe" is a
 * determinism claim and a claim like that is worth one test per term.
 */
describe("interactiveAllowed", () => {
  const OPEN: InteractiveGates = {
    command: "read",
    stdoutIsTTY: true,
    stdinIsTTY: true,
    json: false,
    full: false,
    quiet: false,
    noInteractive: false,
    env: {},
    rowCount: 5,
  };

  it("mounts when every gate passes", () => {
    expect(interactiveAllowed(OPEN)).toBe(true);
  });

  const CLOSED: ReadonlyArray<{ why: string; gates: Partial<InteractiveGates> }> = [
    { why: "stdout is redirected", gates: { stdoutIsTTY: false } },
    { why: "stdin is a pipe", gates: { stdinIsTTY: false } },
    { why: "--json", gates: { json: true } },
    { why: "--full", gates: { full: true } },
    { why: "--quiet", gates: { quiet: true } },
    { why: "--no-interactive", gates: { noInteractive: true } },
    { why: "CI is set", gates: { env: { CI: "true" } } },
    { why: "CI is set to anything", gates: { env: { CI: "1" } } },
    { why: "TERM is dumb", gates: { env: { TERM: "dumb" } } },
    { why: "nothing is below the line", gates: { rowCount: 0 } },
    { why: "the command is check", gates: { command: "check" } },
    { why: "the command is fade", gates: { command: "fade" } },
    { why: "the command is map", gates: { command: "map" } },
    { why: "the command is explain", gates: { command: "explain" } },
  ];

  for (const { why, gates } of CLOSED) {
    it(`refuses on its own when ${why}`, () => {
      // Each one flipped alone, against an otherwise-open gate: a term that
      // only worked because another term happened to be closed would pass a
      // conjunction test and fail in somebody's terminal.
      expect(interactiveAllowed({ ...OPEN, ...gates })).toBe(false);
    });
  }

  it("is not fooled by an empty CI, which is how a shell unsets one", () => {
    expect(interactiveAllowed({ ...OPEN, env: { CI: "" } })).toBe(true);
  });

  it("mounts on an ordinary TERM", () => {
    expect(interactiveAllowed({ ...OPEN, env: { TERM: "xterm-256color" } })).toBe(true);
  });
});
