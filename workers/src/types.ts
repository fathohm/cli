export type EventKind = "commit" | "pr_opened" | "review" | "approval" | "comment";
export type Authorship = "human" | "agent" | "mixed" | "unknown" | "bot";
export type AgentSignature = "claude_code" | "copilot" | "cursor" | null;

/**
 * Two or more parents = a merge. The one structural test for an acceptance
 * event; never the message, which is prose and lies. Stated here, with the
 * event vocabulary, because both readers of the spine apply it: the webhook
 * parser (./parse-events) and the CLI's local git reader.
 */
export const MERGE_PARENT_COUNT = 2;

export interface DepthSignal {
  reviewCommentCount: number;
  timeToApproveSeconds: number | null;
  /** Scorer v4. Optional because rows written before v4 do not carry them, and
   *  `reviewBodyChars` being ABSENT is load-bearing: it means "not recorded",
   *  which sends the scorer back to the pre-v4 count ramp rather than scoring
   *  the review as an empty body. */
  reviewBodyChars?: number;
  /** Did this review block the merge (GitHub CHANGES_REQUESTED)? */
  changesRequested?: boolean;
}

export interface CodeEventRow {
  repoId: string;
  kind: EventKind;
  actorGithubUserId: number | null;
  authorship: Authorship;
  agentSignature: AgentSignature;
  authorKey: string | null;
  paths: string[];
  depthSignal: DepthSignal;
  githubNativeId: string;
  occurredAt: string;
}

export interface IngestJobRow {
  id: string;
  repoId: string;
  source: "webhook" | "backfill";
  payload: unknown;
  status: "pending" | "processed" | "failed";
}
