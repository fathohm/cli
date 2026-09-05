import { formatBlindShare } from "../../../lib/blind-share-format";
import { BLIND_SPOT_THRESHOLD } from "../../../lib/demo-data";
import { buildMapTree, computeHeadline, type MapNode } from "../../../lib/map-tree";
import { DIVERGING, INK, SURFACE, labelInkFor, scoreColor } from "../../../lib/palette";
import { DEBT_GLOSS, bucketOf, type BucketId } from "../../../lib/reading-explained";
import { DARK_WINDOW_DAYS } from "../reading/dark";
import { isDegenerate, type RepoReading } from "../reading/scoring";
import { createTerm, type Term } from "./term";
import { debtGloss, emptyReason } from "./card";
import { fileEntries } from "./entries";
import { HOSTED_URL } from "./hosted";
import { formatInterval } from "./interval";
import { renderHeader, type RenderMeta } from "./meta";
import { renderProvenance } from "./provenance";
import { formatBytes, isoSeconds, paragraph } from "./text";

/**
 * `fathohm map --out <file>.html` — the treemap, in one file that asks the
 * network for nothing.
 *
 * The Map is the product's growth loop: it is the thing people screenshot, and
 * the argument it makes — area is bytes, colour is depth, the red regions are
 * where the comprehension went — is made in one glance. So the CLI has to be
 * able to produce it, and it has to produce it under the CLI's own promise:
 * nothing leaves the machine, and nothing on the page reaches for anything.
 *
 * Which rules out almost every convenience. No CDN, no framework, no web font,
 * no icon set, no analytics — the file carries its own CSS, its own JavaScript,
 * and its data as DOM attributes. There is exactly one string in the document
 * that looks like a network address, and it is the hosted link in the footer,
 * sitting in an `<a href>` that only ever loads if a human clicks it. A test
 * asserts that count is one.
 *
 * The one thing the page loads is ITSELF: the PNG button hands its own
 * serialised svg to an image as a `data:` URI. That is the document quoting
 * itself rather than fetching anything, and it is the only `src` in the file.
 *
 * **The public scale.** `lib/palette.ts` carries two diverging ramps split at
 * the login: `BRIDGE_DEPTH` is the dashboard's, and `DIVERGING` is what the
 * landing page, the gallery and the OG images ship. A file written onto a
 * stranger's disk is the most public surface this product has, so it takes
 * `DIVERGING`, by import, through `scoreColor` — a cell here and a cell in the
 * gallery at the same score are the same ink by construction.
 *
 * **The same tree the dashboard builds.** `buildMapTree` from `lib/map-tree.ts`
 * does the joining, the code-file filter and the breadth-first budget
 * aggregation, so a repository with fifty thousand files renders as directories
 * rather than as fifty thousand unreadable slivers — and it does it with the
 * hosted rules, not a second set.
 *
 * **A full reading, not a chart.** The page carries the interval headline, its
 * caption and the whole provenance block, because a treemap without them is a
 * picture that has lost the thing that made it honest. Those lines come from
 * the same renderers the card uses, rendered at an unlimited width so the
 * terminal's wrapping does not travel into HTML.
 */

/** The drawing surface, in SVG user units. The `viewBox` scales it to whatever
 *  the browser gives us, so these are proportions, not pixels. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 680;

/** A cell narrower or shorter than this cannot carry a legible label. */
const LABEL_MIN_WIDTH = 58;
const LABEL_MIN_HEIGHT = 22;
/** Monospace at 11px is about this wide per character. */
const LABEL_CHAR_WIDTH = 6.6;

/**
 * The banner's red is CHROME — a stop sign, not a depth.
 *
 * Deliberately NOT `DIVERGING[0]`: red on the depth scale MEANS "nobody
 * understands this", and a banner wearing a data colour would be the chrome
 * borrowing the encoding. The terminal card makes the same call with the
 * terminal's own named red.
 */
const BANNER_RED = "#ff5f5f";

/** The vocabulary the buckets are named in, for the hover readout. Short
 *  labels, not sentences: `lib/reading-explained` owns the sentences, and a
 *  sentence in a tooltip is a sentence nobody reads. */
const BUCKET_LABELS: Record<BucketId, string> = {
  above: "above the line",
  "prompted-only": "prompted only",
  "no-human": "no human contact",
  faded: "faded",
  "thin-contact": "thin contact",
  unexplained: "unexplained",
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Cell extends Rect {
  node: MapNode;
}

/**
 * The whole page, as a string. Deterministic: same reading, same bytes.
 */
export function renderMapPage(reading: RepoReading, meta: RenderMeta): string {
  // A repository with nothing in it gets a page that says so, and no map at
  // all. "0% comprehension debt" over an empty rectangle is a screenshot claiming a
  // perfectly understood codebase, which is the brand risk this product cannot
  // take on a file people keep and send to each other.
  if (isDegenerate(reading)) return document(reading, meta, degenerate(reading));

  const entries = fileEntries(reading);
  const tree = buildMapTree(
    entries.map((entry) => ({ path: entry.path, sizeBytes: entry.size })),
    // A git-only reading scores every file in its own tree, so nothing is
    // dropped here in practice. The guard is not defensive clutter: `FileEntry`
    // models the hosted LEFT JOIN, where a tree path with no score row is a
    // real state, and the honest rendering of one is an unscored cell rather
    // than a zero — which would be a claim that nobody understands it.
    entries.flatMap((entry) =>
      entry.score === null || entry.factors === null
        ? []
        : [
            {
              path: entry.path,
              score: entry.score,
              factors: entry.factors,
              latestAuthorship: null,
            },
          ],
    ),
  );
  const headline = computeHeadline(entries);
  const cells = squarify(tree.nodes, {
    x: 0,
    y: 0,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  });

  return document(reading, meta, [
    ...headlineBlock(reading),
    ...map(cells, tree.nodes.length),
    ...legend(),
    ...provenance(reading),
    ...footer(headline.scoredFileCount, headline.scoredBytes),
  ]);
}

/** The shell every page shares: the head, the wordmark, and the one script. */
function document(reading: RepoReading, meta: RenderMeta, body: readonly string[]): string {
  const title = `Fathohm — git-only reading of ${meta.target}`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${styles()}</style>`,
    "</head>",
    "<body>",
    '<main class="page">',
    '<header class="head">',
    '<p class="mark">FATHOHM</p>',
    `<h1>git-only reading of ${escapeHtml(meta.target)}</h1>`,
    `<p class="lenses">${escapeHtml(isoSeconds(reading.now))} · scorer ${escapeHtml(meta.scorerVersion)}</p>`,
    "</header>",
    ...body,
    "</main>",
    `<script>${script()}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Nothing to fathom: an empty repository, a tree with no code in it, or one
 * whose code files are all empty.
 *
 * The reason comes from the card's own renderer, so the terminal and the file
 * say the same sentence about the same state — and NO number appears anywhere
 * on the page. The provenance still does: even a page with nothing to report
 * owes the reader the terms it was reading under.
 */
function degenerate(reading: RepoReading): string[] {
  return [
    '<p class="headline">nothing to fathom here yet</p>',
    `<p class="caption">${escapeHtml(emptyReason(reading, pageTerm()))}</p>`,
    ...provenance(reading),
    ...footer(0, 0),
  ];
}

/**
 * What the terminal says after the file is written.
 *
 * Short on purpose: the reading is in the file, and restating it here in a
 * second voice would invite the two to disagree. What the note owes the reader
 * is the three things they cannot see from the shell — where it went, how big
 * it is, and that opening it will not phone anybody.
 *
 * WHAT IT DELIBERATELY REPEATS is the page's own headline and the page's own
 * reconciliation line, through the very functions the page calls. A note that
 * quoted one number while the file it just wrote led with another would be the
 * same contradiction, one line earlier. And because the note names the term, it
 * owes the canonical gloss on its own account: a reader who pipes this into a
 * log may never open the page at all.
 */
export function renderMapNote(
  reading: RepoReading,
  target: string,
  bytes: number,
  term: Term,
  meta: RenderMeta,
): string[] {
  const width = term.width - 2;
  const lines = renderHeader(term, [
    `map of ${meta.target}`,
    isoSeconds(reading.now),
    `scorer ${meta.scorerVersion}`,
  ]);
  lines.push("", ...paragraph(`wrote ${target} (${formatBytes(bytes)})`, width));

  if (isDegenerate(reading)) {
    lines.push(
      ...paragraph(
        `nothing to fathom here yet ${term.glyph("dash")} the page says so rather than drawing an empty repository as a finding.`,
        width,
      ),
    );
  } else {
    const interval = formatInterval(
      share(reading.ceilingBlindBytes, reading.scoredBytes),
      share(reading.floorBlindBytes, reading.scoredBytes),
      term,
    );
    lines.push(
      ...paragraph(
        `${reading.files.length} files ${term.glyph("dot")} ${interval} comprehension debt ${term.glyph("dot")} area is bytes, colour is depth.`,
        width,
      ),
      // Same order as the page it just wrote: the reading of the number first,
      // the definition of the label after it.
      ...paragraph(darkLine(reading, term.glyph("dash")), width),
      ...debtGloss(term, width),
    );
  }

  lines.push(
    ...paragraph(
      `Open it in any browser: the data, the styles and the script are all inside the file, and it requests nothing.`,
      width,
    ),
    // The one thing the page can do that the terminal cannot say for it. A
    // button nobody is told about is a button nobody presses, and the reason
    // this one exists is that the Map is what people paste into a thread.
    //
    // Not on a degenerate reading: that page draws no map, so it carries no
    // button, and a note pointing at one would send a reader looking for a
    // control that is not there.
    ...(isDegenerate(reading)
      ? []
      : paragraph(
          `Copy as PNG from the button under the map ${term.glyph("dash")} the image is drawn in your browser, from that file, and is never uploaded.`,
          width,
        )),
  );
  return lines;
}

/* ── the page ───────────────────────────────────────────────────────────── */

/**
 * THE INTERVAL, on the page — and the dark share under it, because the card
 * headlines the other one.
 *
 * This comment used to say the page printed "the same mechanic the card prints,
 * through the same formatter, so a screenshot of one can never contradict a
 * screenshot of the other". That was true until 1.5.0 and is not true now: the
 * card headlines `45% GONE DARK` and this page headlines `24% – 72%
 * comprehension debt`. Two different quantities of one repository, and for one
 * release nothing on either surface reconciled them.
 *
 * THE PAGE KEEPS THE INTERVAL, deliberately. The treemap is coloured by
 * comprehension score, so the debt interval is the number that describes what
 * the reader is actually looking at; headlining the dark share over a picture
 * that does not encode it would be the contradiction moved inside one file.
 *
 * WHAT IT ADDS IS THE RECONCILIATION — `darkLine`, labelled, once. A reader
 * holding both screenshots can now name each number and say why they differ,
 * which is all a reconciliation owes them; it is not a second hero.
 *
 * The captions are not decoration. A range with no explanation reads as
 * imprecision rather than as the size of what git could not see — and the
 * canonical gloss is owed here on its own account, because a written file is a
 * surface of its own: it gets kept, sent on, and opened by people who never ran
 * the command.
 */
function headlineBlock(reading: RepoReading): string[] {
  const term = pageTerm();
  const interval = formatInterval(
    share(reading.ceilingBlindBytes, reading.scoredBytes),
    share(reading.floorBlindBytes, reading.scoredBytes),
    term,
  );
  return [
    // ORDER MATTERS HERE, and it is the copy rule's order: the number, then the
    // sentence that reads THIS number, then the definition of the label, then
    // the reconciliation with the other surface. The gloss sat second for one
    // draft and pushed "the range is…" a paragraph away from the range it
    // explains — a definition displacing a reading is exactly what the
    // covered-label test forbids.
    `<p class="headline"><span class="number">${escapeHtml(interval)}</span> comprehension debt</p>`,
    '<p class="caption">the range is your unmeasured review record</p>',
    `<p class="caption">${escapeHtml(DEBT_GLOSS)}</p>`,
    `<p class="caption">${escapeHtml(darkLine(reading, term.glyph("dash")))}</p>`,
  ];
}

/**
 * THE RECONCILIATION LINE — the card's headline, in one sentence, on the page
 * that headlines something else.
 *
 * ONE FUNCTION, both surfaces: the note the terminal prints and the file it
 * just wrote say this in the same words, because two wordings of a
 * reconciliation are two more numbers to reconcile.
 *
 * The share is computed here exactly as the card computes it — the reading's
 * own `darkBytes` over the same scored denominator, through
 * `lib/blind-share-format`, whose `<1%`/`>99%` floors stop a real finding
 * rounding into an absolute. Same bytes, same denominator, same formatter, so
 * the page's number and the card's number cannot drift apart.
 *
 * "Gone dark" is a metaphor and never travels alone: the plain sentence sits
 * beside it, in the same always-visible line, describing the record rather than
 * anybody's understanding of it.
 */
function darkLine(reading: RepoReading, dash: string): string {
  return (
    `${darkShareText(reading)} gone dark ${dash} no human wrote or prompted it in the last ` +
    `${DARK_WINDOW_DAYS} days. That is the headline fathohm read prints; this page is ` +
    `coloured by comprehension score.`
  );
}

/** The dark share as text, through the formatter every share here goes through. */
function darkShareText(reading: RepoReading): string {
  return formatBlindShare(share(reading.darkBytes, reading.scoredBytes) * PERCENT);
}

/** `share()` returns a fraction; `formatBlindShare` speaks percents. */
const PERCENT = 100;

function map(cells: readonly Cell[], nodeCount: number): string[] {
  const lines = [
    '<figure class="map" id="map">',
    `<svg viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" role="group" aria-label="Treemap of ${nodeCount} nodes: area is bytes, colour is comprehension depth">`,
  ];
  for (const cell of cells) lines.push(...cellMarkup(cell));
  lines.push("</svg>");
  lines.push(
    '<figcaption class="readout" id="readout">hover or tab to a cell for its path, score and bucket</figcaption>',
  );
  lines.push("</figure>");
  // THE SCREENSHOT, WITHOUT THE SCREENSHOT. The Map is the growth loop and the
  // thing people paste into a thread; until now getting it out of this file
  // meant a window-cropped grab at whatever the screen happened to be. The
  // button re-draws the page's OWN svg at 2× — the same rectangles, the same
  // ink — and the hint beside it says where the image goes, because a button
  // labelled "copy" on a page that promises to load nothing owes an answer to
  // "copy where?".
  lines.push(
    '<p class="tools"><button type="button" id="copy" class="copy">Copy as PNG</button>',
    '<span class="hint">the map above at 2×, drawn in your browser from this page — nothing is uploaded</span></p>',
  );
  return lines;
}

function cellMarkup(cell: Cell): string[] {
  const { node } = cell;
  const fill = node.score === null ? INK.hairline : scoreColor(node.score);
  const readout = escapeHtml(readoutFor(node));
  const lines = [
    `<rect x="${round(cell.x)}" y="${round(cell.y)}" width="${round(cell.width)}" ` +
      `height="${round(cell.height)}" fill="${fill}" class="cell" tabindex="0" ` +
      `role="img" aria-label="${readout}" data-fathohm="${readout}"></rect>`,
  ];

  const label = labelFor(cell);
  if (label !== null) {
    lines.push(
      `<text x="${round(cell.x + 5)}" y="${round(cell.y + 14)}" class="label" ` +
        `fill="${labelInkFor(fill)}">${escapeHtml(label)}</text>`,
    );
  }
  return lines;
}

/** The cell's name, cut to what the rectangle can hold, or null when it cannot
 *  hold anything. Never a truncated path — a name that has lost its ending is
 *  a name you cannot search for; the readout carries the full path. */
function labelFor(cell: Cell): string | null {
  if (cell.width < LABEL_MIN_WIDTH || cell.height < LABEL_MIN_HEIGHT) return null;
  const room = Math.floor((cell.width - 10) / LABEL_CHAR_WIDTH);
  if (room < 3) return null;
  const name = cell.node.name;
  return name.length <= room ? name : `${name.slice(0, room - 1)}…`;
}

/**
 * One cell's line in the readout: path, score, and what kind of gap it is.
 *
 * A directory cell says how many files it stands for instead of a bucket: its
 * factors are a byte-weighted mean with no engagement record behind them, and
 * running the bucket rules on a mean would invent a story about a folder that
 * no file in it told.
 */
function readoutFor(node: MapNode): string {
  const size = formatBytes(node.sizeBytes);
  const score = node.score === null ? "not scored" : node.score.toFixed(3);
  if (node.kind === "file") {
    const bucket = bucketOf({
      path: node.path,
      size: node.sizeBytes,
      score: node.score,
      factors: node.factors,
      latestAuthorship: null,
    });
    const label = bucket === null ? "not scored" : BUCKET_LABELS[bucket];
    return `${node.path} · ${score} · ${label} · ${size}`;
  }
  const count = node.fileCount ?? 0;
  return `${node.path}/ · ${score} · ${count} ${count === 1 ? "file" : "files"} · ${size}`;
}

/**
 * The ramp, with the line on it.
 *
 * `DIVERGING` is nine stops and `scoreColor` buckets a score by ninths, so the
 * swatch boundaries are computed from the array's own length rather than
 * written down — retune the ramp and the legend follows.
 */
function legend(): string[] {
  const swatches = DIVERGING.map(
    (hex, index) =>
      `<span class="swatch" style="background:${hex}" aria-label="score ${(index / DIVERGING.length).toFixed(2)} and above"></span>`,
  ).join("");
  return [
    '<section class="legend">',
    '<p class="legend-label">deep <span class="ramp" role="img" aria-label="the diverging depth scale, nine stops">' +
      swatches +
      "</span> shallow</p>",
    `<p class="legend-note">score 0 (no human on its recent record) to 1 (recently written and reviewed by a human). The line is at ${BLIND_SPOT_THRESHOLD.toFixed(2)}: below it, no human has recently written, reviewed, or explained the file. Area is bytes.</p>`,
    "</section>",
  ];
}

/**
 * The provenance block, verbatim from the card's own renderer.
 *
 * Rendered at an unlimited width so the terminal's word wrapping does not
 * travel into HTML — the browser does its own. The banner line is the only one
 * matched by name, and if that copy ever changes the page loses a colour, not
 * a fact.
 */
function provenance(reading: RepoReading): string[] {
  const lines = renderProvenance(reading, pageTerm())
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return [
    '<section class="provenance">',
    '<h2>what this reading could not see</h2>',
    ...lines.map((line) =>
      line === "PARTIAL READING"
        ? `<p class="banner">${escapeHtml(line)}</p>`
        : `<p>${escapeHtml(line)}</p>`,
    ),
    "</section>",
  ];
}

function footer(fileCount: number, scoredBytes: number): string[] {
  return [
    '<footer class="foot">',
    `<p>${fileCount} scored ${fileCount === 1 ? "file" : "files"} · ${escapeHtml(formatBytes(scoredBytes))} · read from git metadata only, on this machine. This page loads nothing.</p>`,
    `<p>The unmeasured review range is what git cannot see. The hosted reading reads the pull-request record and collapses it: <a href="${HOSTED_URL}">${HOSTED_URL}</a></p>`,
    "</footer>",
  ];
}

/* ── the treemap ────────────────────────────────────────────────────────── */

/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk).
 *
 * Cells are packed into rows along the shorter side of what is left, and a row
 * closes when adding the next cell would make its worst aspect ratio worse.
 * The result is rectangles close to square, which is the only reason a treemap
 * is readable at all: area is the encoding, and a 400×3 sliver is an area
 * nobody can compare to anything.
 *
 * Deterministic by construction — largest first, path breaking ties — so the
 * same reading writes the same file, byte for byte, on every machine.
 */
export function squarify(nodes: readonly MapNode[], rect: Rect): Cell[] {
  const ordered = [...nodes]
    .filter((node) => node.sizeBytes > 0)
    .sort((a, b) => b.sizeBytes - a.sizeBytes || (a.path < b.path ? -1 : 1));
  const total = ordered.reduce((sum, node) => sum + node.sizeBytes, 0);
  if (ordered.length === 0 || total <= 0 || rect.width <= 0 || rect.height <= 0) return [];

  const scale = (rect.width * rect.height) / total;
  const queue = ordered.map((node) => ({ node, area: node.sizeBytes * scale }));

  const cells: Cell[] = [];
  let free: Rect = { ...rect };
  let row: Array<{ node: MapNode; area: number }> = [];

  for (const item of queue) {
    const side = Math.min(free.width, free.height);
    if (row.length === 0 || worstRatio([...row, item], side) <= worstRatio(row, side)) {
      row.push(item);
      continue;
    }
    free = placeRow(row, free, cells);
    row = [item];
  }
  if (row.length > 0) placeRow(row, free, cells);
  return cells;
}

/** The worst aspect ratio in a row laid along `side`. */
function worstRatio(row: ReadonlyArray<{ area: number }>, side: number): number {
  if (row.length === 0 || side <= 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let max = 0;
  let min = Number.POSITIVE_INFINITY;
  for (const item of row) {
    sum += item.area;
    if (item.area > max) max = item.area;
    if (item.area < min) min = item.area;
  }
  if (sum <= 0 || min <= 0) return Number.POSITIVE_INFINITY;
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Lay one row along the shorter side and return what is left. */
function placeRow(
  row: ReadonlyArray<{ node: MapNode; area: number }>,
  free: Rect,
  out: Cell[],
): Rect {
  const sum = row.reduce((total, item) => total + item.area, 0);
  if (sum <= 0) return free;

  if (free.width >= free.height) {
    const width = Math.min(free.width, sum / free.height);
    let y = free.y;
    for (const item of row) {
      const height = item.area / width;
      out.push({ node: item.node, x: free.x, y, width, height });
      y += height;
    }
    return {
      x: free.x + width,
      y: free.y,
      width: Math.max(0, free.width - width),
      height: free.height,
    };
  }

  const height = Math.min(free.height, sum / free.width);
  let x = free.x;
  for (const item of row) {
    const width = item.area / height;
    out.push({ node: item.node, x, y: free.y, width, height });
    x += width;
  }
  return {
    x: free.x,
    y: free.y + height,
    width: free.width,
    height: Math.max(0, free.height - height),
  };
}

/* ── plumbing ───────────────────────────────────────────────────────────── */

/**
 * The terminal handle the shared renderers are written against, configured for
 * a page rather than a terminal: no colour (ANSI in HTML would be mojibake),
 * unicode glyphs (a browser is not a CI log), and a width nothing wraps at.
 * Its options are fixed rather than read from the environment, so `--ascii` or
 * `FORCE_COLOR` cannot change the bytes of a written file.
 */
function pageTerm() {
  return createTerm({ noColor: true, ascii: false, env: {}, isTTY: false, columns: 4000 });
}

function share(blindBytes: number, scoredBytes: number): number {
  return scoredBytes > 0 ? blindBytes / scoredBytes : 0;
}

/** Two decimals is finer than a pixel at any window size, and keeps the file
 *  small enough to read in a diff. */
function round(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Every string that reaches the document goes through here — including paths,
 *  which are attacker-controlled in exactly the sense that matters: a
 *  repository can contain a file called `"><script>`. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function styles(): string {
  return [
    `:root{color-scheme:dark}`,
    `body{margin:0;background:${SURFACE.page};color:${INK.secondary};`,
    `font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;line-height:1.55}`,
    `.page{max-width:1200px;margin:0 auto;padding:32px 20px 64px}`,
    `.mark{margin:0;letter-spacing:.18em;color:${INK.primary};font-weight:600}`,
    `h1{margin:6px 0 2px;font-size:17px;font-weight:500;color:${INK.primary}}`,
    `h2{margin:0 0 8px;font-size:13px;font-weight:500;color:${INK.muted};letter-spacing:.08em;text-transform:uppercase}`,
    `.lenses{margin:0;color:${INK.ink4}}`,
    `.headline{margin:22px 0 0;font-size:15px;color:${INK.muted}}`,
    `.number{font-size:44px;color:${INK.primary};letter-spacing:-.01em}`,
    `.caption{margin:2px 0 0;color:${INK.ink4}}`,
    `.map{margin:26px 0 0;border:1px solid ${INK.hairline};background:${SURFACE.sheet};padding:8px}`,
    `svg{display:block;width:auto;height:auto}`,
    `.cell{stroke:${SURFACE.page};stroke-width:1}`,
    `.cell:hover,.cell:focus{stroke:${INK.primary};stroke-width:2;outline:none}`,
    `.label{font-family:inherit;font-size:11px;pointer-events:none}`,
    `.readout{margin:8px 2px 0;color:${INK.secondary};min-height:1.55em}`,
    `.tools{margin:10px 2px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}`,
    `.copy{font:inherit;color:${INK.primary};background:${SURFACE.sheet};border:1px solid ${INK.hairline};padding:5px 11px;cursor:pointer}`,
    `.copy:hover,.copy:focus{border-color:${INK.primary};outline:none}`,
    `.hint{color:${INK.ink4}}`,
    `.legend{margin:18px 0 0}`,
    `.legend-label{margin:0;color:${INK.ink4};display:flex;align-items:center;gap:8px}`,
    `.ramp{display:inline-flex}`,
    `.swatch{width:34px;height:12px;display:inline-block}`,
    `.legend-note{margin:6px 0 0;color:${INK.muted};max-width:78ch}`,
    `.provenance{margin:34px 0 0;border-top:1px solid ${INK.hairline};padding-top:18px}`,
    `.provenance p{margin:0 0 8px;max-width:78ch}`,
    `.banner{color:${BANNER_RED};font-weight:600;letter-spacing:.08em}`,
    `.foot{margin:28px 0 0;color:${INK.ink4}}`,
    `.foot p{margin:0 0 6px;max-width:78ch}`,
    `a{color:${INK.secondary}}`,
  ].join("");
}

/**
 * The whole of the page's behaviour: the readout under the cursor, and the PNG
 * button.
 *
 * No data is passed to this script — every fact it uses is already on the
 * element it came from, the geometry included (it reads the svg's own
 * `viewBox` and the figure's own background rather than being handed either).
 * That is why there is no JSON blob to escape and no way for a repository's
 * own filenames to end up parsed as code.
 *
 * THE PNG IS DRAWN HERE, FROM THIS PAGE, AND GOES NOWHERE. The svg is
 * serialised, handed to an image as a `data:` URI — the document quoting
 * itself, never a request — rasterised onto a canvas at 2× and handed to the
 * clipboard as `image/png`. Where the clipboard API is missing or refuses
 * (Safari outside a user gesture, an insecure context, a browser that has not
 * implemented `ClipboardItem`) the same blob is offered as a download instead,
 * and the button says which of the two it is going to do BEFORE it is pressed.
 * There is no third path where the image leaves the machine.
 */
function script(): string {
  return [
    "(function(){",
    "var readout=document.getElementById('readout');",
    "var map=document.getElementById('map');",
    // A page with nothing to fathom has no map and no readout. The guard is
    // what keeps that page from opening with an error in the console.
    "if(!readout||!map)return;",
    "var idle=readout.textContent;",
    "function show(event){readout.textContent=event.currentTarget.getAttribute('data-fathohm');}",
    "var cells=document.querySelectorAll('rect[data-fathohm]');",
    "for(var i=0;i<cells.length;i++){",
    "cells[i].addEventListener('mouseenter',show);",
    "cells[i].addEventListener('focus',show);",
    "}",
    "map.addEventListener('mouseleave',function(){readout.textContent=idle;});",
    "var button=document.getElementById('copy');",
    "var svg=map.querySelector('svg');",
    "if(!button||!svg)return;",
    "var canCopy=!!(window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write);",
    "if(!canCopy)button.textContent='Download PNG';",
    "function done(text){button.textContent=text;}",
    "function save(blob){",
    "var link=document.createElement('a');",
    "var href=URL.createObjectURL(blob);",
    "link.href=href;link.download='fathohm-map.png';link.click();",
    "URL.revokeObjectURL(href);done('Downloaded');",
    "}",
    "button.addEventListener('click',function(){",
    "var box=svg.viewBox.baseVal,width=box.width*2,height=box.height*2;",
    "var clone=svg.cloneNode(true);",
    "clone.setAttribute('width',width);clone.setAttribute('height',height);",
    // AN IMAGE CARRIES NO STYLESHEET. Once the svg is a `data:` URI in an
    // <img>, the page's CSS no longer reaches it — the cells would lose the
    // stroke that separates them and the labels would fall back to a browser
    // default size and overflow the rectangles they name. So the computed
    // values are copied from the live nodes onto the clone as presentation
    // attributes: the PNG is the picture on the screen, not a re-styling of it.
    "var live=svg.querySelectorAll('rect,text'),copies=clone.querySelectorAll('rect,text');",
    "for(var j=0;j<live.length;j++){",
    "var css=getComputedStyle(live[j]);",
    "copies[j].setAttribute('stroke',css.stroke);",
    "copies[j].setAttribute('stroke-width',css.strokeWidth);",
    "copies[j].setAttribute('font-size',css.fontSize);",
    "copies[j].setAttribute('font-family',css.fontFamily);",
    "}",
    // XMLSerializer writes the svg namespace itself, which is what makes the
    // data URI loadable without this file carrying a namespace URL of its own.
    "var text=new XMLSerializer().serializeToString(clone);",
    "var image=new Image();",
    "image.onload=function(){",
    "var canvas=document.createElement('canvas');",
    "canvas.width=width;canvas.height=height;",
    "var ctx=canvas.getContext('2d');",
    // The sheet colour, read off the figure: a transparent PNG of dark cells
    // pasted onto a light background reads as a broken image.
    "ctx.fillStyle=getComputedStyle(map).backgroundColor;",
    "ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);",
    "canvas.toBlob(function(blob){",
    "if(!blob){done('PNG failed');return;}",
    "if(!canCopy){save(blob);return;}",
    "navigator.clipboard.write([new ClipboardItem({'image/png':blob})])",
    ".then(function(){done('Copied');},function(){save(blob);});",
    "},'image/png');",
    "};",
    "image.onerror=function(){done('PNG failed');};",
    "image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(text);",
    "});",
    "})();",
  ].join("");
}
