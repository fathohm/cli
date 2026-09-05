import { formatBlindShare } from "../../../lib/blind-share-format";
import { isDegenerate } from "../reading/scoring";
import type { KeeperRow, LeaveRow, TeamReading } from "../reading/team";
import type { Term } from "./term";
import { emptyReason } from "./card";
import { printedShare } from "./ledger";
import { renderHeader, runnable, scopeNote, sectionHead, type RenderMeta } from "./meta";
import { renderProvenance } from "./provenance";
import { depthColor, depthGlyph, structureInk } from "./ramp";
import {
  INDENT,
  countWord,
  formatBytes,
  formatBytesCeil,
  isoSeconds,
  padEnd,
  padStart,
  paragraph,
  quoteArg,
  truncate,
} from "./text";

/**
 * `fathohm team` — the humans in this history, and the code with one name on it.
 *
 * ── WHAT IS ON THIS CARD, AND WHAT WILL NEVER BE ────────────────────────────
 *
 * Every row measures CODE. `priya  23 files  212 KB  19%` is a statement about
 * a repository: this much of it has one name in its history. It is checkable
 * against the same clone, it is actionable (that is the code to pair on), and
 * it says nothing at all about how well anybody works.
 *
 * The card this deliberately is not is the inverse: a per-person score, a rank,
 * a "comprehension contribution" column. Git shows who committed. A league
 * table built on that would rank people by how often they were the only one
 * around — which is a fact about how work was handed out, not about them — and
 * the first team to see their names sorted by a number would stop running this
 * on their own repository, which is the end of the product. The ordering here
 * is by BYTES AT RISK, and the sentence under it says so.
 *
 * ── THE SECTION IS A PARTITION ──────────────────────────────────────────────
 *
 * Every scored file carries exactly one human name, more than one, or none, so
 * the rows are total and disjoint over the same bytes the headline divides by.
 * The printed integers are allocated by the ledger's own largest-remainder rule
 * — the same function, not the same idea — because a column that does not add
 * up in a screenshot refutes the product, and because the two display floors
 * (`<1%`, `>99%`) have to behave here exactly as they do there.
 *
 * The cap keeps that property rather than breaking it: humans whose load rounds
 * below a printed unit fold into a coda ROW that still carries their bytes, so
 * the column adds to a hundred with them or without them. `--full` lists
 * everybody instead.
 *
 * ── COLOUR IS DEPTH, HERE TOO ───────────────────────────────────────────────
 *
 * A keeper row's bar is drawn at the byte-weighted depth of the code it stands
 * for, through the same `depthColor` and the same block ramp the mini-map uses.
 * A person who is the sole name on a lot of code that is also very stale reads
 * red and long; a sole keeper of code touched last week reads long and blue,
 * which is the honest picture and not the alarming one. Length is the share and
 * the block is the depth — the mini-map's two encodings, named in the legend
 * line above the rows.
 */

/**
 * The name column, between these two.
 *
 * The floor is `no human`, the longest label the table generates itself. The
 * ceiling is where a name stops being worth more columns than the bar beside
 * it — but the column takes what the LONGEST NAME PRESENT needs up to that
 * point, because truncating somebody to `Ada Lo…` on a card whose subject is
 * who is in this history is the one economy this table cannot make.
 */
const MIN_NAME_WIDTH = 9;
const MAX_NAME_WIDTH = 24;

function nameWidth(labels: readonly string[], room = MAX_NAME_WIDTH): number {
  const longest = Math.max(0, ...labels.map((label) => label.length));
  return Math.max(MIN_NAME_WIDTH, Math.min(MAX_NAME_WIDTH, room, longest));
}
const SHARE_WIDTH = 4;
const BYTES_WIDTH = 5;
/** `file`/`files`, in a fixed cell so the byte column does not step sideways. */
const UNIT_WIDTH = 5;
const MAX_BAR_WIDTH = 30;
const MIN_BAR_WIDTH = 6;

export function renderTeam(team: TeamReading, term: Term, meta: RenderMeta): string[] {
  const width = term.width - INDENT.length;
  const count = team.humans.length;
  const lines = renderHeader(term, [
    `git-only reading of ${meta.target} ${term.glyph("dot")} the humans ` +
      `(${count} in its history)`,
    isoSeconds(team.reading.now),
    `scorer ${meta.scorerVersion}`,
  ]);
  lines.push(...scopeNote(team.reading, term));

  if (isDegenerate(team.reading)) {
    lines.push("", `${INDENT}nothing to fathom here yet`);
    lines.push(...paragraph(emptyReason(team.reading, term), width));
    pushSection(lines, renderProvenance(team.reading, term));
    return lines;
  }

  if (meta.quiet) {
    pushSection(lines, quietRows(team, term));
    pushSection(lines, renderProvenance(team.reading, term));
    return lines;
  }

  pushSection(lines, keeperTable(team, term, width));
  pushSection(lines, leaveTable(team, term, width));
  pushSection(lines, closing(team, term, width));
  pushSection(lines, renderProvenance(team.reading, term));
  return lines;
}

function pushSection(lines: string[], section: readonly string[]): void {
  if (section.length === 0) return;
  lines.push("", ...section);
}

/** `--quiet`: the keeper loads as one line each, no bars, no leave column. */
function quietRows(team: TeamReading, term: Term): string[] {
  const names = nameWidth(team.rows.map((row) => row.name));
  return team.rows.map(
    (row) =>
      `${INDENT}${padEnd(truncate(row.name, names, term.glyph("ellipsis")), names)}` +
      ` ${padStart(printedShare(row.units, row.share), SHARE_WIDTH)}` +
      ` ${padStart(formatBytes(row.bytes), BYTES_WIDTH)}`,
  );
}

/**
 * SOLE-KEEPER LOAD — the table, and the sentence that says it adds up.
 *
 * The closing sentence is the guardrail made visible: it names how many rows
 * are standing there and the one denominator they divide, so a reader can add
 * the column themselves and find a hundred. It is generated from the rows
 * rather than written, because a hand-typed "five rows" is a claim the code
 * would stop being able to keep the first time a repository had four.
 */
function keeperTable(team: TeamReading, term: Term, width: number): string[] {
  const rows = team.rows;
  if (rows.length === 0) return [];

  const filesWidth = Math.max(...rows.map((row) => String(row.files).length));
  const notes = rows.map((row, index) => noteFor(row, index, team, term));
  const widestNote = Math.max(...notes.map((note) => note.length));

  // ── THE WIDTH BUDGET, IN PRIORITY ORDER ─────────────────────────────────
  //
  // The row must fit the terminal; everything else is a preference. So the
  // columns give way in the order they can afford to: the BAR first (it is a
  // glance, and the share it encodes is printed right beside it), then the NAME
  // column (down to nine, where a first name still reads). The clause never
  // gives way — `agent-authored, by declared signals` is the sentence that says
  // what the biggest row on most cards actually is.
  const gutters = INDENT.length + 2 + filesWidth + 1 + UNIT_WIDTH + 2 + BYTES_WIDTH + 2 + 1 +
    SHARE_WIDTH;
  const names = nameWidth(
    rows.map((row) => row.name),
    term.width - gutters - widestNote - MIN_BAR_WIDTH,
  );
  const barWidth = Math.max(
    0,
    Math.min(MAX_BAR_WIDTH, term.width - gutters - names - widestNote),
  );

  return [
    ...sectionHead(
      term,
      "SOLE-KEEPER LOAD",
      "code with one human name in its history, largest first",
    ),
    ...rows.map((row, index) =>
      renderRow(row, notes[index], team, term, { names, filesWidth, barWidth }),
    ),
    "",
    ...paragraph(
      `${countWord(rows.length)} ${rows.length === 1 ? "row" : "rows"}, one denominator: ` +
        `they partition the ${formatBytes(team.reading.scoredBytes)} of scored code`,
      width,
    ),
  ];
}

/**
 * The clause after the share — what makes a row's category legible.
 *
 * The first row carries the unit instead ("of the scored code"), because a
 * column of bare percentages needs its denominator naming exactly once and the
 * top row is where a reader's eye lands.
 */
function noteFor(row: KeeperRow, index: number, team: TeamReading, term: Term): string {
  const dot = term.glyph("dot");
  if (row.kind === "shared") return ` ${dot} 2+ human names`;
  // "Agent-authored, by declared signals" only where the label is checkable —
  // every no-human file shows a commit and the reading saw the whole history
  // (`TeamReading.noHumanAgentAuthored`). Outside that, the row states the
  // property that defines it and claims nothing about who wrote the bytes:
  // under a `--since` window, code hand-written before the window would land
  // here, and calling it agent-authored would overstate the very number the
  // provenance block promises is a lower bound.
  if (row.kind === "no-human") {
    return team.noHumanAgentAuthored
      ? ` ${dot} agent-authored, by declared signals`
      : ` ${dot} no human engagement in this reading`;
  }
  if (row.kind === "more") {
    // The bound rounds UP: "none on more than 12K" over a 12.7K load would be
    // checkably false against the same clone. `formatBytesCeil` never prints
    // a figure smaller than the quantity it bounds.
    return ` ${dot} none the only name on more than ${formatBytesCeil(row.largest)}`;
  }
  return index === 0 ? " of the scored code" : "";
}

/**
 * One row: name, files, bytes, bar, share, clause.
 *
 * The bar's DEPTH is the byte-weighted floor score of the code the row stands
 * for — the mini-map's own quantity, so a bar here and a bar there at the same
 * colour mean the same thing. Measured before it is painted: the padding comes
 * off the plain text and the escape wraps only the cells.
 */
function renderRow(
  row: KeeperRow,
  note: string,
  team: TeamReading,
  term: Term,
  columns: { names: number; filesWidth: number; barWidth: number },
): string {
  const { names, filesWidth, barWidth } = columns;
  const share = row.bytes > 0 && team.reading.scoredBytes > 0
    ? row.bytes / team.reading.scoredBytes
    : 0;
  // Every row with bytes in it draws at least one cell: a keeper too small to
  // round up to a cell is still a keeper, and an empty bar reads as "nothing
  // here". A row with no bytes at all draws nothing, which is the truth — and
  // on a card too narrow for a bar column, nobody draws anything.
  const cells =
    barWidth > 0 && row.bytes > 0
      ? Math.min(barWidth, Math.max(1, Math.round(share * barWidth)))
      : 0;
  const bar = term.glyph(depthGlyph(row.depth)).repeat(cells);

  return (
    INDENT +
    padEnd(truncate(row.name, names, term.glyph("ellipsis")), names) +
    "  " +
    padStart(String(row.files), filesWidth) +
    " " +
    // Pluralised, and in a fixed cell: "1 files" is the kind of small
    // carelessness that makes a reader wonder what else was not checked.
    padEnd(row.files === 1 ? "file" : "files", UNIT_WIDTH) +
    "  " +
    padStart(formatBytes(row.bytes), BYTES_WIDTH) +
    "  " +
    term.color(bar, depthColor(row.depth, term.ground)) +
    " ".repeat(Math.max(0, barWidth - cells)) +
    " " +
    padStart(printedShare(row.units, row.share), SHARE_WIDTH) +
    // The clause is dim because it QUALIFIES the share rather than adding to
    // it: "25%" is the reading and "of the scored code" is its unit. Painted
    // last and never padded, so nothing downstream is measuring an escape —
    // the bar budget above sizes itself on the plain clause.
    (note === "" ? "" : term.color(note, "dim"))
  );
}

/**
 * THE DAY THEY LEAVE — the whole reading, recomputed once per person.
 *
 * Not a per-file estimate rolled up and not a share of anything: each row is
 * `scoreRepo` run again with that person's engagement removed, which is
 * literally what `fathohm offboard` prints. Two surfaces, one function.
 *
 * The delta is in POINTS of the printed headline, and it is suppressed the
 * moment the two ends print the same integer — a "+0" would be a claim about a
 * rounding boundary rather than about the repository.
 */
function leaveTable(team: TeamReading, term: Term, width: number): string[] {
  const dot = term.glyph("dot");
  if (team.leave.length === 0) {
    return paragraph(
      team.humans.length === 0
        ? `no human name appears anywhere in this history, so there is nobody to remove.`
        : `nobody listed above is the only name on enough code to move the reading.`,
      width,
    );
  }

  const leaveTitle = "THE DAY THEY LEAVE";
  const head = `${leaveTitle}  ${dot}  `;
  const deltas = team.leave.map(deltaOf);
  const deltaWidth = Math.max(...deltas.map((delta) => delta.length));

  // The " points" unit prints once, on the first numeric delta — decided here
  // rather than while printing, because the WIDTH BUDGET below has to measure
  // the row where the unit will actually land. A cell measured without its
  // own suffix is how a column overflows the day the suffix shows up.
  const suffixes: string[] = [];
  let unitSaid = false;
  for (const delta of deltas) {
    const suffix = delta.startsWith("+") && !unitSaid ? " points" : "";
    if (suffix !== "") unitSaid = true;
    suffixes.push(suffix);
  }

  // ── THE WIDTH BUDGET ────────────────────────────────────────────────────
  //
  // Everything on the row except the name has a fixed cost, and the delta
  // column can carry a 29-character sentence ("moves nothing the card
  // prints"), so the NAME column is the one that gives way — down to the same
  // floor the keeper table holds, where a first name still reads. Without
  // this, the row is sized to the longest untruncated name and overflows the
  // terminal exactly when a long name and a moves-nothing row coexist.
  const arrowCell = ` ${term.glyph("arrow")} `;
  const tailWidth = Math.max(
    0,
    ...deltas.map((delta, index) =>
      delta === "" ? 0 : 3 + deltaWidth + suffixes[index].length,
    ),
  );
  const fixed =
    INDENT.length + "without ".length + 2 + SHARE_WIDTH + arrowCell.length + SHARE_WIDTH;
  const names = nameWidth(
    team.leave.map((row) => row.name),
    term.width - fixed - tailWidth,
  );

  // Painted here rather than through `sectionHead`, because this head hangs:
  // its second line is aligned under the clause, and that alignment is measured
  // on the plain string. Same two roles, applied by hand — title in the
  // structure ink, clause dim, padding outside every escape.
  const lines = [
    INDENT +
      term.color(leaveTitle, structureInk(term.ground)) +
      term.color(`  ${dot}  the whole reading, recomputed without each person`, "dim"),
    INDENT +
      " ".repeat(head.length) +
      term.color("(worst case, git evidence alone)", "dim"),
  ];
  for (let index = 0; index < team.leave.length; index += 1) {
    const row = team.leave[index];
    const delta = deltas[index];
    lines.push(
      INDENT +
        "without " +
        padEnd(truncate(row.name, names, term.glyph("ellipsis")), names) +
        "  " +
        padStart(formatBlindShare(row.before), SHARE_WIDTH) +
        arrowCell +
        term.color(
          padStart(formatBlindShare(row.after), SHARE_WIDTH),
          depthColor(1 - row.after / WHOLE, term.ground),
        ) +
        // Last on the row and omitted entirely when there is nothing to say: a
        // padded empty cell is invisible in a terminal and load-bearing in a
        // golden file.
        (delta === "" ? "" : `   ${padStart(delta, deltaWidth)}${suffixes[index]}`),
    );
  }
  return lines;
}

/** Shares arrive as percents; the depth ramp wants 0–1. */
const WHOLE = 100;

/**
 * The move, in points of the printed headline — or the sentence that refuses to
 * invent one.
 *
 * Only computed where both ends print as plain integers. Inside a display floor
 * (`<1%`, `>99%`) the printed value is deliberately not an integer claim, and
 * subtracting two of them would manufacture a precision the card has just
 * finished declining to offer.
 */
function deltaOf(row: LeaveRow): string {
  const before = formatBlindShare(row.before);
  const after = formatBlindShare(row.after);
  if (before === after) return "moves nothing the card prints";
  const from = Number.parseInt(before, 10);
  const to = Number.parseInt(after, 10);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "";
  return `+${to - from}`;
}

/**
 * The one command that takes a row of this card and opens it.
 *
 * Nothing at all on a history with no human names in it: a nudge to offboard
 * somebody, on a card that has just said there is nobody, is a dead end printed
 * as a next step.
 *
 * A `--without` baseline travels with the command: this table's numbers were
 * computed under it, and the suggested offboard has to reproduce them rather
 * than open a different reading.
 */
function closing(team: TeamReading, term: Term, width: number): string[] {
  const first = team.leave[0]?.name ?? team.humans[0]?.name;
  if (first === undefined) return [];
  const baselineFlags = team.reading.withoutMatches
    .map((match) => ` --without ${quoteArg(match.query)}`)
    .join("");
  // Built once and handed to both the sentence and the painter, so the token
  // being coloured is the token being printed rather than a copy of it.
  const route = `fathohm offboard ${quoteArg(first)}${baselineFlags}`;
  return runnable(term, paragraph(`the handover for one person: ${route}`, width), route);
}
