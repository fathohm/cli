/**
 * BYTES TO INTENTIONS — the whole of what the interactive layer knows about
 * keyboards, as one pure function.
 *
 * A terminal in raw mode does not deliver keys, it delivers bytes: `j` is one
 * byte, the down arrow is three (`ESC [ B`), and Ctrl-C is `0x03` rather than
 * a signal. Everything downstream of here reasons about intentions instead,
 * which is what lets the reducer be a table of transitions and lets both be
 * tested without a terminal anywhere in the picture.
 *
 * THE ESCAPE PROBLEM, and the reading taken of it. `ESC` is both a key
 * somebody presses and the first byte of every arrow key, and nothing in the
 * byte stream distinguishes them — the usual fix is a timer, which turns a
 * pure function into a scheduler. So the rule here is positional:
 *
 *   - `ESC` with more bytes behind it in the same read is an INTRODUCER;
 *   - `ESC` as the last byte of the read is the KEY.
 *
 * A terminal hands over a whole escape sequence in one read, and a person
 * pressing Escape sends one byte on its own, so the two cases are already
 * distinct in practice. The residue is an arrow key split across two reads,
 * which is rare and, when it happens, quits — an outcome that restores the
 * terminal and loses nothing but a keystroke. Quitting on a stray split is the
 * failure worth having; the other reading (hold the ESC and wait) means the
 * Escape key does nothing at all until the next keypress, every single time.
 *
 * The one split that IS held is a sequence cut mid-way (`ESC [` with its final
 * byte still in flight): those bytes go back as `pending` and the next read
 * starts with them.
 */

export type KeyEvent =
  | { readonly kind: "up" }
  | { readonly kind: "down" }
  | { readonly kind: "enter" }
  | { readonly kind: "quit" }
  /** A key with no meaning here. Named rather than dropped so the reducer's
   *  switch stays exhaustive and a no-op stays a decision. */
  | { readonly kind: "other" };

export interface KeyRead {
  readonly events: readonly KeyEvent[];
  /** Bytes held back: an escape sequence that arrived cut in half. */
  readonly pending: string;
}

const ESC = "\u001b";
/** Ctrl-C. In raw mode this arrives as a byte, not as SIGINT — handling it is
 *  the difference between a clean exit and a terminal left in raw mode. */
const CTRL_C = "\u0003";
/** Ctrl-D. End of input is a quit like any other. */
const CTRL_D = "\u0004";

const UP: KeyEvent = { kind: "up" };
const DOWN: KeyEvent = { kind: "down" };
const ENTER: KeyEvent = { kind: "enter" };
const QUIT: KeyEvent = { kind: "quit" };
const OTHER: KeyEvent = { kind: "other" };

/** The final byte of a cursor sequence, for the two directions that matter. */
const SEQUENCE_FINALS: Readonly<Record<string, KeyEvent>> = { A: UP, B: DOWN };

/**
 * One read of stdin, plus whatever the last one held back.
 *
 * Pure: same bytes in, same events out, no clock and no state of its own.
 */
export function parseKeys(chunk: string, pending: string = ""): KeyRead {
  const buffer = pending + chunk;
  const events: KeyEvent[] = [];
  let index = 0;

  while (index < buffer.length) {
    const byte = buffer[index];

    if (byte !== ESC) {
      events.push(plainKey(byte));
      index += 1;
      continue;
    }

    const introducer = buffer[index + 1];
    // The last byte of the read: the Escape key itself.
    if (introducer === undefined) {
      events.push(QUIT);
      index += 1;
      continue;
    }
    // `ESC [` (CSI) and `ESC O` (SS3) are the two shapes a cursor key takes;
    // `ESC` followed by anything else is Alt-something, which this surface
    // does not bind — conservatively, a quit.
    if (introducer !== "[" && introducer !== "O") {
      events.push(QUIT);
      index += 1;
      continue;
    }

    const sequence = readSequence(buffer, index);
    if (sequence === null) return { events, pending: buffer.slice(index) };
    events.push(sequence.event);
    index = sequence.next;
  }

  return { events, pending: "" };
}

function plainKey(byte: string): KeyEvent {
  switch (byte) {
    case "\r":
    case "\n":
      return ENTER;
    case "k":
      return UP;
    case "j":
      return DOWN;
    case "q":
    case "Q":
    case CTRL_C:
    case CTRL_D:
      return QUIT;
    default:
      return OTHER;
  }
}

/**
 * One escape sequence, starting at the `ESC`, or null when it is incomplete.
 *
 * Parameter and intermediate bytes (`0x20`–`0x3f`: the `1;5` of a modified
 * arrow, the `3` of a Delete) are consumed until the final byte that ends the
 * sequence. Consuming the whole thing matters more than understanding it — a
 * sequence left half-parsed would put `~` and `5` into the stream as keys.
 */
function readSequence(
  buffer: string,
  start: number,
): { readonly event: KeyEvent; readonly next: number } | null {
  let cursor = start + 2;
  while (cursor < buffer.length && isParameterByte(buffer[cursor])) cursor += 1;
  if (cursor >= buffer.length) return null;
  return { event: SEQUENCE_FINALS[buffer[cursor]] ?? OTHER, next: cursor + 1 };
}

function isParameterByte(byte: string): boolean {
  const code = byte.charCodeAt(0);
  return code >= 0x20 && code <= 0x3f;
}
