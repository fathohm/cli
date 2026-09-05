import type { FileEntry } from "../../../lib/map-tree";
import type { RepoReading } from "../reading/scoring";

/**
 * The adapter: a git-only reading, in the shape the dashboard's own explainer
 * reads.
 *
 * `lib/reading-explained.ts` partitions files into buckets and writes the
 * sentences under the hosted headline. Those sentences are the product's
 * voice, they are already tested, and the founder's "we should have proper
 * explanation" is what put them there — so the CLI must not have a second set.
 * The only thing standing between a `ScoredFile` and that module is a field
 * rename, which is all this file is.
 *
 * Two decisions worth stating.
 *
 * **The score is the FLOOR.** Buckets explain the evidence as it stands, and
 * the ceiling is not evidence — it is the size of what git cannot see. The
 * spec puts it as a parity invariant: buckets are computed at the floor, one
 * denominator with the headline.
 *
 * **Sizes are the raw bytes git reported.** `joinRows` clamps a zero-byte file
 * to one byte because the treemap's squarify pass drops non-positive areas;
 * nothing here is laying out rectangles, and the clamp would put a byte into
 * the buckets' denominator that the headline above them does not have. Two
 * denominators on one card is the exact bug the choke point exists to prevent.
 */
export function fileEntries(reading: RepoReading): FileEntry[] {
  return reading.files.map((file) => ({
    path: file.path,
    size: file.bytes,
    score: file.floor,
    // `DerivedFactors` is `Factors` plus a REQUIRED engagement record, so a
    // CLI reading can never land in the `unexplained` bucket: that bucket is
    // for rows stamped by a scorer older than the engagement lens, and every
    // row here was stamped seconds ago by the current one.
    factors: file.factors,
    // Authorship colouring is the Map's mode switch, not the card's. Left
    // null rather than guessed — the reading records authorship per EVENT, and
    // picking a file's "dominant" one is a derivation this surface never uses.
    latestAuthorship: null,
  }));
}
