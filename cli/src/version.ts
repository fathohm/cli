import { SCORER_VERSION } from "../../workers/src/scorer";

/**
 * The CLI's own version. Kept in lockstep with `cli/package.json` by a test —
 * the published binary and the string it prints must never disagree.
 */
export const CLI_VERSION = "1.6.3";

export { SCORER_VERSION };

/**
 * `--version` prints BOTH versions, always. The scorer version is the one that
 * matters for reading a number: the same repo read by two scorer versions is
 * two different readings, and a reading you cannot attribute to a lens is not
 * evidence. The card repeats it for the same reason.
 */
export function versionLine(): string {
  return `fathohm ${CLI_VERSION} (scorer ${SCORER_VERSION})`;
}
