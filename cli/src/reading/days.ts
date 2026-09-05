/**
 * WHOLE DAYS BETWEEN TWO INSTANTS — the one spelling every surface counts with.
 *
 * It is arithmetic yielding a number, so it lives in `reading/`, and the four
 * printers that put a `Nd ago` on a screen import it from here. It used to sit
 * in `render/text.ts` among the quoting and padding helpers, which made every
 * computing file that needed an age reach across the lane boundary for it.
 *
 * FLOORED AND CLAMPED, both deliberately. Floored because "300d ago" must not
 * become "301d ago" six hours early — a reader checking the claim against
 * `git log` would find the commit a day off and stop trusting the column.
 * Clamped at zero because a repository can carry a commit dated in the future
 * (a wrong clock, a rebase, a signed backdate), and "-4d ago" is a sentence
 * about nothing that would make it into a screenshot.
 */
export function daysBetween(from: Date, to: Date): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}
