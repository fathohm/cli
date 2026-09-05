// lib/map-tree.ts
//
// The pure core of the real Map: LEFT JOIN repo_tree ⟕ comprehension_scores,
// ghost filter, breadth-first budget aggregation that PRESERVES factor
// decomposability, and re-rooting for drill-down. Pure functions over plain
// inputs — no browser or DB dependency — so the whole thing is fixture-tested.
import { BLIND_SPOT_THRESHOLD, scoreFromFactors, type Factors, type StoredFactors } from "./demo-data";
import { isCodeFile } from "./code-files";

// TWO BUDGETS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
//
// NODE_BUDGET is the RENDER cap: how many cells the layout can draw at all. It
// exists so a 12k-file repo does not try to paint 12k rectangles.
//
// It was also, accidentally, the only control on visual density — and at 1500
// no real repo ever reached it. The expansion loop below therefore ran to full
// file level every time, so hono rendered 460 cells a few pixels wide instead
// of the 8 directories and 16 files one level up, and the drill-down those
// directory cells exist to offer had no entry point on any gallery repo.
//
// LEGIBLE_NODE_BUDGET is the READING cap: how many cells a person can take in
// at once. It belongs to surfaces that can drill (the gallery and the
// dashboard), where collapsing costs nothing because the detail is one click
// away. The CLI's HTML map keeps NODE_BUDGET: it is a static file with nowhere
// to drill to, so collapsing there would lose the detail permanently.
//
// Neither budget can move the headline: it is computed from the files under
// root, never from the cut (see computeHeadline below).
export const NODE_BUDGET = 1500;

// 60 IS MEASURED, NOT PICKED. Criterion: the Map's own legibility rule (a cell
// carries its name at w>=84 && h>=30, components/Map.tsx), applied to the
// squarified 1600x900 hero across all seven gallery snapshots.
//
//   budget   labelled cells   unlabelled   repos with a drill target
//   55-65         103             110              6/7
//   70            130             136              6/7
//   72-75         144             177              6/7
//   78-80         147             208              5/7
//   85-90         159             267              4/7
//
// Past 75 the trade goes bad: three more labels for thirty-one more unreadable
// slivers, and a repo loses its way in. 60 sits mid-plateau (55-65 produce an
// identical cut) rather than one step from the cliff at 78, which matters
// because the gallery gains repos over time and a constant on a cliff edge
// breaks quietly. Showing fewer cells is not lost information now that drilling
// works: it is one click away.
export const LEGIBLE_NODE_BUDGET = 60;

export type MapAuthorship = "human" | "agent" | "mixed" | "unknown" | "bot";

export interface TreeRow {
  path: string;
  sizeBytes: number;
}

export interface ScoreRow {
  path: string;
  score: number;
  /** The stored jsonb, engagement keys included where the scorer wrote them —
   *  a `Factors` everywhere the score is decomposed, and the evidence the repo
   *  page needs to EXPLAIN the reading (lib/reading-explained.ts). */
  factors: StoredFactors;
  latestAuthorship: MapAuthorship | null;
}

export interface MapNode {
  kind: "file" | "dir" | "agg"; // "agg" = layout-time merge of many tiny cells
  path: string; // full path; dir nodes are drill targets (?root=path)
  name: string; // display label (last path segment)
  sizeBytes: number;
  score: number | null; // null = unscored
  factors: StoredFactors | null;
  latestAuthorship: MapAuthorship | null; // dominant authorship (file, dir, and agg nodes)
  /** File nodes only: the path's latest debt decision is 'accepted'. Set ONLY
   *  when true so nodes without decisions stay deep-equal to their pre-2E
   *  shape. Dir/agg cells are never stamped (v1 — design D12). */
  accepted?: boolean;
  fileCount?: number; // dir/agg nodes: files aggregated
  unscoredCount?: number; // dir nodes: of those, how many unscored
  note?: string; // illustrative demo only; real data never sets it
}

export interface Headline {
  blindSpotPercent: number; // size-weighted share of SCORED bytes below threshold
  scoredFileCount: number;
  unscoredFileCount: number;
  totalFileCount: number;
  scoredBytes: number; // exposed for org-level combination
  blindBytes: number; // exposed for org-level combination
  /** Every code byte in the tree, scored or not. The denominator for coverage
   *  ("we scored N% of this codebase"), which is the question a reader asks the
   *  moment they learn the debt percent is over SCORED bytes only. */
  totalBytes: number;
}

export interface Breadcrumb {
  name: string;
  path: string; // "" = repo root
}

export interface MapTree {
  nodes: MapNode[];
  headline: Headline;
  breadcrumbs: Breadcrumb[];
  rootPath: string;
  rootFound: boolean;
}

const FACTOR_KEYS: Array<keyof Factors> = [
  "human_review_depth",
  "human_author_recency",
  "bus_factor",
  "question_answerability",
];

export interface FileEntry {
  path: string;
  size: number; // effective (>= 1): squarify drops non-positive areas
  score: number | null;
  factors: StoredFactors | null;
  latestAuthorship: MapAuthorship | null;
}

function segments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function normalizeRoot(root: string): string {
  return root.replace(/^\/+|\/+$/g, "");
}

/** LEFT JOIN tree ⟕ scores. This is the single choke point through which the
 *  Map, the headline, the riskiest table, and the weekly digest all read, so a
 *  filter here is inherited by every derived number and they can never disagree.
 *
 *  Non-code tree rows (images, media, fonts, lockfiles, prose documents, and
 *  files whose name declares them generated — see isCodeFile) are dropped up
 *  front: comprehension debt is a property of code, not of the assets, notes
 *  and machine output that share the repo tree. This is a DISPLAY-time filter —
 *  the event spine still records every file's history.
 *
 *  Then: ghost score rows (path absent from the tree) are dropped; tree paths
 *  with no score become unscored entries. Zero/negative byte sizes become 1. */
export function joinRows(treeRows: TreeRow[], scoreRows: ScoreRow[]): FileEntry[] {
  const byPath = new Map(scoreRows.map((r) => [r.path, r]));
  return treeRows.filter((t) => isCodeFile(t.path)).map((t) => {
    const s = byPath.get(t.path);
    return {
      path: t.path,
      size: t.sizeBytes > 0 ? t.sizeBytes : 1,
      score: s ? s.score : null,
      factors: s ? s.factors : null,
      latestAuthorship: s ? s.latestAuthorship : null,
    };
  });
}

/** Size-weighted mean of scored descendants' factors; null when none are
 *  scored. Score is recomputed from THESE factors by the caller via
 *  scoreFromFactors — never an average of child scores (bright line). */
function aggregateFactors(files: FileEntry[]): Factors | null {
  const scored = files.filter((f) => f.factors !== null);
  const totalWeight = scored.reduce((sum, f) => sum + f.size, 0);
  if (scored.length === 0 || totalWeight <= 0) return null;
  const acc: Factors = { human_review_depth: 0, human_author_recency: 0, bus_factor: 0, question_answerability: 0 };
  for (const f of scored) {
    for (const k of FACTOR_KEYS) acc[k] += (f.factors as Factors)[k] * f.size;
  }
  for (const k of FACTOR_KEYS) acc[k] = acc[k] / totalWeight;
  return acc;
}

/** Dominant authorship among a set of sized items: the authorship with the
 *  largest summed size. Items with `authorship === null` don't vote; if none
 *  vote, the result is null. Ties (equal summed size) resolve to the
 *  alphabetically-first authorship name — fully deterministic. Shared by dir
 *  nodes (here) and layout-time aggregate nodes. */
export function dominantAuthorship(
  items: ReadonlyArray<{ size: number; authorship: MapAuthorship | null }>,
): MapAuthorship | null {
  const sums = new Map<MapAuthorship, number>();
  for (const it of items) {
    if (it.authorship === null) continue;
    sums.set(it.authorship, (sums.get(it.authorship) ?? 0) + it.size);
  }
  if (sums.size === 0) return null;
  let best: MapAuthorship | null = null;
  let bestSum = -Infinity;
  // Iterate authorship names in ascending order so a tie in summed size keeps
  // the alphabetically-first name (a later equal sum never strictly exceeds).
  for (const auth of [...sums.keys()].sort()) {
    const sum = sums.get(auth) as number;
    if (sum > bestSum) {
      best = auth;
      bestSum = sum;
    }
  }
  return best;
}

type CutElement = { type: "file"; file: FileEntry } | { type: "dir"; key: string; members: FileEntry[] };

/** One level-k cut through the subtree under `root`: files at or above level k
 *  are leaves; deeper files fold into a directory keyed by their first k
 *  segments below root. First-appearance order is preserved. */
function cutAtLevel(files: FileEntry[], rootSegs: string[], k: number): CutElement[] {
  const order: CutElement[] = [];
  const dirIndex = new Map<string, Extract<CutElement, { type: "dir" }>>();
  for (const f of files) {
    const below = segments(f.path).slice(rootSegs.length);
    if (below.length <= k) {
      order.push({ type: "file", file: f });
    } else {
      const key = [...rootSegs, ...below.slice(0, k)].join("/");
      let dir = dirIndex.get(key);
      if (!dir) {
        dir = { type: "dir", key, members: [] };
        dirIndex.set(key, dir);
        order.push(dir);
      }
      dir.members.push(f);
    }
  }
  return order;
}

function nodeFromCut(el: CutElement, accepted: ReadonlySet<string>): MapNode {
  if (el.type === "file") {
    const f = el.file;
    return {
      kind: "file",
      path: f.path,
      name: segments(f.path).at(-1) ?? f.path,
      sizeBytes: f.size,
      score: f.score,
      factors: f.factors,
      latestAuthorship: f.latestAuthorship,
      ...(accepted.has(f.path) ? { accepted: true } : {}),
    };
  }
  const factors = aggregateFactors(el.members);
  return {
    kind: "dir",
    path: el.key,
    name: segments(el.key).at(-1) ?? el.key,
    sizeBytes: el.members.reduce((sum, m) => sum + m.size, 0),
    score: factors ? scoreFromFactors(factors) : null,
    factors,
    latestAuthorship: dominantAuthorship(
      el.members.map((m) => ({ size: m.size, authorship: m.latestAuthorship })),
    ),
    fileCount: el.members.length,
    unscoredCount: el.members.filter((m) => m.score === null).length,
  };
}

function buildBreadcrumbs(rootPath: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ name: "repo", path: "" }];
  let acc = "";
  for (const seg of segments(rootPath)) {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ name: seg, path: acc });
  }
  return crumbs;
}

export function computeHeadline(files: FileEntry[]): Headline {
  let scoredFileCount = 0;
  let unscoredFileCount = 0;
  let scoredBytes = 0;
  let blindBytes = 0;
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.size;
    if (f.score === null) {
      unscoredFileCount++;
    } else {
      scoredFileCount++;
      scoredBytes += f.size;
      if (f.score < BLIND_SPOT_THRESHOLD) blindBytes += f.size;
    }
  }
  return {
    blindSpotPercent: scoredBytes > 0 ? Math.round((blindBytes / scoredBytes) * 100) : 0,
    scoredFileCount,
    unscoredFileCount,
    totalFileCount: files.length,
    scoredBytes,
    blindBytes,
    totalBytes,
  };
}

/**
 * Combine per-repo headlines into one org-level headline. Sums numerators
 * (blindBytes) and denominators (scoredBytes) and re-derives the percentage —
 * it NEVER averages the per-repo percentages, which would weight a 10-byte
 * repo the same as a 100k-byte repo. This is the ONE org-level definition of
 * blind spot; it is the same size-weighted math computeHeadline uses over a
 * wider input.
 */
export function combineHeadlines(headlines: Headline[]): Headline {
  let scoredBytes = 0;
  let blindBytes = 0;
  let scoredFileCount = 0;
  let unscoredFileCount = 0;
  let totalFileCount = 0;
  let totalBytes = 0;
  for (const h of headlines) {
    scoredBytes += h.scoredBytes;
    blindBytes += h.blindBytes;
    scoredFileCount += h.scoredFileCount;
    unscoredFileCount += h.unscoredFileCount;
    totalFileCount += h.totalFileCount;
    totalBytes += h.totalBytes;
  }
  return {
    blindSpotPercent: scoredBytes > 0 ? Math.round((blindBytes / scoredBytes) * 100) : 0,
    scoredFileCount,
    unscoredFileCount,
    totalFileCount,
    scoredBytes,
    blindBytes,
    totalBytes,
  };
}

export function buildMapTree(
  treeRows: TreeRow[],
  scoreRows: ScoreRow[],
  options?: { root?: string; nodeBudget?: number; accepted?: ReadonlySet<string> },
): MapTree {
  const budget = options?.nodeBudget ?? NODE_BUDGET;
  const accepted = options?.accepted ?? new Set<string>();
  const requestedRoot = normalizeRoot(options?.root ?? "");
  const allFiles = joinRows(treeRows, scoreRows);

  let rootPath = requestedRoot;
  let rootFound = true;
  const underRoot = (root: string) =>
    root === "" ? allFiles : allFiles.filter((f) => f.path === root || f.path.startsWith(`${root}/`));
  if (requestedRoot !== "" && underRoot(requestedRoot).length === 0) {
    rootFound = false;
    rootPath = "";
  }

  const scopedFiles = underRoot(rootPath);
  const rootSegs = segments(rootPath);

  // Breadth-first expansion: start at the immediate children of root (level 1)
  // and expand a whole level at a time, stopping BEFORE the level that would
  // push the visible node count past the budget. A subtree under budget
  // therefore renders entirely at file level.
  let k = 1;
  let cut = cutAtLevel(scopedFiles, rootSegs, k);
  while (cut.some((el) => el.type === "dir")) {
    const next = cutAtLevel(scopedFiles, rootSegs, k + 1);
    if (next.length > budget) break;
    k += 1;
    cut = next;
  }

  return {
    nodes: cut.map((el) => nodeFromCut(el, accepted)),
    headline: computeHeadline(scopedFiles),
    breadcrumbs: buildBreadcrumbs(rootPath),
    rootPath,
    rootFound,
  };
}

/** Lowest-scoring scored files (ghosts and unscored excluded), ascending,
 *  capped at `limit`. Repo-wide, independent of the current map root. */
export function riskiestScoredFiles(treeRows: TreeRow[], scoreRows: ScoreRow[], limit: number): MapNode[] {
  return joinRows(treeRows, scoreRows)
    .filter((f) => f.score !== null)
    // Score ascending, then a deterministic tie-break so noise files don't
    // outrank real code at an equal score: bigger file first (more code no one
    // understands = riskier), then path ascending as the final tie-break.
    .sort((a, b) => {
      const byScore = (a.score as number) - (b.score as number);
      if (byScore !== 0) return byScore;
      const bySize = b.size - a.size; // size descending
      if (bySize !== 0) return bySize;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; // path ascending
    })
    .slice(0, limit)
    .map((f) => ({
      kind: "file" as const,
      path: f.path,
      name: segments(f.path).at(-1) ?? f.path,
      sizeBytes: f.size,
      score: f.score,
      factors: f.factors,
      latestAuthorship: f.latestAuthorship,
    }));
}
