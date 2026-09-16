import { isKnownBot } from "./bot-identities";
import type { AgentSignature, Authorship } from "./types";

export interface AuthorshipInput {
  authorName: string;
  authorEmail: string;
  /** "Name <email>" trailer lines, e.g. from "Co-authored-by:" */
  coAuthors: string[];
}

export interface AuthorshipResult {
  authorship: Authorship;
  agentSignature: AgentSignature;
}

// Anchored to the identities the tools actually write, matched against the name
// and the email SEPARATELY. The old substring match (`/claude|anthropic/` over
// "name email") labelled a human called Claude Dupont — or anyone at
// precursor@… — as an agent, and their code went dark.
const AGENT_SIGNATURES: Array<{ name: RegExp; email: RegExp; signature: Exclude<AgentSignature, null> }> = [
  {
    name: /^claude(\[bot\])?$/i,
    email: /^noreply@anthropic\.com$|^\d+\+claude(\[bot\])?@users\.noreply\.github\.com$/i,
    signature: "claude_code",
  },
  {
    name: /^(github )?copilot(-swe-agent)?(\[bot\])?$/i,
    email: /^copilot@github\.com$|^\d+\+copilot(-swe-agent)?(\[bot\])?@users\.noreply\.github\.com$/i,
    signature: "copilot",
  },
  {
    name: /^cursor( ?agent)?(\[bot\])?$/i,
    email: /^(cursor)?agent@cursor\.(com|sh)$/i,
    signature: "cursor",
  },
];

// Committer identities that look automated but match no known agent
// signature: genuinely ambiguous authorship — possibly an agent we don't
// have a signature for yet. These are the residue the LLM classifier
// resolves (CLAUDE.md: "heuristics first ... LLM only for the residue").
// Kept deliberately narrow so ordinary human committers — including those
// using GitHub privacy noreply emails — are labeled "human" directly and
// never reach the LLM. Authorship labels are user-correctable, which is the
// backstop for any false positive here.
const AMBIGUOUS_HINTS = [/\[bot\]/i, /\bbot\b/i, /\bautomation\b/i];

/**
 * The co-author trailer reader: every `Co-authored-by:` line in a commit
 * message, as the "Name <email>" text `detectAuthorship` matches signatures
 * against. Case-insensitive and per-line, because git writes the trailer with
 * whatever capitalisation the tool that added it chose.
 *
 * Lives here, beside the heuristics it feeds, rather than inside the webhook
 * parser: it is not a GitHub payload concern, and the CLI reads the identical
 * trailers out of `git log` with no webhook anywhere in sight. One reader, so
 * a repo scanned locally and the same repo ingested through the App cannot
 * disagree about who co-authored what.
 */
export function extractCoAuthors(message: string): string[] {
  return [...message.matchAll(/^Co-authored-by:\s*(.+)$/gim)].map((m) => m[1].trim());
}

function matchIdentity(name: string, email: string): AgentSignature {
  for (const signature of AGENT_SIGNATURES) {
    if (signature.name.test(name.trim()) || signature.email.test(email.trim())) {
      return signature.signature;
    }
  }
  return null;
}

/** A `Co-authored-by:` value — `Name <email>` — split into its two halves. */
function matchTrailer(trailer: string): AgentSignature {
  const parts = /^(.*?)\s*<([^>]*)>\s*$/.exec(trailer);
  return parts === null ? matchIdentity(trailer, "") : matchIdentity(parts[1], parts[2]);
}

function looksAmbiguous(text: string): boolean {
  return AMBIGUOUS_HINTS.some((pattern) => pattern.test(text));
}

/**
 * Heuristic authorship detection from committer identity and co-author
 * trailers. A recognized agent signature yields "agent" (or "mixed" when a
 * human is also present); it is checked FIRST, so an agent that leaves a
 * co-author trailer while committing under a CI account is still credited as
 * agent work rather than automation. A known-bot committer is never credited
 * as a human, so for an allowlisted identity the label is "agent" with a
 * signature and "bot" without — never "human", never "mixed".
 * effectiveAuthorship() in ./job-processing applies the identical rule at read
 * time; workers/src/authorship.test.ts pins the two in agreement.
 * A committer on the known-bot allowlist
 * (see ./bot-identities) then resolves to "bot" by name — deterministic, and
 * never sent to the LLM. An ordinary committer with no agent signal is
 * labeled "human" directly — the heuristics-first common case that never
 * touches the LLM. Only a committer that looks automated but matches neither
 * a known agent nor a known bot is returned as "unknown", the residue the LLM
 * classifier resolves.
 */
export function detectAuthorship(input: AuthorshipInput): AuthorshipResult {
  const authorText = `${input.authorName} ${input.authorEmail}`;
  const authorSignature = matchIdentity(input.authorName, input.authorEmail);
  const coAuthorSignatures = input.coAuthors.map(matchTrailer);
  const agentSignature = authorSignature ?? coAuthorSignatures.find((s) => s !== null) ?? null;

  if (agentSignature) {
    // A known-bot committer is never credited as the human in "mixed".
    // "Committer carries no agent signature" normally means a human typed it —
    // that is what makes a commit mixed — and the allowlist is the one signal
    // in this codebase that can DISPROVE it. github-actions[bot] with a Claude
    // trailer has no human in it at all, and "mixed" carries a quarter of an
    // engagement unit, crediting comprehension nobody has: the debt-hiding
    // failure the bot label exists to close.
    //
    // Nor do co-author trailers rescue it. That is not a special case invented
    // here — it is the rule this module already applies below, where a known
    // bot with a human co-author and NO agent signature returns "bot". So for
    // an allowlisted committer the label is fully determined by the signature:
    // "agent" when one is present, "bot" when not. Never human, never mixed.
    //
    // That rule is also the only one the read path can reproduce.
    // effectiveAuthorship() sees author_key, the stored label, and
    // agent_signature — never the co-author list. Any rule that depended on
    // co-authors would be one the read path structurally cannot honour, which
    // is how the write/read split opened in the first place.
    if (isKnownBot(input.authorName)) return { authorship: "agent", agentSignature };

    const humanPresent = authorSignature === null || coAuthorSignatures.some((s) => s === null);
    return { authorship: humanPresent ? "mixed" : "agent", agentSignature };
  }

  // Known automation, resolved by name — never sent to the LLM. This runs
  // AFTER signature matching so an agent co-author trailer still wins: Claude
  // running inside a GitHub Action is agent-authored code committed by the CI
  // account, not automation-authored code.
  if (isKnownBot(input.authorName)) {
    return { authorship: "bot", agentSignature: null };
  }

  if (looksAmbiguous(authorText)) {
    return { authorship: "unknown", agentSignature: null };
  }

  return { authorship: "human", agentSignature: null };
}

/**
 * The single read-time correction point for stored authorship labels. Rows
 * ingested before the known-bot allowlist carry whatever the LLM classifier
 * decided, which was non-deterministic for the same identity — one live repo
 * had the identical `github-actions[bot]` string stored as "agent" 25 times
 * and "human" once. That stray "human" is the damaging case: author_key makes
 * the bot a distinct human contributor, inflating bus_factor and refreshing
 * human_author_recency, so the file scores HIGHER than the truth and debt is
 * hidden.
 *
 * Re-deriving from author_key corrects every such row on the next recompute
 * without touching the append-only spine (CLAUDE.md invariant #1) — the same
 * retroactivity that lets an improved scorer re-value all history. The stored
 * label is left exactly as ingested; only the derived value moves.
 *
 * Scope: this re-derives the label for identities on the exact-name allowlist
 * only. An unrecognised bot-shaped author_key keeps its stored label (the
 * allowlist is deliberately not a pattern — see ./bot-identities), and no
 * other stored label is second-guessed here.
 *
 * Precedence matches the write path exactly (`detectAuthorship`, above): a
 * recognised agent signature is honoured BEFORE the allowlist, so an agent
 * running inside a GitHub Action — committed by the CI account but carrying a
 * real signature — stays "agent" rather than being flattened to "bot". Erasing
 * that would erase the product's core claim. What it does NOT do is call such
 * a commit human: no human was present, so the override can only ever move a
 * row from human to non-human. Both branches yield an engagement weight of 0,
 * which is what keeps the derived score monotonically non-increasing — this
 * correction never raises a score.
 *
 * It lives beside the write-path rule it mirrors (it was split out of
 * ./job-processing, which re-exports it, so every existing importer is
 * unaffected) for two reasons: the two rules are one rule stated twice and
 * drifted apart once already, and this module carries no zod/Supabase weight,
 * so the CLI can share the read-path derivation instead of restating it.
 */
export function effectiveAuthorship(
  authorKey: string | null | undefined,
  stored: Authorship,
  agentSignature: AgentSignature = null,
): Authorship {
  if (!isKnownBot(authorKey)) return stored;
  // A known-bot committer carrying a real agent signature is an agent running
  // in CI: keep the agent attribution, but never credit a human.
  return agentSignature !== null ? "agent" : "bot";
}
