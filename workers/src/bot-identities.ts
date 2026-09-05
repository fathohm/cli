// workers/src/bot-identities.ts
//
// The allowlist of scripted-automation identities that resolve to authorship
// "bot" by heuristic, never by LLM.
//
// Why exact-name and not a pattern: a blanket /\[bot\]/ rule would swallow
// Devin, Sweep and every future coding agent that ships as a GitHub App —
// those are genuine agents and belong in the LLM residue, where an
// unrecognised automated identity is resolved rather than assumed. Every
// entry here is a name we can point at and defend.
//
// This list is public methodology (CLAUDE.md): it is a plain exported
// constant so the docs can render it and users can dispute it. Authorship
// labels are user-correctable, which is the backstop for a wrong entry.

// Each entry is annotated with the ground on which we'd defend it to a user
// who disputes the label. If an entry cannot carry a justification it can
// carry in this file, it does not belong here.
export const KNOWN_BOT_IDENTITIES: readonly string[] = [
  // GitHub-native dependency updates: template-driven version bumps.
  "dependabot[bot]",
  // The legacy Dependabot app (deprecated 2021). Kept because backfill walks
  // long histories, where this name still appears.
  "dependabot-preview[bot]",
  // Mend Renovate: dependency updates, same class as Dependabot. Self-hosted
  // instances often commit under a custom name; those fall to the residue,
  // which is the safe direction.
  "renovate[bot]",
  // CI runner identity. CAVEAT — the one entry here that names a *runner*
  // rather than a *tool*: a coding agent invoked inside a workflow commits
  // under this name too. Agent signatures are checked BEFORE this allowlist on
  // BOTH paths — detectAuthorship() in workers/src/authorship.ts when the
  // commit is ingested, and effectiveAuthorship() in
  // workers/src/job-processing.ts when history is re-derived — so an agent in
  // Actions that leaves a co-author trailer resolves to "agent", not "bot".
  // The two are pinned in agreement by test, not by convention.
  // The residual narrowing, stated plainly: an agent running in CI that leaves
  // NO trailer is indistinguishable from a workflow script by name alone, and
  // we label it "bot". We accept that because the alternative is measured
  // non-determinism (a live query on one repo returned "agent" 25x and "human"
  // 1x for this identical string), and because authorship labels are
  // user-correctable. Note the error direction is safe: "bot" withholds human
  // comprehension credit, so a wrong label here can only overstate debt, never
  // hide it.
  "github-actions[bot]",
  // Snyk automated vulnerability-fix PRs: template patches. Note it carries
  // no "[bot]" suffix — further evidence a suffix pattern would not work.
  "snyk-bot",
  // pre-commit.ci autofix commits: deterministic formatter/linter output.
  "pre-commit-ci[bot]",
  // Image compression: purely mechanical.
  "imgbot[bot]",
  // Updates the contributors table in the README: purely mechanical.
  "allcontributors[bot]",
];

const LOOKUP = new Set(KNOWN_BOT_IDENTITIES.map((name) => name.toLowerCase()));

/** Exact-name membership test, case-insensitive and whitespace-trimmed.
 *  Deliberately NOT a substring or pattern match — see the note above. */
export function isKnownBot(identity: string | null | undefined): boolean {
  if (!identity) return false;
  return LOOKUP.has(identity.trim().toLowerCase());
}
