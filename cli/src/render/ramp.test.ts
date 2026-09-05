import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BRIDGE_DEPTH, DIVERGING, scoreColor } from "../../../lib/palette";
import { MIXED, PROMPTED_DOMINANT, readingOf } from "../../test-helpers/reading-fixtures";
import { isDark } from "../reading/dark";
import { BLOCK_RAMP, createTerm, type Ground } from "./term";
import {
  ARM_MARGIN,
  chromaOf,
  contrastRatio,
  DARK_256,
  DARK_INK,
  depthColor,
  depthGlyph,
  hueGap,
  hueOf,
  LIGHT_256,
  LIGHT_INK,
  luminance,
  nearest256,
  SCALE_ARMS,
  structureInk,
  xterm256Rgb,
} from "./ramp";
import { miniMapRows, renderMiniMap } from "./minimap";

describe("the CLI paints on the PUBLIC scale", () => {
  it("resolves DIVERGING into one table per ground, stop for stop", () => {
    for (const table of TABLES) {
      expect(table).toHaveLength(DIVERGING.length);
      for (const index of table) expect(Number.isInteger(index)).toBe(true);
    }
    // The two tables are answers to the same question asked of different
    // screens, so they may only agree where the answer genuinely is the same:
    // the midpoint is a grey, and a grey that clears the floor on one ground
    // has a fair chance of clearing it on the other.
    const shared = DARK_256.filter((index) => LIGHT_256.includes(index));
    expect(shared.length).toBeLessThan(DIVERGING.length);
  });

  it("never touches the dashboard's Bridge scale, and restates no hex of its own", () => {
    // The boundary lib/bridge-v1.guardrail.test.ts polices inside the app,
    // applied to the most public surface this product has: `npx fathohm` runs
    // on a stranger's laptop before they have an account, so it ships the
    // landing page's ramp and not the one behind the login.
    // Comments are stripped: the module note NAMES the other scale in order
    // to say it is not used here, and a check that forbade the word would
    // forbid explaining the boundary.
    const source = readFileSync("cli/src/render/ramp.ts", "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n");
    expect(source).not.toMatch(/BRIDGE_DEPTH|BRIDGE_AUTHORSHIP|bridgeScoreColor/);
    for (const hex of BRIDGE_DEPTH) expect(source).not.toContain(hex);
    // Nor DIVERGING's own literals: the ramp is IMPORTED, so retuning the
    // public scale retunes the terminal without anyone remembering to.
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("buckets exactly as scoreColor does, on either ground", () => {
    // The GROUND decides how a bucket is drawn and never which bucket a value
    // falls in. That split is what lets the terminal and the gallery disagree
    // about escape codes while agreeing about readings.
    for (const [ground, table] of GROUNDS) {
      for (let score = 0; score <= 1.0001; score += 0.01) {
        const expected = (DIVERGING as readonly string[]).indexOf(scoreColor(Math.min(1, score)));
        expect(depthColor(Math.min(1, score), ground)).toBe(table[expected]);
      }
    }
  });
});

/** The ground each table was picked for, and the luminance it lands on. */
const GROUNDS: readonly (readonly [Ground, readonly number[], number])[] = [
  ["dark", DARK_256, luminance([0, 0, 0])],
  ["light", LIGHT_256, luminance([255, 255, 255])],
];
const TABLES = [DARK_256, LIGHT_256] as const;

/** The floor every ink is picked against. Kept here so the test states it too. */
const FLOOR = 4.5;

describe("each table is legible on the ground it was picked for", () => {
  it("clears 4.5:1 for every stop", () => {
    for (const [, table, ground] of GROUNDS) {
      for (const index of table) {
        expect(contrastRatio(luminance(xterm256Rgb(index)), ground)).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  });

  it("pins the two readings the single table used to ship", () => {
    // Not history for its own sake: these are the exact indexes a "let's go back
    // to one table" change would reach for, and this is what they cost. 237 was
    // the neutral midpoint and 75 was every lit cell in every bar.
    const [, , BLACK] = GROUNDS[0];
    const [, , WHITE] = GROUNDS[1];
    expect(contrastRatio(luminance(xterm256Rgb(237)), BLACK)).toBeLessThan(2);
    expect(contrastRatio(luminance(xterm256Rgb(75)), WHITE)).toBeLessThan(3);
  });

  it("cannot be one table, and the cube says so by counting", () => {
    // THE RESULT THAT FORCES TWO TABLES. A scale needs `DIVERGING.length`
    // distinct colours. Far fewer than that many indexes in the whole 256-cube
    // clear the text floor on a black terminal AND a white one — six, at the
    // time of writing — so one table serving both grounds cannot even be dealt
    // a full hand, let alone a vivid one. Asserted as the pigeonhole rather
    // than as the number, because the number is a fact about WCAG and the cube
    // and the pigeonhole is the reason.
    const [, , BLACK] = GROUNDS[0];
    const [, , WHITE] = GROUNDS[1];
    const safeOnBoth: number[] = [];
    for (let index = 16; index <= 255; index += 1) {
      const light = luminance(xterm256Rgb(index));
      if (contrastRatio(light, BLACK) >= FLOOR && contrastRatio(light, WHITE) >= FLOOR) {
        safeOnBoth.push(index);
      }
    }
    expect(safeOnBoth.length).toBeGreaterThan(0);
    expect(safeOnBoth.length).toBeLessThan(DIVERGING.length);
  });
});

describe("each arm is ordered by chroma, loudest at the pole", () => {
  it("falls from both poles toward the midpoint", () => {
    // The ordering axis, and the reason the ramp reads as a ramp. Lightness
    // cannot do this job: the contrast floor compresses it from a different
    // side on each ground, and on black nothing red survives below about
    // lightness 50, which left the red arm in no order at all.
    for (const table of TABLES) {
      const middle = Math.floor(table.length / 2);
      const chroma = table.map((index) => chromaOf(xterm256Rgb(index)));
      for (let step = 1; step <= middle; step += 1) {
        expect(chroma[step]).toBeLessThan(chroma[step - 1]);
        expect(chroma[table.length - 1 - step]).toBeLessThan(chroma[table.length - step]);
      }
    }
  });

  it("keeps the midpoint colourless, so it can never be mistaken for an arm", () => {
    for (const table of TABLES) {
      expect(chromaOf(xterm256Rgb(table[Math.floor(table.length / 2)]))).toBe(0);
    }
  });
});

describe("the 256-colour mapping", () => {
  it("stays out of the sixteen indexes a user's theme redefines", () => {
    for (const table of TABLES) {
      for (const index of table) expect(index).toBeGreaterThanOrEqual(16);
      for (const index of table) expect(index).toBeLessThanOrEqual(255);
    }
    for (const ink of [DARK_INK, LIGHT_INK]) {
      expect(ink).toBeGreaterThanOrEqual(16);
      expect(ink).toBeLessThanOrEqual(255);
    }
  });

  it("resolves the colour cube the way xterm does", () => {
    expect(xterm256Rgb(16)).toEqual([0, 0, 0]);
    expect(xterm256Rgb(231)).toEqual([255, 255, 255]);
    expect(xterm256Rgb(232)).toEqual([8, 8, 8]);
    expect(xterm256Rgb(255)).toEqual([238, 238, 238]);
    // 196 is xterm's pure red: cube coordinates (5, 0, 0).
    expect(xterm256Rgb(196)).toEqual([255, 0, 0]);
  });

  it("spends a distinct index on every stop", () => {
    // IT DID NOT USED TO. Nearest-neighbour matching sent `#e66767` and
    // `#c44c4a` both to xterm 167, so the two deepest blind-spot buckets
    // rendered identically in every terminal and a nine-step scale was really
    // eight — at the alarm end, where the collision costs most. Nothing checked,
    // because "the terminal is lossy" was true enough to stop anyone looking.
    for (const table of TABLES) expect(new Set(table).size).toBe(table.length);
    // The block height remains a second, independent encoding of the same fact:
    // that is what survives `--no-color`, and it is why colour may stay a layer.
    expect(depthGlyph(0.05)).not.toBe(depthGlyph(0.15));
  });
});

describe("deep is tall", () => {
  it("draws the least-understood value with the fullest block", () => {
    expect(depthGlyph(0)).toBe(BLOCK_RAMP[BLOCK_RAMP.length - 1]);
    expect(depthGlyph(1)).toBe(BLOCK_RAMP[0]);
  });

  it("never rises as comprehension rises", () => {
    let previous = BLOCK_RAMP.length;
    for (let value = 0; value <= 1.0001; value += 0.01) {
      const height = BLOCK_RAMP.indexOf(depthGlyph(Math.min(1, value)));
      expect(height).toBeLessThanOrEqual(previous);
      previous = height;
    }
  });

  it("clamps rather than throwing on values off the scale", () => {
    expect(depthGlyph(-1)).toBe(depthGlyph(0));
    expect(depthGlyph(2)).toBe(depthGlyph(1));
    for (const [ground] of GROUNDS) {
      expect(depthColor(Number.NaN, ground)).toBe(depthColor(0, ground));
    }
  });
});

describe("the mini-map", () => {
  const { reading } = readingOf(MIXED);

  it("groups by top-level directory, heaviest first", () => {
    const rows = miniMapRows(reading);
    expect(rows.map((row) => row.name)).toContain("workers/");
    expect(rows.map((row) => row.name)).toContain("./");
    const bytes = rows.map((row) => row.bytes);
    expect(bytes).toEqual([...bytes].sort((a, b) => b - a));
  });

  it("weights each row's dark share by bytes, so a config cannot out-vote a parser", () => {
    // WHAT THE ROW CARRIES CHANGED AT 1.5.0: `score` (the byte-weighted mean
    // comprehension score) is gone and `darkShare` replaced it, because the
    // headline above the map is now the dark share and a bar ramping on a
    // different quantity than the number over it is two scales on one card.
    // The WEIGHTING is the property this test has always defended and it is
    // unchanged: bytes, not files, so a four-line config cannot out-vote a
    // four-thousand-line parser.
    const rows = miniMapRows(reading);
    const DIR = "lib/";
    const row = rows.find((entry) => entry.name === DIR);
    const files = reading.files.filter((file) => file.path.startsWith(DIR));
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    const dark = files.reduce((sum, file) => (isDark(file) ? sum + file.bytes : sum), 0);
    expect(row?.darkShare).toBeCloseTo(dark / total, 12);
    // Not vacuous: this directory has to hold files on both sides of the
    // predicate, or a byte weighting and a file weighting would agree.
    expect(files.some(isDark)).not.toBe(files.every(isDark));
  });

  it("folds the tail rather than dropping it — the bars are the whole repository", () => {
    const rows = miniMapRows(reading, 3);
    expect(rows).toHaveLength(3);
    expect(rows[2].directoryCount).toBeGreaterThan(1);
    const total = rows.reduce((sum, row) => sum + row.bytes, 0);
    expect(total).toBe(reading.scoredBytes);
  });

  it("draws at least one cell for a directory too small to round up to one", () => {
    const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
    // `scripts/` is under a thousandth of this tree. An empty bar would read
    // as "nothing here", which is the opposite of what a small directory is.
    const tiny = readingOf(PROMPTED_DOMINANT).reading;
    const rows = miniMapRows(tiny);
    const smallest = rows[rows.length - 1];
    expect(smallest.share).toBeLessThan(0.01);
    const line = renderMiniMap(tiny, term).find((row) => row.includes(smallest.name));
    expect(line).toBeDefined();
    expect(line?.slice(smallest.name.length + 2)).toMatch(/[.#]/);
  });

  it("renders one line per row, always", () => {
    const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
    expect(renderMiniMap(reading, term)).toHaveLength(miniMapRows(reading).length);
  });
});


describe("the structure ink", () => {
  const INKS: readonly (readonly [Ground, number, number])[] = [
    ["dark", DARK_INK, luminance([0, 0, 0])],
    ["light", LIGHT_INK, luminance([255, 255, 255])],
  ];

  it("is reachable through the ground, and only through it", () => {
    for (const [ground, ink] of INKS) expect(structureInk(ground)).toBe(ink);
    expect(DARK_INK).not.toBe(LIGHT_INK);
  });

  it("is not a colour either depth ramp uses", () => {
    // THE SEPARATION THE WHOLE PALETTE RESTS ON. Every ramp index means a
    // comprehension value somewhere on the same screen, so chrome wearing one
    // would be a number-coloured word that is not a number. "Harmonising" the
    // headings onto the ramp is the tidy-looking change that would do it — and
    // BOTH tables have to be checked, not just the one this ground draws: a
    // reader on a light terminal must not meet a heading in a colour the dark
    // table spends on a reading.
    for (const [, ink] of INKS) {
      expect(DARK_256).not.toContain(ink);
      expect(LIGHT_256).not.toContain(ink);
    }
  });

  it("stays clear of both arms of the scale by hue, not by luck", () => {
    // The rule that eliminated every accent anyone reaches for first. The scale
    // is a red arm and a blue arm; chrome that drifts toward either starts
    // reading as a warm or a cool measurement. Amber lands 33 degrees from the
    // red arm, hot pink 27, and cyan 12 from the blue arm — all inside the
    // margin, all rejected by this, and `#005f87` is literally a ramp index.
    for (const [, ink] of INKS) {
      const hue = hueOf(xterm256Rgb(ink));
      expect(hue).toBeGreaterThanOrEqual(0);
      for (const arm of SCALE_ARMS) expect(hueGap(hue, arm)).toBeGreaterThanOrEqual(ARM_MARGIN);
    }
  });

  it("clears the text floor on the ground it was picked for", () => {
    // A PROPERTY, NOT A MEASUREMENT. It fails if an accent is ever retuned to
    // something that only looks right, which is the failure `lib/palette.ts`
    // records `ink4` shipping at 2.99:1.
    for (const [, ink, ground] of INKS) {
      expect(contrastRatio(luminance(xterm256Rgb(ink)), ground)).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it("is more colourful than anything one shared accent could have been", () => {
    // WHY THE VIOLET LOOKED FADED, as an assertion rather than an opinion. An
    // ink serving both grounds is confined to the middle of the cube, and the
    // most colourful thing in there is well short of what either ground alone
    // can carry. The old accent sat at 0.31. This fails the moment someone
    // reintroduces a single shared accent, which is the change that would undo
    // the whole point while looking like a simplification.
    const [, , BLACK] = INKS[0];
    const [, , WHITE] = INKS[1];
    let bestShared = 0;
    for (let index = 16; index <= 255; index += 1) {
      const rgb = xterm256Rgb(index);
      const light = luminance(rgb);
      if (contrastRatio(light, BLACK) < FLOOR || contrastRatio(light, WHITE) < FLOOR) continue;
      bestShared = Math.max(bestShared, chromaOf(rgb));
    }
    for (const [, ink] of INKS) {
      expect(chromaOf(xterm256Rgb(ink))).toBeGreaterThanOrEqual(bestShared);
    }
    // And the specific colour that shipped, so the regression has a name.
    expect(chromaOf(xterm256Rgb(97))).toBeLessThan(bestShared);
  });

  it("is not what nearest-neighbour matching would have returned", () => {
    // `nearest256` is still exported and still correct for "which index is
    // closest to this hex". It is simply not the question the tables answer,
    // and this keeps the two from being quietly merged again.
    for (const hex of DIVERGING) {
      expect(nearest256(hex)).toBeGreaterThanOrEqual(16);
    }
    expect(DIVERGING.map(nearest256)).not.toEqual([...DARK_256]);
    expect(DIVERGING.map(nearest256)).not.toEqual([...LIGHT_256]);
  });
});
