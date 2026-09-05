import type { SelectorState } from "../tty/selector";
import type { Term } from "./term";
import { INDENT, padEnd } from "./text";

/**
 * THE PICKER'S OWN LINES — the only block of output the card does not own.
 *
 * It is deliberately small. The card above it is the argument and the
 * screenshot; this is a cursor and one sentence telling a reader which keys
 * exist. Anything more here competes with the thing it sits under.
 *
 * THE CURSOR CELL IS EXACTLY THE CARD'S INDENT. Two columns, filled with the
 * cursor glyph on the selected row and with spaces on the others, so the rows
 * below the card land in the same columns as the rows inside it. A picker
 * whose list was shifted one column right of the section it mirrors would read
 * as a second, subtly different list.
 *
 * THE HINT NAMES KEYS AND WHAT THEY DO, and nothing else. No "risks", no
 * "top", no adjective that the reading would have to support — this is a
 * caption on a control, and a control that oversells itself is the first place
 * a careful reader stops believing the numbers above it.
 */
export function renderSelector(state: SelectorState, term: Term): string[] {
  if (state.rows.length === 0) return [];

  const cursor = padEnd(term.glyph("cursor"), INDENT.length);
  const lines = state.rows.map(
    (row, index) => (index === state.selected ? cursor : INDENT) + row.body,
  );
  lines.push(term.color(INDENT + hintLine(term), "dim"));

  // The leading blank is part of the block: it separates the picker from the
  // card, and it is counted in the block's height so the erase that removes
  // the picker removes the gap with it.
  return ["", ...lines];
}

/** The keys, in the order a reader tries them. */
export function hintLine(term: Term): string {
  const dot = term.glyph("dot");
  return (
    `${term.glyph("up")}/${term.glyph("down")} pick a file ` +
    `${dot} enter: factor by factor ${dot} q: quit`
  );
}
