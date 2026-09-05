import { parseKeys } from "./tty/keys";
import { renderSelector } from "./render/selector";
import {
  initialSelector,
  stepSelector,
  type SelectorRow,
  type SelectorState,
} from "./tty/selector";
import { ANSI, type Term } from "./render/term";

/**
 * THE ADAPTER — the one place in the CLI that owns a file descriptor, and the
 * only module here with no unit test of its own.
 *
 * That is a deliberate trade, and the reason it is this short. Raw-mode stdin
 * cannot be driven from a test runner, so the way to keep the interactive
 * layer honest is to leave almost nothing in the part that cannot be driven:
 * the key parsing is `keys.ts`, the transitions are `selector.ts`, the bytes
 * are `render/selector.ts`, and all three are pure and asserted. What is left
 * here is a listener, a redraw, and a restore.
 *
 * THE RESTORE IS THE ONLY THING THAT CANNOT FAIL. A wedged terminal — raw mode
 * left on, cursor left hidden — is the one bug this feature is not allowed to
 * have, because the person it happens to has to close the window to get their
 * shell back and will not run the tool again. So `close` is idempotent, it runs
 * from the quit keys, from a signal, and from a `finally` around the handler,
 * and it restores in the same order every time.
 *
 * THE CARD IS NEVER TOUCHED. There is no alternate screen and no cursor
 * movement above the picker's own first line: the block is written, and
 * redrawing it means moving up exactly as many lines as were written and
 * erasing forward. On the way out the block is erased and the card is left
 * sitting in the terminal, which is the whole point — the card is the artefact,
 * and a picker that took it away on exit would be a picker that deleted the
 * product's output.
 */

export interface SelectorMount {
  readonly rows: readonly SelectorRow[];
  readonly term: Term;
  /** The CLI's own stdout handle. The picker never reaches past it. */
  readonly write: (chunk: string) => void;
  /** The explain rendering for a row, as lines. Called on Enter. */
  readonly explain: (path: string) => readonly string[];
}

/** Injectable at the composition root, so the gates can be tested end to end
 *  without a terminal. */
export type MountSelector = (mount: SelectorMount) => Promise<void>;

export function runSelector(mount: SelectorMount): Promise<void> {
  const input = process.stdin;
  // The gates upstream already require a terminal on both ends. This is the
  // belt: a stream with no raw mode is a stream this cannot drive, and
  // half-driving it would leave keystrokes echoing into a dead picker.
  if (typeof input.setRawMode !== "function" || mount.rows.length === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let state: SelectorState = initialSelector(mount.rows);
    let pending = "";
    let drawn = 0;
    let closed = false;

    const draw = (): void => {
      const block = renderSelector(state, mount.term);
      if (block.length === 0) return;
      mount.write(`${block.join("\n")}\n`);
      drawn = block.length;
    };

    /** Up over the block just written, then forward to the end of the screen.
     *  Nothing above the block's first line is ever addressed. */
    const erase = (): void => {
      if (drawn === 0) return;
      mount.write(ANSI.cursorUp(drawn) + ANSI.eraseDown);
      drawn = 0;
    };

    const close = (): void => {
      if (closed) return;
      closed = true;
      erase();
      input.off("data", onData);
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      process.off("SIGHUP", close);
      try {
        input.setRawMode(false);
      } finally {
        input.pause();
        mount.write(ANSI.showCursor);
        resolve();
      }
    };

    function onData(chunk: string): void {
      try {
        const read = parseKeys(String(chunk), pending);
        pending = read.pending;
        for (const event of read.events) {
          const step = stepSelector(state, event);
          state = step.state;
          for (const effect of step.effects) {
            if (effect.kind === "redraw") {
              erase();
              draw();
            } else if (effect.kind === "explain") {
              // PERMANENTLY into scrollback: the picker's lines come off, the
              // explain goes down as ordinary output, and the picker is drawn
              // again underneath it. Quitting later leaves both on screen.
              //
              // A BLANK LINE FIRST, because these stack. Pick three files and
              // three cards land in one buffer, and they were written flush
              // against each other — the last sentence of one answer and the
              // header of the next shared an edge, so the pile read as one
              // long card about nothing in particular. The gap belongs here
              // rather than inside `renderExplain`: a single `fathohm explain`
              // has the shell prompt above it and owes the reader no leading
              // blank, and the goldens say so.
              erase();
              mount.write(`\n${mount.explain(effect.path).join("\n")}\n`);
              draw();
            } else {
              close();
            }
          }
          if (closed) return;
        }
      } catch {
        // Anything at all: the terminal comes back first, and the reading has
        // already been printed.
        close();
      }
    }

    try {
      process.on("SIGINT", close);
      process.on("SIGTERM", close);
      process.on("SIGHUP", close);
      input.setRawMode(true);
      input.setEncoding("utf8");
      input.resume();
      input.on("data", onData);
      mount.write(ANSI.hideCursor);
      draw();
    } catch {
      close();
    }
  });
}
