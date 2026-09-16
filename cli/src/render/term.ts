/**
 * Terminal discipline: colour, width, glyphs. One handle, injected everywhere,
 * so a renderer can never reach for `process.stdout` behind the harness's back
 * — that is what makes the golden-file tests possible at all.
 */

/** Named SGR foregrounds/attributes. A number is a 256-colour foreground. */
export type ColorName =
  | "bold"
  | "dim"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray";

export type ColorCode = ColorName | number;

/**
 * WHAT THE TERMINAL IS PAINTING ONTO.
 *
 * Not a preference — a fact about the reader's screen that every colour
 * decision depends on and that the CLI used to have no opinion about. One
 * palette was picked to survive both grounds at once, which is unsatisfiable
 * for a nine-step scale (see `ramp.ts`) and is what left the old neutral
 * midpoint at 1.85:1 on black and the old blue pole at 2.32:1 on white.
 *
 * Dark is the default because it is the commoner terminal and because a wrong
 * guess toward dark degrades more gently: a light-ground reader sees colours
 * that are too bright, not colours that are absent.
 */
export type Ground = "dark" | "light";

/**
 * The environment, as the terminal layer needs it: a string map, nothing more.
 * Deliberately not `NodeJS.ProcessEnv` — that type carries app-specific
 * required keys in this repo, and a test that wants "no environment at all"
 * must be able to pass `{}`.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

const SGR: Record<ColorName, number> = {
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
};

const RESET = "\u001b[0m";

/**
 * The single source of glyph pairs: [unicode, ascii]. `--ascii` swaps the
 * column, nothing else. Adding a glyph anywhere else in the CLI is a bug —
 * the swap has to be total or `--ascii` is a half-promise.
 *
 * The eight `block*` glyphs are the ramp used by the mini-map and the tide
 * strip; in ascii they collapse to the two-step `.`/`#` pair (the ramp still
 * ranks, it just ranks coarsely — an honest degrade, not a fake gradient).
 */
const GLYPHS = {
  bullet: ["•", "*"],
  arrow: ["→", "->"],
  ok: ["✓", "+"],
  fail: ["✗", "x"],
  dot: ["·", "."],
  dash: ["—", "--"],
  /** The interval's own punctuation: `12%–47%`. An em dash is a break in a
   *  sentence; an en dash is a RANGE, and the headline is a range. */
  endash: ["–", "-"],
  rule: ["─", "-"],
  vrule: ["│", "|"],
  ellipsis: ["…", "..."],
  /** The interactive layer's three: the row under the cursor, and the two keys
   *  that move it. They are glyphs like any other — the picker is bytes on a
   *  terminal, and `--ascii` owes it the same total swap it owes the card. */
  cursor: ["❯", ">"],
  up: ["↑", "^"],
  down: ["↓", "v"],
  /**
   * The mini-map's LIT cell — the part of a bar that is not dark.
   *
   * A bar has to be visible before either of its encodings can be read, and
   * the depth ramp's bottom rung (`block1`, `▁`) is a hairline on the baseline:
   * a directory with nothing dark in it drew as an underscore, which on a
   * repository with nothing dark anywhere made every row of the chart look
   * empty. A light shade holds the same "quiet" reading while still occupying
   * its cell, so bar LENGTH survives at every darkness.
   */
  shade: ["░", "."],
  block1: ["▁", "."],
  block2: ["▂", "."],
  block3: ["▃", "."],
  block4: ["▄", "."],
  block5: ["▅", "#"],
  block6: ["▆", "#"],
  block7: ["▇", "#"],
  block8: ["█", "#"],
} as const satisfies Record<string, readonly [string, string]>;

export type GlyphName = keyof typeof GLYPHS;

/** The ramp, low to high — read it through `term.glyph` so `--ascii` applies. */
export const BLOCK_RAMP: readonly GlyphName[] = [
  "block1",
  "block2",
  "block3",
  "block4",
  "block5",
  "block6",
  "block7",
  "block8",
];

/**
 * THE CURSOR CONTROLS, and the only place in the CLI that writes an escape
 * that is not a colour.
 *
 * These are not glyphs. A glyph is a character that lands on the screen and
 * owes `--ascii` a twin; these print nothing at all and have no ascii form —
 * a terminal either moves its cursor or it does not. But they live beside the
 * glyphs for the same reason the glyphs live in one table: an escape sequence
 * written inline somewhere is an escape sequence nobody finds again.
 *
 * NO ALTERNATE SCREEN. There is deliberately no smcup/rmcup pair here. The
 * card is the artefact people screenshot and send on, and an alt-screen
 * session ends by wiping the terminal back to what was there before it — which
 * would mean the tool's whole output vanished the moment somebody pressed `q`.
 * The interactive layer appends below the card and erases only its own lines.
 */
export const ANSI = {
  /** Up `count` lines, column unchanged. Nothing at all for a non-positive count. */
  cursorUp: (count: number): string =>
    Number.isFinite(count) && count > 0 ? `\u001b[${Math.floor(count)}A` : "",
  /** Erase from the cursor to the end of the screen. */
  eraseDown: "\u001b[0J",
  hideCursor: "\u001b[?25l",
  showCursor: "\u001b[?25h",
} as const;

/** Below 80 columns the card stops being a card, so 80 is a floor, not a default. */
export const MIN_WIDTH = 80;

export interface Term {
  /**
   * Wraps `text` in `code` when colour is live; returns `text` untouched
   * otherwise. A LIST of codes is emitted as one sequence with one reset —
   * nesting two `color` calls instead would leave a redundant reset in the
   * middle of the output, which is a difference anything scanning the rendered
   * text can see (a URL guard here read one as part of the URL).
   */
  readonly color: (text: string, code: ColorCode | readonly ColorCode[]) => string;
  readonly width: number;
  readonly glyph: (name: GlyphName) => string;
  readonly colorEnabled: boolean;
  readonly ascii: boolean;
  /** The ground every ink on this handle was chosen for. */
  readonly ground: Ground;
}

export interface TermOptions {
  /** The `--no-color` flag. Explicit refusal beats every environment signal. */
  readonly noColor?: boolean;
  /** The `--ascii` flag. */
  readonly ascii?: boolean;
  /** `--light` / `--dark`. Null when the reader did not say, which is usual. */
  readonly ground?: Ground | null;
  readonly env?: EnvLike;
  readonly isTTY?: boolean;
  readonly columns?: number;
}

export function createTerm(options: TermOptions = {}): Term {
  // Named, not the whole environment: a caller that supplies none still only
  // exposes the four variables a terminal is asked about.
  const env = options.env ?? {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    COLORFGBG: process.env.COLORFGBG,
    COLUMNS: process.env.COLUMNS,
  };
  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const columns = options.columns ?? process.stdout.columns;

  const colorEnabled = resolveColor({
    noColorFlag: options.noColor === true,
    env,
    isTTY,
  });
  const ascii = options.ascii === true;
  const width = resolveWidth(env, columns);
  const ground = resolveGround(options.ground ?? null, env);

  return {
    colorEnabled,
    ascii,
    width,
    ground,
    color(text, code) {
      if (!colorEnabled || text === "") return text;
      const codes: readonly ColorCode[] = Array.isArray(code)
        ? (code as readonly ColorCode[])
        : [code as ColorCode];
      if (codes.length === 0) return text;
      return `\u001b[${codes.map(sgrFor).join(";")}m${text}${RESET}`;
    },
    glyph(name) {
      return GLYPHS[name][ascii ? 1 : 0];
    },
  };
}

/**
 * Precedence, deliberately "off wins":
 *   1. `--no-color` — the user said so on this invocation.
 *   2. `NO_COLOR` set to anything non-empty (no-color.org).
 *   3. `FORCE_COLOR` — "0"/"false" off, anything else on.
 *   4. otherwise: colour iff stdout is a TTY.
 * A terminal that cannot render ANSI is a worse failure than a terminal that
 * could have but did not, so the refusals sit above the forcings.
 */
function resolveColor(input: {
  noColorFlag: boolean;
  env: EnvLike;
  isTTY: boolean;
}): boolean {
  if (input.noColorFlag) return false;

  const noColor = input.env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") return false;

  const forceColor = input.env.FORCE_COLOR;
  if (forceColor !== undefined) return forceColor !== "0" && forceColor !== "false";

  return input.isTTY;
}

/**
 * Which ground, deliberately "the reader wins, then the terminal, then dark":
 *   1. `--light` / `--dark` — the user said so on this invocation.
 *   2. `COLORFGBG` — the terminal said so. Set by rxvt, konsole and others as
 *      `fg;bg` or `fg;default;bg`; the BACKGROUND is always the last field.
 *   3. otherwise: dark.
 *
 * NO OSC 11 QUERY. Asking the terminal directly means writing an escape to
 * stdout and reading the answer back off stdin with a timeout, inside a tool
 * whose output people pipe, redirect and paste. A wrong guess costs some
 * contrast; a query that hangs costs the run.
 *
 * The ANSI background numbers split the way every terminal's own palette does:
 * 0–6 and 8 are the dark half, 7 and 9–15 the light half. Anything else — an
 * unset variable, `default`, a 256-index we cannot interpret — is not a signal
 * and falls through to the default rather than guessing from it.
 */
export function resolveGround(flag: Ground | null, env: EnvLike): Ground {
  if (flag !== null) return flag;

  const declared = env.COLORFGBG;
  if (declared !== undefined && declared !== "") {
    const fields = declared.split(";");
    const background = Number.parseInt(fields[fields.length - 1] ?? "", 10);
    if (Number.isInteger(background) && background >= 0 && background <= 15) {
      return background === 7 || background >= 9 ? "light" : "dark";
    }
  }

  return "dark";
}

function resolveWidth(env: EnvLike, columns: number | undefined): number {
  const declared = env.COLUMNS === undefined ? Number.NaN : Number.parseInt(env.COLUMNS, 10);
  if (Number.isFinite(declared) && declared > 0) return Math.max(MIN_WIDTH, declared);
  if (typeof columns === "number" && Number.isFinite(columns) && columns > 0) {
    return Math.max(MIN_WIDTH, Math.floor(columns));
  }
  return MIN_WIDTH;
}

function sgrFor(code: ColorCode): string {
  if (typeof code === "number") {
    const index = Math.min(255, Math.max(0, Math.round(code)));
    return `38;5;${index}`;
  }
  return String(SGR[code]);
}
