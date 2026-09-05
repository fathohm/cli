import { DIVERGING, scoreColor } from "../../../lib/palette";
import { BLOCK_RAMP, type GlyphName, type Ground } from "./term";

/**
 * DEPTH, in a terminal: which colour and which block a comprehension value is
 * drawn with — and, since the ground became knowable, which of TWO tables that
 * colour comes out of.
 *
 * **Which scale.** The public one. `lib/palette.ts` carries two diverging
 * ramps and a boundary between them: `BRIDGE_DEPTH` is the dashboard's,
 * behind the login, and `DIVERGING` is what the landing page, the gallery and
 * the OG images ship. `npx fathohm` is the most public surface this product
 * has — it runs on a stranger's laptop before they have an account — so it
 * takes `DIVERGING`, and it takes it by import: the hexes are not restated
 * here, and `scoreColor` still does the BUCKETING, so a terminal cell and a
 * gallery cell at the same score are the same bucket by construction. What
 * changed is only how a bucket resolves into an escape code.
 *
 * **Why two tables.** One table had to survive a black terminal and a white
 * one at the same time, and the only colours that manage that live in the
 * middle of the 256-cube away from every edge. The cost was measured rather
 * than argued: the old neutral midpoint was **1.85:1 on black** and the old
 * blue pole — every lit cell in every bar — was **2.32:1 on white**, both far
 * under the 4.5:1 floor for text. Searching the whole cube for a nine-step
 * ramp that clears 4.5 on BOTH grounds returns three distinct colours and a
 * green midpoint. It is not a tuning problem, it is unsatisfiable, and holding
 * the requirement anyway is what produced a chrome ink at 0.31 chroma.
 *
 * So the ground is resolved once, in `term.ts`, and every ink is picked for
 * the ground it will actually land on. `--no-color` and `--ascii` are unchanged
 * by any of it: the block's HEIGHT still carries the depth on its own.
 *
 * **How a hex becomes a terminal colour.** Truecolour is not reliably
 * available (tmux, CI logs, Windows consoles), so each bucket is resolved to an
 * xterm-256 index — computed here from the palette's own definition rather than
 * eyeballed into a table, so if the ramp is ever retuned the terminal follows
 * without anyone remembering to. Indexes 0–15 are excluded from the search on
 * purpose: they are whatever the user's theme says they are, and a scale that
 * changes meaning with the reader's colour scheme is not a scale.
 *
 * **Which way is up.** Deep is bad. A block's HEIGHT is the depth — a full `█`
 * is a directory nobody understands, a `▁` is one that is well understood —
 * and the colour is the same fact on the same ramp, red at the deep end. Height
 * and hue alarm together, which is what makes `--no-color` and `--ascii` an
 * honest degrade rather than a loss of the encoding.
 */

/** The six levels an xterm-256 colour-cube channel can take. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;
const CUBE_FIRST = 16;
const CUBE_LAST = 231;
const GRAY_FIRST = 232;
const GRAY_LAST = 255;

type Rgb = readonly [number, number, number];

/** The RGB an index paints, for the two ranges a terminal cannot re-theme. */
export function xterm256Rgb(index: number): Rgb {
  if (index <= CUBE_LAST) {
    const offset = index - CUBE_FIRST;
    const red = Math.floor(offset / 36);
    const green = Math.floor(offset / 6) - red * 6;
    const blue = offset - red * 36 - green * 6;
    return [CUBE_LEVELS[red], CUBE_LEVELS[green], CUBE_LEVELS[blue]];
  }
  const level = 8 + (index - GRAY_FIRST) * 10;
  return [level, level, level];
}

function parseHex(hex: string): Rgb {
  const digits = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

/**
 * The closest index in the stable part of the 256-colour palette. Plain
 * squared distance in RGB. Retained because it is the honest answer to "which
 * index is nearest this hex", which is a different question from "which index
 * should carry this bucket on this ground" — the tables below answer the
 * second, and the first is still what a caller wants when no ground is in play.
 * Ties go to the lower index so two machines never disagree.
 */
export function nearest256(hex: string): number {
  const [red, green, blue] = parseHex(hex);
  let best = CUBE_FIRST;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = CUBE_FIRST; index <= GRAY_LAST; index += 1) {
    const [r, g, b] = xterm256Rgb(index);
    const distance = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// COLOUR MEASUREMENT — the three properties every pick below is chosen by.
// ---------------------------------------------------------------------------

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance([red, green, blue]: Rgb): number {
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** WCAG contrast ratio between two luminances. */
export function contrastRatio(a: number, b: number): number {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return (high + 0.05) / (low + 0.05);
}

/**
 * Colourfulness as `(max − min) / 255`, deliberately NOT HSL saturation.
 *
 * HSL calls `#ffffd7` fully saturated, which is true by its definition and
 * useless here: that colour is white with a hint. Every "make it more vivid"
 * decision in this file is a decision about how far apart the channels are, and
 * this is that number.
 */
export function chromaOf([red, green, blue]: Rgb): number {
  return (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
}

/** HSL lightness, 0–100. */
export function lightnessOf([red, green, blue]: Rgb): number {
  return ((Math.max(red, green, blue) + Math.min(red, green, blue)) / 2 / 255) * 100;
}

/** A full turn of the colour wheel, and half of one, derived rather than typed.
 *
 *  `cli/test/scoring-constants.test.ts` forbids a bare `180` anywhere in the
 *  CLI, and it is right to: in this codebase that number is almost always the
 *  recency window in days, and a second definition of it is a defect nobody
 *  would ever see move. Half a turn is genuinely half a turn, so it says so. */
const FULL_TURN = 360;
const HALF_TURN = FULL_TURN / 2;

/**
 * Floored remainder — modulo, written without the operator.
 *
 * `discipline.test.ts` bans the percent sign from every renderer source, not
 * the string `42%` but the character: it only ever reaches the terminal through
 * `lib/blind-share-format`, which owns the `<1%` and `>99%` floors, and a
 * renderer formatting its own share has bypassed them. A regex cannot tell that
 * glyph apart from an arithmetic operator, so the rule is kept and the
 * arithmetic is reworded, the same way `bignum.ts` names its percent sign by
 * code point rather than asking for an exemption.
 *
 * FLOORED, NOT TRUNCATED, which is the version hue maths actually wants: a
 * negative angle comes back on the wheel instead of staying negative.
 */
function wrap(value: number, span: number): number {
  return value - Math.floor(value / span) * span;
}

/** HSL hue in degrees, or −1 for a grey, which has no hue to compare. */
export function hueOf([red, green, blue]: Rgb): number {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  if (span === 0) return -1;
  const sixth = FULL_TURN / 6;
  const degrees =
    max === red
      ? sixth * ((green - blue) / span)
      : max === green
        ? sixth * ((blue - red) / span + 2)
        : sixth * ((red - green) / span + 4);
  return wrap(degrees, FULL_TURN);
}

/** The shorter way round the wheel between two hues. */
export function hueGap(a: number, b: number): number {
  const raw = wrap(Math.abs(a - b), FULL_TURN);
  return raw > HALF_TURN ? FULL_TURN - raw : raw;
}

/** The luminance of each ground, so a pick knows what it will land on. */
const GROUND_LUMINANCE: Record<Ground, number> = {
  dark: luminance([0, 0, 0]),
  light: luminance([255, 255, 255]),
};

/**
 * The contrast a coloured run must clear against its own ground.
 *
 * 4.5:1, the WCAG floor for text, applied to every ink including the ones that
 * only ever draw bars. A bar could defend 3:1 as a non-text graphic, but the
 * same index paints the share beside it on the same line, and two floors for
 * one colour is how a colour ends up meeting neither.
 */
const CONTRAST_FLOOR = 4.5;

/** A grey is anything this close to colourless; below it, hue is noise. */
const GREY_CHROMA = 0.06;

/** How far a pick may drift in hue from the bucket it stands for. */
const HUE_TOLERANCE = 16;

interface Wanted {
  readonly hue: number;
  readonly lightness: number;
  readonly grey: boolean;
}

/**
 * What a ground wants each bucket to look like.
 *
 * Hue and greyness come straight from the palette — those are the meaning, and
 * the meaning does not move. LIGHTNESS IS MIRRORED FOR A LIGHT GROUND, because
 * `DIVERGING` is authored against a dark page: its poles are bright and its
 * midpoint is nearly black, which is exactly inverted from what a white
 * terminal needs. It is only a preference here, never a constraint — see
 * {@link pickIndex} for why chroma does the ordering instead.
 */
function wantedFor(hex: string, ground: Ground): Wanted {
  const rgb = parseHex(hex);
  const lightness = lightnessOf(rgb);
  return {
    hue: hueOf(rgb),
    lightness: ground === "dark" ? lightness : 100 - lightness,
    grey: chromaOf(rgb) < GREY_CHROMA,
  };
}

/**
 * The most colourful index left in this arm that clears the floor.
 *
 * CHROMA IS THE ORDERING AXIS, and that took two wrong attempts to see.
 * Lightness is the obvious choice — a ramp looks like a lightness ramp — but
 * the contrast floor compresses lightness from one side and it compresses a
 * different side on each ground. On black nothing red survives below about
 * lightness 50, so the palette's four-step red arm (65 down to 37) has nowhere
 * to go and the arm comes out as four reds in no order. Chroma has room on
 * both grounds, it is what "loud" actually means at the poles of a diverging
 * scale, and it is already the shape of the source palette: `#e66767` carries
 * 0.50 and the midpoint carries 0.01.
 *
 * So each arm is walked from its POLE inward under a strictly falling chroma
 * ceiling, taking the most colourful thing still available at each step.
 * Lightness survives only as the tie-break, which is what keeps `#af5f5f`
 * rather than `#d78787` when both sit at 0.31.
 */
function pickIndex(
  want: Wanted,
  ground: Ground,
  taken: ReadonlySet<number>,
  chromaCeiling: number | null,
): number {
  const groundLuminance = GROUND_LUMINANCE[ground];
  let best = -1;
  let bestChroma = -1;
  let bestDrift = Number.POSITIVE_INFINITY;
  for (let index = CUBE_FIRST; index <= GRAY_LAST; index += 1) {
    if (taken.has(index)) continue;
    const rgb = xterm256Rgb(index);
    if (contrastRatio(luminance(rgb), groundLuminance) < CONTRAST_FLOOR) continue;
    const chroma = chromaOf(rgb);
    if (want.grey) {
      if (chroma > GREY_CHROMA) continue;
    } else {
      const hue = hueOf(rgb);
      if (hue < 0 || hueGap(hue, want.hue) > HUE_TOLERANCE) continue;
      if (chromaCeiling !== null && chroma >= chromaCeiling) continue;
    }
    const drift = Math.abs(lightnessOf(rgb) - want.lightness);
    if (chroma > bestChroma || (chroma === bestChroma && drift < bestDrift)) {
      best = index;
      bestChroma = chroma;
      bestDrift = drift;
    }
  }
  return best;
}

/**
 * `DIVERGING`, resolved for one ground: nine distinct indexes, in order.
 *
 * Walked as three pieces — each arm from its pole inward, then the midpoint —
 * because the chroma ceiling only means anything within an arm. The midpoint is
 * picked last and unconstrained: it is a grey, it cannot be confused with
 * either arm, and on a dark ground the contrast floor is what lifts it off the
 * 1.85:1 it used to sit at.
 */
function tableFor(ground: Ground): readonly number[] {
  const wants = DIVERGING.map((hex) => wantedFor(hex, ground));
  const midpoint = wants.findIndex((want) => want.grey);
  const taken = new Set<number>();
  const table: number[] = new Array<number>(DIVERGING.length).fill(-1);

  const runArm = (pole: number, inward: number): void => {
    let ceiling: number | null = null;
    for (let step = pole; step !== inward + Math.sign(inward - pole); step += Math.sign(inward - pole)) {
      const index = pickIndex(wants[step], ground, taken, ceiling);
      /* istanbul ignore next — an arm that runs out of colours means the cube
         cannot serve this ground at all, which no real ground does. */
      if (index === -1) continue;
      taken.add(index);
      table[step] = index;
      ceiling = chromaOf(xterm256Rgb(index));
    }
  };

  runArm(0, midpoint - 1);
  runArm(DIVERGING.length - 1, midpoint + 1);

  const centre = pickIndex(wants[midpoint], ground, taken, null);
  taken.add(centre);
  table[midpoint] = centre;

  return table;
}

/** The scale as a black terminal renders it. */
export const DARK_256: readonly number[] = tableFor("dark");
/** The scale as a white terminal renders it. */
export const LIGHT_256: readonly number[] = tableFor("light");

const SCALE: Record<Ground, readonly number[]> = { dark: DARK_256, light: LIGHT_256 };

/**
 * THE STRUCTURE INK — the one colour on the card that is not on the scale.
 *
 * Every renderer had exactly two things to say with colour: the depth ramp, and
 * dim. So a card's annotation layer — its section headings, its column heads,
 * the scope tag — was drawn in the same plain white as its prose, and 28 of a
 * 54-line card carried no ink at all. Not a taste problem: a heading that looks
 * like the paragraph under it is a heading doing no work.
 *
 * CHOSEN BY WHAT IT IS NOT, and that is now a rule the code applies rather than
 * a rule a comment claims. The scale is a red arm at 0° and a blue arm at 210°.
 * Chrome wearing either would be a number-coloured word that is not a number,
 * which is the failure the big number's own rule already names: the digits carry
 * the ramp, the label is a label. So the accent is searched for at
 * {@link ACCENT_HUE}, and `ramp.test.ts` asserts the {@link ARM_MARGIN} it kept.
 *
 * WHY MAGENTA. It was a violet at 0.31 chroma, and it read as faded because it
 * was: it had to clear the floor on both grounds at once, and only the middle of
 * the cube does that. Once the ground is known, the arm rule is the only
 * remaining constraint — and it eliminates every colour anyone reaches for
 * first. Amber lands 33° from the red arm, hot pink 27°, and cyan 12° from the
 * blue arm (`#005f87` IS a ramp index). Magenta and green are the two families
 * left, and green can only reach 0.53 chroma on a white ground before it runs
 * out of contrast, besides reading as reassurance on a card about blind spots.
 *
 * ONE ACCENT PER GROUND, NOT THREE. A second structural hue would have to mean
 * something different from this one, and there is nothing else for it to mean —
 * the scale is spoken for, and everything left is either a heading or prose.
 */
const ACCENT_HUE = 310;

/** How far the accent must stay from either arm of the scale. */
export const ARM_MARGIN = 45;
/** The two hues the scale itself owns. */
export const SCALE_ARMS = [0, 210] as const;

/** The most colourful accent this ground can carry at the contrast floor. */
function accentFor(ground: Ground): number {
  const groundLuminance = GROUND_LUMINANCE[ground];
  let best = -1;
  let bestChroma = -1;
  for (let index = CUBE_FIRST; index <= CUBE_LAST; index += 1) {
    const rgb = xterm256Rgb(index);
    if (contrastRatio(luminance(rgb), groundLuminance) < CONTRAST_FLOOR) continue;
    const hue = hueOf(rgb);
    if (hue < 0 || hueGap(hue, ACCENT_HUE) > HUE_TOLERANCE) continue;
    if (SCALE_ARMS.some((arm) => hueGap(hue, arm) < ARM_MARGIN)) continue;
    const chroma = chromaOf(rgb);
    if (chroma > bestChroma) {
      best = index;
      bestChroma = chroma;
    }
  }
  return best;
}

/** The accent a black terminal wears. */
export const DARK_INK = accentFor("dark");
/** The accent a white terminal wears. */
export const LIGHT_INK = accentFor("light");

const INK: Record<Ground, number> = { dark: DARK_INK, light: LIGHT_INK };

/**
 * The structure ink for a ground: "this is the tool, not a measurement".
 *
 * Headings, column heads and every runnable token the card tells you to type.
 * A heading and a command are the same category; only the scale is a reading.
 */
export function structureInk(ground: Ground): number {
  return INK[ground];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The terminal colour for a comprehension value (a score, or a fathomed
 * share), on a given ground.
 *
 * Bucketed by `scoreColor` first, so the CLI cannot drift from the gallery
 * about WHICH bucket a value falls in; the ground only decides how that bucket
 * is drawn. Passing the ground is not optional by design — the shipped bug was
 * a renderer that had no idea what it was painting onto.
 */
export function depthColor(value: number, ground: Ground): number {
  const hex = scoreColor(clamp01(value));
  const index = (DIVERGING as readonly string[]).indexOf(hex);
  return SCALE[ground][index === -1 ? 0 : index];
}

/**
 * The block a comprehension value is drawn with — taller as the value falls,
 * because the block is the DEPTH and the depth is what the product is about.
 *
 * No ground here, and that is the point: the glyph is the encoding that
 * survives `--no-color`, so it cannot depend on a colour decision.
 */
export function depthGlyph(value: number): GlyphName {
  const depth = 1 - clamp01(value);
  const band = Math.min(BLOCK_RAMP.length - 1, Math.floor(depth * BLOCK_RAMP.length));
  return BLOCK_RAMP[band];
}
