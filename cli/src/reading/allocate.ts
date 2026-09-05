/**
 * LARGEST REMAINDER — the one rounding rule every printed column shares.
 *
 * It yields integers that sum to a budget, and those integers are part of the
 * contract rather than the typesetting: `units` is a field in the validated
 * JSON schema and in the team golden file, so a machine reading `--json` gets
 * this number too. That is why it computes in `reading/` and not beside the
 * bars it happens to draw.
 *
 * Two callers, one rule: the ledger's group column and `fathohm team`'s keeper
 * table are the same problem over different partitions — rows that must add to
 * a hundred in the printed column, with the same two display floors on the
 * small ones. A second allocator would be a second rounding rule, and the first
 * screenshot where the two disagreed would be the one somebody put in a deck.
 */
export function allocateUnits(percents: readonly number[], budget: number): number[] {
  const pinned = percents.map(pinnedUnits);
  const free: number[] = [];
  for (let index = 0; index < percents.length; index += 1) {
    if (pinned[index] === null) free.push(index);
  }

  const allocation = percents.map((_percent, index) => pinned[index] ?? 0);
  let remaining = budget - allocation.reduce((sum, units) => sum + units, 0);

  for (const index of free) {
    const floored = Math.max(0, Math.floor(percents[index]));
    const take = Math.min(floored, Math.max(0, remaining));
    allocation[index] = take;
    remaining -= take;
  }

  // The leftover units, biggest fraction first. Recomputed each pass rather
  // than sorted once: the clamp above can leave a group short of its own floor,
  // and a single sorted pass would hand its unit to somebody else forever.
  while (remaining > 0 && free.length > 0) {
    let best = free[0];
    for (const index of free) {
      const mine = percents[index] - allocation[index];
      const theirs = percents[best] - allocation[best];
      if (mine > theirs || (mine === theirs && percents[index] > percents[best])) best = index;
    }
    allocation[best] += 1;
    remaining -= 1;
  }

  return allocation;
}

/**
 * The units a display floor claims, or null when the share prints as an integer.
 *
 * Exported for `render/ledger.printedShare`, which applies the same two floors
 * to the EXACT value when it turns an allocated unit back into text. The
 * allocator and the formatter disagreeing about what counts as `<1%` is exactly
 * the bug this shared helper exists to make impossible.
 */
export function pinnedUnits(percent: number): number | null {
  if (!(percent > 0)) return 0;
  if (percent >= 100) return 100;
  if (percent < 1) return 0;
  if (percent > 99) return 99;
  return null;
}

