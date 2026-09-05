/**
 * Illustrative Map data for the Gate-0 landing page and OG image.
 *
 * This is EXAMPLE data — no real customer repo. It is "fake but honest":
 * every score is computed through the real scoring v0 formula from the
 * spec (deterministic, decomposable into factors), and the page labels
 * the Map as illustrative wherever it appears.
 */

export type Authorship = "human" | "agent" | "mixed";

/**
 * The additive decomposition scoring v1+ writes alongside the four factors, so
 * a caption can say WHICH kind of contact a file last had without re-reading
 * the spine.
 *
 * Declared HERE, beside `Factors`, because it is part of what lands in the
 * `factors` jsonb column and both sides of the codebase read it: the worker
 * produces it (workers/src/scorer.ts re-exports this exact type) and the
 * dashboard explains the reading from it (lib/reading-explained.ts). Two
 * structurally-identical declarations is how a shape starts drifting.
 */
export interface Engagement {
  /** Latest commit whose authorship is `human`, or null. */
  last_hand_authored: string | null;
  /** Latest commit whose authorship is `mixed`, or null. */
  last_prompted: string | null;
  /** People by their max engagement weight: >= 1 is `full`, anything else
   *  above 0 is `prompted`. Zero-weight actors (agents, bots, button-pressers)
   *  are counted as neither, because they are not contributors of understanding. */
  contributors: { full: number; prompted: number };
}

/** Scoring v0 factors, each 0..1. */
export interface Factors {
  /** Substantive human review: comments, discussion — 0 for approval-without-comment. */
  human_review_depth: number;
  /** How recently a human meaningfully authored here; decays over 180 days. */
  human_author_recency: number;
  /** Distinct humans with substantive contact, normalized. */
  bus_factor: number;
  /** Verified comprehension from paydown-session answers. 0 everywhere since
   *  scorer v3: self-assessments are collected and shown, never scored. The
   *  weight is held, not retired — see lib/answerability-core.ts. */
  question_answerability: number;
}

/**
 * A `factors` jsonb row as it comes back out of the column: the four scored
 * factors, plus the OPTIONAL engagement decomposition v1+ writes beside them.
 *
 * Deliberately a separate type rather than a fifth key on `Factors`.
 * `keyof Factors` is load-bearing in a dozen places — it means "the four
 * weighted factors", it indexes `WEIGHTS`, and it drives every decomposition
 * row in the UI. Engagement is not a factor and carries no weight; it is
 * evidence ABOUT the factors. Widening `Factors` would have made
 * `factors[key]` a `number | Engagement` everywhere the score is decomposed.
 *
 * Optional on purpose: rows stamped before scoring v1 simply lack the key.
 * Consumers must tolerate its absence rather than guess — "not recorded" is a
 * different fact from "recorded, and it was zero", and lib/reading-explained.ts
 * sorts such files into their own honest bucket instead of inventing a story.
 */
export type StoredFactors = Factors & { engagement?: Engagement };

/** Scoring v0 weights from the spec: (0.4, 0.25, 0.25, 0.1). */
export const WEIGHTS: Factors = {
  human_review_depth: 0.4,
  human_author_recency: 0.25,
  bus_factor: 0.25,
  question_answerability: 0.1,
};

/** score(file) = Σ weight_i · factor_i — deterministic, no black box. */
export function scoreFromFactors(factors: Factors): number {
  return (
    WEIGHTS.human_review_depth * factors.human_review_depth +
    WEIGHTS.human_author_recency * factors.human_author_recency +
    WEIGHTS.bus_factor * factors.bus_factor +
    WEIGHTS.question_answerability * factors.question_answerability
  );
}

/** Below this score, no human on the file's recent record has written,
 *  reviewed, or explained it. Describes the record, never the mind — the
 *  guardrail strips comments, so this one is on us to keep honest. */
export const BLIND_SPOT_THRESHOLD = 0.3;

interface DemoFileInput {
  name: string;
  loc: number;
  authorship: Authorship;
  factors: Factors;
  note?: string;
}

interface DemoDirInput {
  dir: string;
  files: DemoFileInput[];
}

function f(
  human_review_depth: number,
  human_author_recency: number,
  bus_factor: number,
): Factors {
  return { human_review_depth, human_author_recency, bus_factor, question_answerability: 0 };
}

const DEMO_INPUT: DemoDirInput[] = [
  {
    dir: "services/billing",
    files: [
      {
        name: "reconcile.ts",
        loc: 1840,
        authorship: "agent",
        factors: f(0.0, 0.15, 0.1),
        note: "Agent-authored, merged with 0 review comments. Touches payments.",
      },
      {
        name: "invoices.ts",
        loc: 1200,
        authorship: "agent",
        factors: f(0.1, 0.2, 0.2),
        note: "One-line approval, no discussion.",
      },
      { name: "webhooks.ts", loc: 860, authorship: "mixed", factors: f(0.35, 0.5, 0.3) },
      {
        name: "tax.ts",
        loc: 620,
        authorship: "agent",
        factors: f(0.15, 0.3, 0.1),
        note: "Single reviewer, skimmed.",
      },
    ],
  },
  {
    dir: "services/auth",
    files: [
      { name: "session.ts", loc: 940, authorship: "human", factors: f(0.8, 0.6, 0.7) },
      { name: "oauth.ts", loc: 720, authorship: "mixed", factors: f(0.55, 0.45, 0.5) },
      { name: "rbac.ts", loc: 510, authorship: "agent", factors: f(0.3, 0.55, 0.3) },
    ],
  },
  {
    dir: "services/sync",
    files: [
      {
        name: "engine.ts",
        loc: 1650,
        authorship: "agent",
        factors: f(0.05, 0.4, 0.1),
        note: "2,000-line agent PR, approved in 4 minutes.",
      },
      {
        name: "conflict.ts",
        loc: 880,
        authorship: "agent",
        factors: f(0.2, 0.35, 0.2),
        note: "Only reviewer left the team in March.",
      },
      { name: "queue.ts", loc: 560, authorship: "human", factors: f(0.7, 0.5, 0.6) },
    ],
  },
  {
    dir: "app",
    files: [
      { name: "dashboard.tsx", loc: 1150, authorship: "human", factors: f(0.75, 0.8, 0.8) },
      { name: "settings.tsx", loc: 680, authorship: "mixed", factors: f(0.5, 0.6, 0.5) },
      { name: "onboarding.tsx", loc: 790, authorship: "agent", factors: f(0.25, 0.7, 0.3) },
      { name: "charts.tsx", loc: 920, authorship: "agent", factors: f(0.35, 0.5, 0.25) },
    ],
  },
  {
    dir: "lib",
    files: [
      { name: "db.ts", loc: 740, authorship: "human", factors: f(0.85, 0.55, 0.9) },
      { name: "validation.ts", loc: 430, authorship: "human", factors: f(0.8, 0.7, 0.8) },
      { name: "feature-flags.ts", loc: 310, authorship: "mixed", factors: f(0.5, 0.65, 0.6) },
      {
        name: "telemetry.ts",
        loc: 520,
        authorship: "agent",
        factors: f(0.2, 0.45, 0.2),
        note: "Nobody has opened this file since it merged.",
      },
    ],
  },
  {
    dir: "workers",
    files: [
      { name: "ingest.ts", loc: 980, authorship: "agent", factors: f(0.3, 0.5, 0.25) },
      { name: "retries.ts", loc: 410, authorship: "mixed", factors: f(0.45, 0.5, 0.4) },
      { name: "scheduler.ts", loc: 530, authorship: "human", factors: f(0.75, 0.4, 0.7) },
    ],
  },
  {
    dir: "infra",
    files: [
      { name: "main.tf", loc: 640, authorship: "human", factors: f(0.7, 0.3, 0.5) },
      { name: "ci.yml", loc: 280, authorship: "human", factors: f(0.65, 0.75, 0.6) },
    ],
  },
  {
    dir: "tests",
    files: [
      { name: "billing.test.ts", loc: 720, authorship: "agent", factors: f(0.35, 0.6, 0.3) },
      { name: "e2e.test.ts", loc: 610, authorship: "human", factors: f(0.6, 0.65, 0.5) },
    ],
  },
];

export interface DemoFile {
  path: string;
  name: string;
  dir: string;
  loc: number;
  authorship: Authorship;
  factors: Factors;
  score: number;
  note?: string;
}

export interface DemoDir {
  dir: string;
  loc: number;
  files: DemoFile[];
}

export const DEMO_DIRS: DemoDir[] = DEMO_INPUT.map(({ dir, files }) => ({
  dir,
  loc: files.reduce((sum, file) => sum + file.loc, 0),
  files: files.map((file) => ({
    ...file,
    dir,
    path: `${dir}/${file.name}`,
    score: scoreFromFactors(file.factors),
  })),
}));

export const DEMO_FILES: DemoFile[] = DEMO_DIRS.flatMap((d) => d.files);

export const TOTAL_LOC = DEMO_FILES.reduce((sum, file) => sum + file.loc, 0);

export const BLIND_SPOT_LOC = DEMO_FILES.filter((file) => file.score < BLIND_SPOT_THRESHOLD).reduce(
  (sum, file) => sum + file.loc,
  0,
);

/** The headline: LOC-weighted share of the example repo below the blind-spot threshold. */
export const BLIND_SPOT_PERCENT = Math.round((BLIND_SPOT_LOC / TOTAL_LOC) * 100);

/** Lowest-scoring paths first — the "riskiest blind spots" list and table view. */
export const RISKIEST: DemoFile[] = [...DEMO_FILES].sort((a, b) => a.score - b.score).slice(0, 5);

export const AUTHORSHIP_LABEL: Record<Authorship, string> = {
  human: "Human-authored",
  agent: "Agent-authored",
  mixed: "Mixed authorship",
};
