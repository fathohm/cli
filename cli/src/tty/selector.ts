import type { Command } from "../cmd/args";
import type { KeyEvent } from "./keys";
import type { EnvLike } from "../render/term";

/**
 * THE PICKER, as a state machine and a gate — and nothing else. No stream, no
 * terminal, no `process`.
 *
 * The whole interactive layer is three parts and this is the middle one:
 * `keys.ts` turns bytes into intentions, this turns intentions into a new state
 * and a list of effects, and `interactive.ts` is the twenty lines that own the
 * file descriptor. That split is not architecture for its own sake — it is
 * what makes the behaviour testable at all. Raw-mode stdin cannot be driven
 * from a test runner, so anything that mattered and lived inside it would ship
 * unasserted.
 *
 * THE GATE IS THE OTHER HALF OF THE DETERMINISM CONTRACT. `(repo state, --now,
 * flags)` produces byte-identical stdout, and an interactive layer that ever
 * mounted where bytes are being read by a machine would break that in the one
 * place nobody looks: a pipeline. So {@link interactiveAllowed} is a
 * conjunction of gates that all have to pass, it is a pure function of its
 * inputs, and every one of its terms is tested independently.
 */

/** One row of the picker: the file it opens, and the line the card printed. */
export interface SelectorRow {
  readonly path: string;
  /** The card's own row, WITHOUT its leading indent — the cursor cell goes
   *  exactly there, so the list under the card sits in the same columns. */
  readonly body: string;
}

export interface SelectorState {
  readonly rows: readonly SelectorRow[];
  readonly selected: number;
  readonly phase: "picking" | "done";
}

/**
 * What the caller must DO. Kept as data rather than as callbacks so a test can
 * assert what a keystroke asked for without performing it.
 */
export type SelectorEffect =
  | { readonly kind: "redraw" }
  | { readonly kind: "explain"; readonly path: string }
  | { readonly kind: "quit" };

export interface SelectorStep {
  readonly state: SelectorState;
  readonly effects: readonly SelectorEffect[];
}

export function initialSelector(rows: readonly SelectorRow[]): SelectorState {
  return { rows, selected: 0, phase: "picking" };
}

/**
 * One key, one step.
 *
 * Two properties worth naming because they are what the tests hold:
 *
 * **Movement clamps, it never wraps.** A list of five is a list a reader can
 * see all of, and a cursor that jumps from the bottom back to the top of a
 * visible list reads as a glitch rather than as a feature.
 *
 * **`done` is absorbing.** Keys buffered before the quit was processed cannot
 * reopen a picker whose terminal has already been restored.
 */
export function stepSelector(state: SelectorState, event: KeyEvent): SelectorStep {
  if (state.phase === "done") return { state, effects: [] };

  switch (event.kind) {
    case "up":
      return move(state, -1);
    case "down":
      return move(state, 1);
    case "enter": {
      const row = state.rows[state.selected];
      if (row === undefined) return { state, effects: [] };
      return { state, effects: [{ kind: "explain", path: row.path }] };
    }
    case "quit":
      return { state: { ...state, phase: "done" }, effects: [{ kind: "quit" }] };
    case "other":
      return { state, effects: [] };
  }
}

function move(state: SelectorState, delta: number): SelectorStep {
  const last = state.rows.length - 1;
  if (last < 0) return { state, effects: [] };
  const selected = Math.min(last, Math.max(0, state.selected + delta));
  // A redraw that changes nothing is a flicker, so a clamped move is a no-op
  // rather than a repaint.
  if (selected === state.selected) return { state, effects: [] };
  return { state: { ...state, selected }, effects: [{ kind: "redraw" }] };
}

/**
 * Everything the decision to mount depends on. Named fields rather than a
 * `CliIo` and a `CliFlags`, so that the gate is readable as the list of
 * conditions it is.
 */
export interface InteractiveGates {
  readonly command: Command;
  readonly stdoutIsTTY: boolean;
  readonly stdinIsTTY: boolean;
  readonly json: boolean;
  readonly full: boolean;
  readonly quiet: boolean;
  readonly noInteractive: boolean;
  readonly env: EnvLike;
  /** How many rows the card's BELOW THE LINE section actually printed. */
  readonly rowCount: number;
}

/**
 * Whether the picker may mount. Every term is a refusal, and the default of
 * every one of them is "no".
 *
 *   - **the card only.** `check`, `fade`, `map` and `explain` are answers, not
 *     menus; `explain` in particular is what the picker OPENS, and a picker
 *     under a picker is a loop.
 *   - **both ends are terminals.** stdout not a terminal means somebody is
 *     capturing bytes; stdin not a terminal means there is nobody to type.
 *     `printf q | fathohm` must behave exactly like `fathohm > file`.
 *   - **`--json` never.** A document with a menu appended is not a document.
 *   - **`--full` and `--quiet` never.** Both are "give me the other output":
 *     `--full` is the whole list for a pager, `--quiet` prints no rows at all.
 *   - **`--no-interactive`**, which is the escape hatch for a terminal that is
 *     a terminal and still does not want this.
 *   - **`CI` unset**, because a CI runner can hand a job a pseudo-terminal.
 *   - **`TERM` is not `dumb`**, the one terminal that says outright that it
 *     cannot move a cursor.
 *   - **there are rows.** An empty picker is a hint line under a card, which
 *     is worse than nothing.
 */
export function interactiveAllowed(gates: InteractiveGates): boolean {
  return (
    gates.command === "read" &&
    gates.stdoutIsTTY &&
    gates.stdinIsTTY &&
    !gates.json &&
    !gates.full &&
    !gates.quiet &&
    !gates.noInteractive &&
    !isContinuousIntegration(gates.env) &&
    gates.env.TERM !== "dumb" &&
    gates.rowCount > 0
  );
}

/** `CI` set to anything at all, empty string excepted — the convention every
 *  runner follows and the one signal that a terminal is not a person. */
function isContinuousIntegration(env: EnvLike): boolean {
  const flag = env.CI;
  return flag !== undefined && flag !== "";
}
