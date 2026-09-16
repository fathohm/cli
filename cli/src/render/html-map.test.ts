import { describe, expect, it } from "vitest";

import { formatBlindShare } from "../../../lib/blind-share-format";
import { DIVERGING } from "../../../lib/palette";
import {
  EMPTY,
  MIXED,
  PROMPTED_DOMINANT,
  SHALLOW,
  readingOf,
} from "../../test-helpers/reading-fixtures";
import { DARK_WINDOW_DAYS, darkBytesOf } from "../reading/dark";
import { createTerm } from "./term";
import { SCORER_VERSION } from "../version";
import { renderCard } from "./card";
import { HOSTED_URL } from "./hosted";
import { escapeHtml, renderMapNote, renderMapPage } from "./html-map";
import type { RenderMeta } from "./meta";

/**
 * THE HTML MAP — a file written onto somebody's disk, which is a different
 * kind of promise from a line printed in their terminal.
 *
 * The claim on the tin is "self-contained, zero external requests", and the
 * whole point of the first block of tests is that the claim is CHECKED rather
 * than asserted in a README: exactly one string in the document looks like a
 * network address, it is a plain anchor in the footer, and there is no
 * stylesheet link, no font, no image and no fetch anywhere in the file.
 */

function meta(target: string, overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target,
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

function page(fixture = MIXED, target = "acme-api"): string {
  const { reading } = readingOf(fixture);
  return renderMapPage(reading, meta(target));
}

describe("the page asks the network for nothing", () => {
  const html = page();

  it("carries exactly one URL, and it is the hosted link", () => {
    const urls = html.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    expect(urls).toEqual([HOSTED_URL, HOSTED_URL]); // the href and its label
    expect(html).toContain(`<a href="${HOSTED_URL}">${HOSTED_URL}</a>`);
  });

  it("links no stylesheet, embeds no font, loads no image", () => {
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("url(");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
  });

  it("contains nothing that could make a request at runtime", () => {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "navigator.sendBeacon",
      "EventSource",
      "import(",
    ]) {
      expect(html, `found ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * THE ONE `src`, AND WHY THE BLUNT RULE ABOVE NO LONGER CARRIES IT.
   *
   * "No `src=` anywhere" was in the list above until the PNG button, and it
   * could not tell a CDN from the page quoting itself: rasterising an svg
   * needs an image, and an image needs a source. So the rule is now the thing
   * it was always standing in for — every source in this file is a `data:` URI
   * the page builds from its own DOM, and there is exactly one of them.
   *
   * A markup `src="…"` would be a fetch at load and is still forbidden; the
   * script assignment is not, and the assertion tells them apart rather than
   * banning the four characters.
   */
  it("sets an image source once, from a data: URI it builds in the page", () => {
    // An ATTRIBUTE is preceded by whitespace inside a tag; the one assignment
    // in the script is preceded by a dot. Only the first is a load.
    expect(html, "a markup src attribute is a request at load").not.toMatch(/\ssrc\s*=/);
    expect((html.match(/\.src=/g) ?? []).length).toBe(1);
    expect(html).toContain("image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(");
  });

  it("is one file: the styles and the script are inline", () => {
    expect(html).toContain("<style>");
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
  });
});

describe("the page is a reading, not a chart", () => {
  const html = page();

  it("names itself, the repository and the lens", () => {
    expect(html).toContain("<title>Fathohm — git-only reading of acme-api</title>");
    expect(html).toContain(`scorer ${SCORER_VERSION}`);
    expect(html).toContain("2026-07-31T00:00:00Z");
  });

  it("carries the interval headline and the caption that explains it", () => {
    const { reading } = readingOf(MIXED);
    expect(reading.ceilingBlindBytes).toBeLessThan(reading.floorBlindBytes);
    expect(html).toMatch(/<span class="number">[^<]+–[^<]+<\/span> comprehension debt/);
    expect(html).toContain("the range is your unmeasured review record");
  });

  /**
   * The permanent provenance line. A treemap that lost it would be a picture
   * with the thing that made it honest cropped out.
   */
  it("carries the lower-bound line, verbatim from the card's own renderer", () => {
    expect(html).toContain("authorship is declared, not detected: undeclared agent work reads as human.");
  });

  it("carries the PARTIAL READING banner when the history is a fragment", () => {
    const shallow = page(SHALLOW);
    expect(shallow).toContain('<p class="banner">PARTIAL READING</p>');
    expect(shallow).toContain("this clone is shallow");
  });

  it("states where the line is, from the scorer's own constant", () => {
    expect(html).toContain("The line is at 0.30");
  });
});

/**
 * TWO SCREENSHOTS OF ONE REPOSITORY.
 *
 * From 1.5.0 the card headlines the DARK SHARE and this page headlines the
 * comprehension-debt INTERVAL — different quantities, both correct, and for one
 * release nothing on either surface said so. A reader holding both had two big
 * numbers and no rule for reconciling them, on the product whose whole argument
 * is "check it yourself".
 *
 * The page keeps the interval (the treemap is coloured by comprehension score,
 * so the interval is the number that describes the picture) and states the dark
 * share beside it. These tests assert the PROPERTY that closes the gap: both
 * surfaces state it, and the number they state is the one recomputed from the
 * reading's own files — never a percentage typed into a test, which would pin
 * today's fixture rather than the rule.
 */
describe("the page and the note reconcile with the read card", () => {
  const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });

  /** Recomputed from the files by `isDark`, not read off the reading's own
   *  field: a number that agrees with itself proves nothing. */
  function darkShareOf(fixture = MIXED): string {
    const { reading } = readingOf(fixture);
    return formatBlindShare((darkBytesOf(reading.files) / reading.scoredBytes) * 100);
  }

  it("states the dark share on the page, labelled and defined", () => {
    const share = darkShareOf();
    expect(page()).toContain(`${share} gone dark`);
    // The metaphor never travels alone, and the window it is defined by is
    // named rather than implied.
    expect(page()).toContain(
      `no human wrote or prompted it in the last ${DARK_WINDOW_DAYS} days`,
    );
  });

  it("states the same dark share in the terminal note", () => {
    const { reading } = readingOf(MIXED);
    const note = renderMapNote(reading, "/tmp/m.html", 48_000, term, meta("acme-api")).join(" ");
    expect(note).toContain(`${darkShareOf()} gone dark`);
  });

  it("states the number the read card actually headlines", () => {
    // The reconciliation is only worth anything if it quotes the OTHER card's
    // number. Same bytes, same denominator, same formatter — assert it against
    // the card's own sentence rather than against a literal.
    const { reading, tide } = readingOf(MIXED);
    const card = renderCard(reading, tide, term, meta("acme-api")).join(" ");
    expect(card).toContain(`${darkShareOf()} of this code has gone dark`);
  });

  it("keeps the interval as the page's headline — the map is of the score", () => {
    // The fix is a reconciliation, not a second hero: the debt interval is
    // still the one number set at headline size.
    expect(page()).toMatch(
      /<p class="headline"><span class="number">[^<]+<\/span> comprehension debt<\/p>/,
    );
    expect((page().match(/class="headline"/g) ?? []).length).toBe(1);
  });

  it("claims no dark share for a repository with nothing to fathom", () => {
    const { reading } = readingOf(EMPTY);
    expect(renderMapPage(reading, meta("fresh-repo"))).not.toContain("gone dark");
    expect(
      renderMapNote(reading, "/tmp/x.html", 1200, term, meta("fresh-repo")).join(" "),
    ).not.toContain("gone dark");
  });
});

/**
 * COPY AS PNG — the growth loop's one control, and the promise it makes.
 *
 * The Map is what gets pasted into a thread, and a window-cropped screenshot
 * of it loses the headline, the legend and the provenance. The button re-draws
 * the page's own svg, so what lands on the clipboard is the picture the file
 * carries — and the whole point is that it does so without the file gaining a
 * dependency, a request, or a place the image could go.
 */
describe("the PNG button", () => {
  const html = page();

  it("offers the copy, and says where the image goes", () => {
    expect(html).toContain('<button type="button" id="copy" class="copy">Copy as PNG</button>');
    expect(html).toContain("nothing is uploaded");
  });

  it("falls back to a download when the clipboard API is not there", () => {
    // The label changes BEFORE the press, so nobody clicks "Copy" and gets a
    // file in their downloads folder with no explanation.
    expect(html).toContain("window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write");
    expect(html).toContain("if(!canCopy)button.textContent='Download PNG';");
    expect(html).toContain("link.download='fathohm-map.png'");
  });

  it("draws at 2x, from the page's own geometry rather than a passed-in size", () => {
    // The claim in the module note is that NOTHING is handed to the script.
    // The canvas size comes off the svg's viewBox and the fill off the
    // figure's own background, so the file has no numbers in its script to
    // drift away from the ones in its markup.
    expect(html).toContain("var box=svg.viewBox.baseVal,width=box.width*2,height=box.height*2;");
    expect(html).toContain("ctx.fillStyle=getComputedStyle(map).backgroundColor;");
    expect(html).toContain("new ClipboardItem({'image/png':blob})");
  });

  it("carries the cells' own styling into the image, which has no stylesheet", () => {
    // The defect this closes is invisible in every text assertion: an svg
    // rendered from a data URI cannot see the page's CSS, so a PNG built
    // without this step loses the cell strokes and draws every label at a
    // browser default size — a picture that is not the picture on screen.
    expect(html).toContain("var css=getComputedStyle(live[j]);");
    for (const attribute of ["stroke", "stroke-width", "font-size", "font-family"]) {
      expect(html, `the PNG drops ${attribute}`).toContain(`setAttribute('${attribute}'`);
    }
  });

  /**
   * THE SCRIPT PARSES — the one thing about a written file that nothing else
   * here can catch.
   *
   * An inline script with a syntax error in it does not degrade: the browser
   * discards the whole block, so a stray bracket in the PNG handler would also
   * take the hover readout with it, and every test above would still pass
   * because they all read the file as text. Parsing it is the cheapest
   * possible proof that the page still has behaviour at all.
   */
  it("parses as JavaScript, so one typo cannot silently kill the page", () => {
    const script = /<script>([\s\S]+)<\/script>/.exec(html)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(0);
    expect(() => new Function(script)).not.toThrow();
  });

  it("is absent from a page with no map to copy", () => {
    const empty = page(EMPTY, "fresh-repo");
    expect(empty).not.toContain("Copy as PNG");
    expect(empty).not.toContain("id=\"copy\"");
  });
});

describe("the cells", () => {
  it("draws one rect per node, coloured on the PUBLIC diverging ramp", () => {
    const { reading } = readingOf(MIXED);
    const html = page();
    const rects = html.match(/<rect /g) ?? [];
    expect(rects.length).toBe(reading.files.length);
    for (const [, value] of html.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/g)) {
      // Cell fills come from `scoreColor`, so every one of them is a stop on
      // the public ramp — the same ink the gallery paints the same score with.
      expect([...DIVERGING]).toContain(value);
    }
  });

  it("gives every cell a readout of path, score and bucket", () => {
    const html = page(PROMPTED_DOMINANT, "acme-jobs");
    expect(html).toContain("data-fathohm=\"src/agents/router.ts · ");
    expect(html).toMatch(/data-fathohm="src\/agents\/router\.ts · 0\.\d{3} · [a-z ]+ · \d/);
  });

  it("keeps the cells reachable by keyboard, with the readout as their name", () => {
    const html = page();
    expect(html).toContain('tabindex="0"');
    expect(html).toMatch(/aria-label="[^"]+" data-fathohm="[^"]+"/);
  });

  it("lays the tree out inside the canvas, with no overlap off the edges", () => {
    const html = page();
    const rects = [...html.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
    expect(rects.length).toBeGreaterThan(0);
    let area = 0;
    for (const [, x, y, width, height] of rects) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(x) + Number(width)).toBeLessThanOrEqual(1200.01);
      expect(Number(y) + Number(height)).toBeLessThanOrEqual(680.01);
      area += Number(width) * Number(height);
    }
    // Squarify tiles the canvas exactly: the areas add up to all of it, which
    // is what makes "area is bytes" a true sentence rather than a gesture.
    expect(area).toBeCloseTo(1200 * 680, -2);
  });
});

describe("hostile and degenerate inputs", () => {
  it("escapes a repository that tries to write its own markup", () => {
    const nasty = {
      tree: [['src/<script>alert("x")</script>.ts', 2000] as const],
      commits: [{ daysAgo: 3, paths: ['src/<script>alert("x")</script>.ts'] }],
    };
    const { reading } = readingOf(nasty);
    const html = renderMapPage(reading, meta("nasty"));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)");
    // …and the only real script tag is still fathohm's own.
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
  });

  /**
   * The brand-risk rule, on the surface it matters most: a written file gets
   * kept and sent on. "0% unfathomed" over an empty rectangle is a screenshot
   * claiming a perfectly understood codebase.
   */
  it("draws nothing, and claims nothing, for an empty repository", () => {
    const html = page(EMPTY, "fresh-repo");
    expect(html).toContain("<title>Fathohm — git-only reading of fresh-repo</title>");
    expect(html).not.toContain("<rect ");
    expect(html).not.toContain("<svg");
    expect(html).toContain("nothing to fathom here yet");
    expect(html).toContain("no commits");
    // The provenance survives — the terms of a reading outlive its numbers.
    expect(html).toContain("authorship is declared, not detected: undeclared agent work reads as human.");
    expect(html).not.toMatch(/\d+%/);
  });

  it("is byte-identical across two renders of the same reading", () => {
    expect(page()).toBe(page());
  });

  it("parses as a document: one head, one body, balanced tags", () => {
    const html = page();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    for (const tag of ["html", "head", "body", "main", "svg", "style", "script"]) {
      expect((html.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length).toBe(1);
      expect((html.match(new RegExp(`</${tag}>`, "g")) ?? []).length).toBe(1);
    }
    expect(html.endsWith("</html>\n")).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("handles every character that could break out of an attribute", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("the terminal note that follows the file", () => {
  const term = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });

  it("says where it went, how big it is, and that it loads nothing", () => {
    const { reading } = readingOf(MIXED);
    const lines = renderMapNote(reading, "/tmp/fathohm-map.html", 48_000, term, meta("acme-api"));
    const text = lines.join("\n");
    expect(text).toContain("wrote /tmp/fathohm-map.html");
    expect(text).toContain("47K");
    // Twelve, not thirteen: MIXED's README.md is prose and no longer in the
    // code roster the count and the headline share.
    expect(text).toContain("12 files");
    expect(text).toContain("requests nothing");
  });

  it("never claims a percentage for a repository with nothing to fathom", () => {
    const { reading } = readingOf(EMPTY);
    const lines = renderMapNote(reading, "/tmp/x.html", 1200, term, meta("fresh-repo"));
    expect(lines.join("\n")).toContain("nothing to fathom here yet");
    expect(lines.join("\n")).not.toMatch(/%/);
  });
});
