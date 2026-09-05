/**
 * Dark-mode palette for the Map and landing page.
 *
 * The comprehension score encodes polarity (at-risk ↔ understood), so it
 * takes a diverging scale: a red arm and a blue arm around a neutral gray
 * midpoint. Both arms were validated as ordinal ramps against the dark
 * surface (#1a1a19): monotone lightness, adjacent ΔL ≥ 0.06, near-midpoint
 * step ≥ 2:1 contrast, single hue per arm. Red↔green was rejected — it
 * collapses under red-green color-vision deficiency.
 */

/** Diverging scale, score 0 (no human understands) → 1 (well understood). */
export const DIVERGING = [
  "#e66767", // red pole — deepest blind spot
  "#c44c4a",
  "#a53f3c",
  "#8a3431",
  "#383835", // neutral midpoint
  "#184f95",
  "#256abf",
  "#3987e5",
  "#6da7ec", // blue pole — well understood
] as const;

/**
 * Ink and chrome tokens (dark mode — the landing ships dark-only).
 *
 * Every ink that carries text clears WCAG AA (4.5:1) on all three dashboard
 * grounds — page #0d0d0d, sheet #111110, raised #171716. That was NOT true
 * before: `ink4` shipped at #5f5e59, which is 2.99:1 on the page ground and
 * 2.76:1 on raised. It carries the uppercase mono `Label` — every section head,
 * every axis tick, the whole meta strip — so the product's entire annotation
 * layer sat below the readability floor. "Quiet instrument" is a design
 * decision; "cannot be read" is a defect wearing its costume.
 *
 * Contrast is enforced by lib/ink-contrast.guardrail.test.ts, not by eye.
 *
 * USAGE RULE — `ink4` may only carry annotation whose information also exists
 * elsewhere on the screen (a section head above content that names itself, an
 * axis tick beside a plotted line). Any text that is the SOLE carrier of its
 * information takes `muted` or brighter, whatever its size.
 */
export const INK = {
  page: "#0d0d0d",
  surface: "#1a1a19",
  primary: "#ffffff",
  secondary: "#c3c2b7", // 10.85:1 on page
  muted: "#96948c", // 6.40:1 on page, 5.90:1 on raised
  ink4: "#828179", // 4.97:1 on page, 4.58:1 on raised — the AA floor, by design
  hairline: "#2c2c2a",
  border: "rgba(255,255,255,0.10)",
} as const;

/**
 * Surface elevation for the dashboard shell. The old UI used a single
 * #1a1a19 panel on #0d0d0d; the survey layout needs three ascending levels
 * (page < sheet < raised) plus a quieter interior hairline than the existing
 * INK.hairline. Additive — the diverging/authorship scales are unchanged.
 */
export const SURFACE = {
  page: "#0d0d0d",
  sheet: "#111110",
  raised: "#171716",
  hair: "#2c2c2a",
  hair2: "#211f1e",
} as const;

/**
 * Authorship color scale for the Map's "Color: authorship" mode. Categorical,
 * not ordinal — five distinct hues, not a scale, so the two color modes never
 * read as the same encoding.
 */
export const AUTHORSHIP_COLORS: Record<"human" | "agent" | "mixed" | "unknown" | "bot", string> = {
  human: "#5b9cf5",
  agent: "#ff7a59",
  mixed: "#c08be8",
  unknown: "#55606e",
  // Muted teal: a distinct hue from the human/agent/mixed story, and clearly
  // separable from unknown's slate. Bot-authored code is mechanical, not
  // interesting — the swatch should not compete for attention.
  bot: "#4f8a8b",
} as const;

/** Map a 0..1 comprehension score to its diverging-scale bucket. */
export function scoreColor(score: number): string {
  const clamped = Math.min(1, Math.max(0, score));
  const bucket = Math.min(DIVERGING.length - 1, Math.floor(clamped * DIVERGING.length));
  return DIVERGING[bucket];
}

/**
 * BRIDGE DATA COLOURS — the dashboard's depth scale, verbatim from the
 * founder-approved Bridge artifact (fathohm-bridge.html `:root` --d0…--d4).
 *
 * Adopted by explicit founder decision, 2026-07-30 ("use the same color from
 * artifact"). This is still a diverging scale — red pole (no human
 * understands) → neutral tan → blue pole (well understood) — so everything
 * the product asserts about the scale's MEANING carries over: it colours
 * DATA only, never chrome; red is the deepest blind spot; the direction
 * never flips. What changed is the literals and the stop count: five stops,
 * one per depth band, so a brush swatch, a Map cell, a ScoreChip and a
 * driver bar at the same depth are always the same ink.
 *
 * PUBLIC SURFACES KEEP `DIVERGING`. The landing, the gallery and the OG
 * images ship the original nine-stop scale — the founder's standing "public
 * one stays as it is". lib/bridge-v1.guardrail.test.ts asserts both sides.
 */
export const BRIDGE_DEPTH = [
  "#f0453a", // red pole — Deepest, 0.00–0.15
  "#f79350", // Deep, 0.15–0.30 — still below the blind-spot threshold
  "#a39a84", // neutral tan — Mid, 0.30–0.55, just clear of the debt line
  "#4fb0e0", // Shallow, 0.55–0.80
  "#2a7fc9", // blue pole — Surface, 0.80–1.00, well understood
] as const;

/** Off the scale entirely: "not measured" is not a depth (artifact --unscored). */
export const BRIDGE_UNSCORED = "#3a444d";

/**
 * Authorship hues for the bridge Map (artifact --auth-*). Categorical, not
 * ordinal — the artifact deliberately reuses two depth hues (human = the
 * shallow blue, agent = the deep orange) because the two modes never render
 * at once. The artifact has no "bot": automation keeps the shipped muted
 * teal — mechanical, not interesting, clearly apart from unknown's slate.
 */
export const BRIDGE_AUTHORSHIP: Record<"human" | "agent" | "mixed" | "unknown" | "bot", string> = {
  human: "#4fb0e0",
  agent: "#f79350",
  mixed: "#b083d6",
  unknown: "#77848f",
  bot: "#4f8a8b",
} as const;

/**
 * Score → bridge depth colour.
 *
 * The thresholds are lib/band's BANDS boundaries restated as literals
 * (band.ts imports this module, so importing BANDS here would be a cycle;
 * lib/bridge-v1.guardrail.test.ts asserts the mirror). That alignment is the
 * point: a cell's colour IS its brush band's swatch — five sections, five
 * colours, one mapping, nothing to reconcile by eye.
 */
export function bridgeScoreColor(score: number): string {
  const s = Math.min(1, Math.max(0, score));
  if (s < 0.15) return BRIDGE_DEPTH[0];
  if (s < 0.3) return BRIDGE_DEPTH[1];
  if (s < 0.55) return BRIDGE_DEPTH[2];
  if (s < 0.8) return BRIDGE_DEPTH[3];
  return BRIDGE_DEPTH[4];
}

/** Parse a `#rrggbb` or `rgb(r, g, b)` color into its 0..255 channels. */
function toRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ];
  }
  const m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) throw new Error(`Unrecognized color: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** WCAG relative luminance of a `#rrggbb` or `rgb(r, g, b)` color. */
function luminance(color: string): number {
  const linear = (v255: number) => {
    const v = v255 / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = toRgb(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two colors (`#rrggbb` or `rgb(r, g, b)`). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Cell labels wear ink tokens, never the fill color. Pick whichever ink
 * (white or near-black) has the higher contrast on this fill. Works across
 * the diverging scale, the authorship swatches, and the unscored gray.
 */
export function labelInkFor(fill: string): string {
  return contrast(fill, "#ffffff") >= contrast(fill, "#0b0b0b") ? "#ffffff" : "#0b0b0b";
}

/** Neutral gray for unscored cells — deliberately OUTSIDE the diverging
 *  red↔blue score scale, so "no events yet" never reads as a score. */
export const UNSCORED_FILL = "#4a4a47";

/**
 * Bridge v1 chrome — the repo view's committed-dark skin (founder-chosen).
 *
 * CHROME ONLY. The score scale stays DIVERGING above, untouched: Bridge
 * changes the ground the data sits on, never the data's own colours. The
 * magenta is the skin's single chrome accent — it is deliberately outside
 * the diverging ramp, so it can mark chrome states (the time-travel banner,
 * the fathom-line annotation) without ever reading as a score. That is the
 * same bright line that forbids DIVERGING[0] on an active tab, approached
 * from the other side.
 *
 * Mirrored into app/globals.css (.bridge-* rules) for what inline styles
 * cannot express; lib/bridge-v1.guardrail.test.ts asserts the mirror.
 */
export const BRIDGE = {
  paper: "#07090c",
  sheet: "#0d1116",
  sheet2: "#121820",
  ink: "#eef2f6",
  ink2: "#94a3b3",
  ink3: "#5e6b7a",
  hair: "rgba(255,255,255,.07)",
  hair2: "rgba(255,255,255,.17)",
  mark: "#ff2d8f",
} as const;
