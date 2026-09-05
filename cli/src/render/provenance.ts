import type { RepoReading } from "../reading/scoring";
import type { Term } from "./term";
import { INDENT, formatBytes, isoDay, paragraph } from "./text";

/**
 * THE PROVENANCE BLOCK — what this reading could not see.
 *
 * It is on every reading, including the ones with nothing to confess, because
 * the permanent line is always true: git records who declared themselves, and
 * an agent that signs nothing is indistinguishable from a person. Every number
 * on the card is therefore a LOWER bound on the agent share, and a product
 * whose only asset is trust says so on the same screen as the number rather
 * than in a methodology page nobody opens.
 *
 * The banner is the loud one and it is deliberately NOT a percentage. A
 * shallow clone has no denominator to be a share of — "you are seeing 40% of
 * the history" would itself be a fabrication, since the part that was never
 * fetched cannot be measured. So it names the condition and refuses to size
 * it, and `fathohm check` exits 3 rather than passing or failing on it.
 */
export function renderProvenance(reading: RepoReading, term: Term): string[] {
  const { provenance } = reading;
  const width = term.width - INDENT.length;
  const lines: string[] = [];

  const truncations: string[] = [];
  if (provenance.shallow) truncations.push("this clone is shallow");
  if (provenance.grafted) truncations.push("this history is grafted");
  if (truncations.length > 0) {
    // Its own line, and the ANSI stays out of the wrapper: a coloured span
    // inside wrapped prose is measured by its bytes rather than its columns,
    // and the line it lands on ends up short by the length of an escape.
    //
    // Named `red`, not a ramp index. Red on the depth scale MEANS "nobody
    // understands this"; red here means "stop", which is the terminal's own
    // convention and not a measurement. A banner wearing a data colour would
    // be the chrome borrowing the scale, which this product does not do.
    lines.push(INDENT + term.color(term.color("PARTIAL READING", "bold"), "red"));
    lines.push(
      ...paragraph(
        `${truncations.join(" and ")}: the commits behind the cut were never fetched, so ` +
          `everything above describes the fragment git can see, not the repository. Re-run in a ` +
          `full clone before quoting it.`,
        width,
      ),
    );
  }

  if (reading.squashOnly) {
    lines.push(
      ...paragraph(
        `the ceiling rests on subject lines: this history has squash-merge subjects and not one ` +
          `two-parent merge, so pull-request mediation was inferred from a naming convention.`,
        width,
      ),
    );
  }

  if (provenance.submodulesSkipped > 0) {
    const count = provenance.submodulesSkipped;
    lines.push(
      ...paragraph(
        `${count} ${count === 1 ? "submodule was" : "submodules were"} passed over: their history ` +
          `lives in another repository and their files are outside this reading's denominator.`,
        width,
      ),
    );
  }

  // Permanent. Not conditional on anything, and never edited down: it is the
  // sentence that keeps every number on the card a bound rather than a claim.
  lines.push(
    ...paragraph(
      "authorship is declared, not detected: undeclared agent work reads as human.",
      width,
    ),
  );

  // A denominator that shrank because of a config file is still a bounded
  // reading, and a bounded reading that does not say so is the same failure as
  // an unmentioned `--since` window: the number means something different
  // when a third of the repository was excluded on the way in.
  if (reading.excluded.fileCount > 0) {
    const { fileCount, bytes, patterns } = reading.excluded;
    lines.push(
      ...paragraph(
        `excluded by .fathohm.toml: ${fileCount} ${fileCount === 1 ? "file" : "files"} ` +
          `(${formatBytes(bytes)}) are outside this reading's denominator ` +
          `${term.glyph("dash")} ${patterns.join(", ")}.`,
        width,
      ),
    );
  }

  if (provenance.sinceBound !== null) {
    lines.push(
      ...paragraph(
        `window: since ${isoDay(provenance.sinceBound)} ${term.glyph("dash")} committer-date bound.`,
        width,
      ),
    );
  }

  if (provenance.atRef !== null) {
    lines.push(
      ...paragraph(
        `read as of ${provenance.atRef} ${term.glyph("dash")} the clock is that commit's own date.`,
        width,
      ),
    );
  }

  // A `--without` that matched nobody is the one failure mode of a bus-factor
  // simulation that looks exactly like a success: the reading comes back
  // unchanged and reads as "we are fine without them".
  for (const match of reading.withoutMatches) {
    if (match.matched) continue;
    lines.push(
      ...paragraph(
        `--without "${match.query}" matched nobody in this history ${term.glyph("dash")} the ` +
          `reading above is unchanged. Try the address they commit from.`,
        width,
      ),
    );
  }

  return lines;
}
