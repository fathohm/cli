// lib/blind-share-format.ts
//
// The ONE way the blind-spot headline is turned into text.
//
// The number is a byte-weighted share, and every surface used to render it as
// `Math.round(share)` + "%". That prints "0%" for a repo with real comprehension
// debt in it — 0.4% of a million-line codebase is four thousand lines no human
// understands, and "0%" says there are none. The product's whole claim is that
// it makes an invisible problem visible; a rounding rule that erases the problem
// at exactly the moment it first appears is the opposite of that. The same
// applies at the top: 99.6% must not print as "100%", which claims a repo
// nobody understands ANY of.
//
// So: a true zero prints "0%" and a true hundred prints "100%", and nothing else
// ever does. Everything strictly between rounds, except the two open intervals
// that would round INTO an absolute, which print "<1%" and ">99%".
//
// Pure and deterministic — no clock, no IO, no locale.

/** The exact byte-weighted share as a percent (0..100). 0 when nothing is
 *  scored: a repo with no scored bytes has no debt to report, not an unknown
 *  one — the unscored count is named separately wherever this renders. */
export function exactBlindShare(blindBytes: number, scoredBytes: number): number {
  return scoredBytes > 0 ? (blindBytes / scoredBytes) * 100 : 0;
}

/**
 * The share as a display VALUE, without the percent sign — for the hero, whose
 * "%" is a separate `<sup>` element.
 */
export function blindShareValue(share: number): string {
  if (!Number.isFinite(share)) return "0";
  if (share <= 0) return "0";
  if (share >= 100) return "100";
  if (share < 1) return "<1";
  if (share > 99) return ">99";
  return String(Math.round(share));
}

/** The share as display TEXT, percent sign included. */
export function formatBlindShare(share: number): string {
  return `${blindShareValue(share)}%`;
}

/** The common case: format straight from the byte counts every headline and
 *  digest payload already carries. */
export function formatBlindShareFromBytes(blindBytes: number, scoredBytes: number): string {
  return formatBlindShare(exactBlindShare(blindBytes, scoredBytes));
}

/**
 * A percentage the USER supplied — a CI gate's `--max-blind` limit — echoed
 * back with its percent sign.
 *
 * NOT for measurements, and the distinction is the whole reason it is a
 * separate function. The display floors above exist because a computed share
 * must never round into an absolute claim; a limit is not a claim about a
 * codebase, it is a number somebody typed. Rendering a limit of 0.5 as "<1%"
 * would misquote the caller to themselves in the one sentence a gate prints.
 * `String` already drops trailing zeros, so `40` and `40.0` read the same.
 */
export function formatLimitPercent(limit: number): string {
  return `${Number.isFinite(limit) ? String(limit) : "0"}%`;
}

/** A Headline's own share as text. Structurally typed rather than importing
 *  Headline, so map-tree and this module stay independent. */
export function formatHeadlineShare(headline: { blindBytes: number; scoredBytes: number }): string {
  return formatBlindShareFromBytes(headline.blindBytes, headline.scoredBytes);
}
