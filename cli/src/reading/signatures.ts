import type { AgentSignature } from "../../../workers/src/types";
import type { CliEvent } from "../repo/events";
import type { TreeEntry } from "../repo/extract";

/**
 * WHICH AGENT'S NAME IS ON THE CODE — bytes, by declared signature.
 *
 * The detector already knows this and the reading threw it away. Every
 * agent-authored commit is agent-authored BECAUSE of a specific declaration —
 * a `Co-Authored-By` trailer or a committer signature matching `claude_code`,
 * `copilot` or `cursor` — and until now the CLI kept the label and dropped the
 * evidence, so "43% of this repository has no human name on it" could not be
 * asked the obvious next question.
 *
 * It is carried in `--json` and NOWHERE ELSE. A tool that put a vendor
 * breakdown on the card would be reporting on agents, which is the sibling
 * product's subject and never this one's: the card's subject is the codebase
 * and the humans on its record. As data it is a legitimate join key for
 * somebody's own dashboard; as a headline it would be a different product.
 *
 * THREE THINGS IT IS NOT, and the note travels with the numbers so a consumer
 * cannot read it as any of them:
 *
 *   - `unsigned` is NOT "human". It is code the scorer labelled agent or mixed
 *     whose commit recorded no signature, and reading that column as human
 *     work would invert its meaning exactly. In a git-only reading it is
 *     structurally zero — a commit gets the agent label BECAUSE a signature
 *     matched — and it is carried anyway, at zero, because the shape must not
 *     change the day a reading has another source of labels. (An UNRECOGNISED
 *     trailer is not here at all: it never made the commit agent-authored in
 *     the first place, which is the lower-bound caveat every card prints.)
 *   - the vocabulary is THREE PATTERNS, not a census of the field. An agent
 *     that signs nothing reads as a person, everywhere in this tool, and the
 *     provenance line says so on every card.
 *   - a file lands in ONE column: the signature on its NEWEST agent or mixed
 *     event. A file three tools touched is attributed to the last one, because
 *     bytes cannot be split between them without inventing a share of a file
 *     that nothing in git measures.
 */

/** Bytes in the tree, by the declaration that made them agent-authored. */
export interface SignatureBytes {
  claude_code: number;
  copilot: number;
  cursor: number;
  /** Agent or mixed authorship, with no signature this vocabulary knows. */
  unsigned: number;
}

/**
 * The caveat that ships beside the numbers, in the document itself.
 *
 * A caveat that only exists in prose is a caveat that does not survive a
 * pipeline — the same reasoning that puts `agentShareIsLowerBound` in the
 * provenance block as a literal rather than as a comment.
 */
export const SIGNATURE_NOTE =
  "signature vocabulary is three patterns; unsigned means no recognised trailer, not human";

/** A file's bytes count once, under the newest declaration on its record. */
type SignatureKey = keyof SignatureBytes;

export function signatureBytes(
  tree: readonly TreeEntry[],
  byPath: ReadonlyMap<string, readonly CliEvent[]>,
): SignatureBytes {
  const bytes: SignatureBytes = { claude_code: 0, copilot: 0, cursor: 0, unsigned: 0 };
  for (const entry of tree) {
    const newest = newestAgentEvent(byPath.get(entry.path) ?? []);
    if (newest === null) continue;
    bytes[keyOf(newest.agentSignature)] += entry.bytes;
  }
  return bytes;
}

function keyOf(signature: AgentSignature): SignatureKey {
  return signature ?? "unsigned";
}

/**
 * The newest COMMIT on a path that the scorer labelled agent or mixed, or null.
 *
 * `human` and `bot` are not candidates: the question is which agent's
 * declaration is on the code, and neither of those carries one. Mixed IS a
 * candidate — a person formed the intent and an agent produced the diff, and
 * the trailer that says so is exactly the declaration being counted.
 *
 * A MERGE IS NOT A CANDIDATE EITHER, and it is the one exclusion worth stating
 * out loud because leaving it out was a measurable defect rather than a
 * nicety. A merge is an acceptance: somebody pressed a button and a branch's
 * worth of files landed, and this module's own rule in `events.ts` is that a
 * merge produced no content and therefore declares nothing — which is why its
 * signature is dropped there. Counting it here as a path's newest declaration
 * did the opposite: on a repository whose pull requests are merged with a
 * trailer in the merge message, every file whose last touch was the merge fell
 * out of `claude_code` and into `unsigned`. Run against fathohm's own history
 * that was 776K of code filed under "no signature" whose signature was
 * recorded two commits earlier.
 *
 * Compared on the timestamp rather than trusting the caller's ordering, and
 * ties go to the later element, so the answer is the same however the group
 * was built.
 */
function newestAgentEvent(events: readonly CliEvent[]): CliEvent | null {
  let newest: CliEvent | null = null;
  for (const event of events) {
    if (event.kind !== "commit") continue;
    if (event.authorship !== "agent" && event.authorship !== "mixed") continue;
    if (newest === null || Date.parse(event.occurredAt) >= Date.parse(newest.occurredAt)) {
      newest = event;
    }
  }
  return newest;
}
