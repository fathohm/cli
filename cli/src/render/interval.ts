import { formatBlindShare } from "../../../lib/blind-share-format";
import type { Term } from "./term";

/**
 * THE INTERVAL, as text — the one rendering of the headline mechanic, shared
 * by the card and the tide so the strip can never disagree with the number
 * printed above it.
 *
 * Both ends go through `lib/blind-share-format`, whose floors (`<1%`, `>99%`)
 * are a hard rule everywhere in this product: 0.4% of a million lines is four
 * thousand lines nobody understands, and "0%" says there are none.
 *
 * Which is also why the separator is a SPACED en dash. Unspaced, a floored end
 * renders `67%–>99%`, and `–>` reads as an arrow — the range would look like a
 * trend, in the one place this product cannot afford to be misread. Spaced, it
 * survives the ascii fold too: `67% - >99%`.
 *
 * A zero-width interval prints ONE number rather than the same number twice.
 * `47%–47%` is not a range, and rendering it as one invites the reader to
 * wonder what the second number was for.
 *
 * ZERO-WIDTH IS DECIDED ON THE RENDERED TEXT, NOT ON THE VALUES, and that is
 * the whole of a bug this file carried from the day it was written. The rule
 * above was applied to the floats, and the floors immediately made it a rule
 * about the strings: 0.3% and 0.8% are different numbers that both print as
 * `<1%`, so a repository sitting anywhere under one percent got a range
 * between a number and itself. It shipped on the founder's own reading of his
 * own repository, twice on one card — in the lede and again in the trend — and
 * survived because the precaution existed one level below the mistake.
 */
export function formatInterval(ceilingShare: number, floorShare: number, term: Term): string {
  const floor = formatBlindShare(floorShare * 100);
  const ceiling = formatBlindShare(ceilingShare * 100);
  return ceiling === floor ? floor : `${ceiling} ${term.glyph("endash")} ${floor}`;
}
