/**
 * The glob subset `.fathohm.toml`'s `exclude` speaks — three rules, hand-rolled,
 * zero dependencies.
 *
 *   `*`   matches any run of characters WITHIN one path segment (never `/`)
 *   `**`  matches zero or more whole segments
 *   everything else is literal
 *
 * Zero-or-more is what makes `a/**` name the tree under `a`, and what lets a
 * cross-segment wildcard in the middle of a pattern still match a path with
 * nothing in that position — one rule, with no trailing-star exception.
 *
 * That is the entire language, and the shortness is the point. A glob library
 * would bring brace expansion, extglobs, negation, dotfile rules and
 * case-sensitivity flags — every one of which changes which files land in the
 * reading's denominator, and none of which anybody could predict from looking
 * at their own config file. A denominator nobody can predict is not a
 * denominator; it is a number with an asterisk.
 *
 * Matching is anchored at both ends: a pattern describes a whole path, so
 * `lib` excludes the file `lib` and nothing else, while `lib/**` excludes
 * everything under it. Anchoring is what keeps `exclude = ["dist"]` from
 * quietly deleting `src/dist-helper.ts` from the reading.
 *
 * Case-SENSITIVE, always: git paths are bytes, and a matcher that folded case
 * would exclude different files on a Mac than in CI, from the same config.
 */

/** Whether one pattern matches one repo-relative path. */
export function matchGlob(pattern: string, path: string): boolean {
  const patternSegments = normalize(pattern).split("/");
  const pathSegments = normalize(path).split("/");
  return matchFrom(patternSegments, pathSegments, 0, 0);
}

/**
 * The patterns compiled into one predicate.
 *
 * An empty list returns a predicate that is false for everything — not a
 * predicate that is absent. The callers apply this at the denominator seam
 * beside `isCodeFile`, and a branch there for "is anything excluded?" is a
 * second code path through the one place the product cannot afford two.
 */
export function excludeMatcher(patterns: readonly string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const compiled = patterns.map((pattern) => normalize(pattern).split("/"));
  return (path: string) => {
    const segments = normalize(path).split("/");
    return compiled.some((pattern) => matchFrom(pattern, segments, 0, 0));
  };
}

/** `./x` and `x/` and `x` all name the same thing to a person writing config. */
function normalize(value: string): string {
  return value.replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Segment-wise match with backtracking on `**`.
 *
 * Recursive rather than iterative because `**` is the only thing that branches
 * and patterns are a handful of segments long — the exponential worst case
 * needs a pattern carrying several cross-segment wildcards matched against a
 * deep path, which is a config file nobody writes and which still finishes
 * instantly at these sizes.
 */
function matchFrom(
  pattern: readonly string[],
  path: readonly string[],
  patternIndex: number,
  pathIndex: number,
): boolean {
  if (patternIndex === pattern.length) return pathIndex === path.length;

  if (pattern[patternIndex] === "**") {
    // Zero segments first, so `a/**/b` matches `a/b` — the reading people
    // expect from every other tool that has this syntax.
    for (let skip = pathIndex; skip <= path.length; skip += 1) {
      if (matchFrom(pattern, path, patternIndex + 1, skip)) return true;
    }
    return false;
  }

  if (pathIndex === path.length) return false;
  if (!matchSegment(pattern[patternIndex], path[pathIndex])) return false;
  return matchFrom(pattern, path, patternIndex + 1, pathIndex + 1);
}

/**
 * One segment against one segment, where `*` matches any run of characters.
 *
 * The classic two-pointer wildcard match: remember where the last `*` was, and
 * on a mismatch give it one more character. Linear in practice, no regex —
 * building a regex would mean escaping every metacharacter a filename is
 * allowed to contain (`.`, `+`, `(`, `[`, `$`), and one missed escape turns a
 * literal path into a pattern that quietly matches more than it was given.
 */
function matchSegment(pattern: string, text: string): boolean {
  let patternIndex = 0;
  let textIndex = 0;
  let star = -1;
  let afterStar = 0;

  while (textIndex < text.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
      star = patternIndex;
      afterStar = textIndex;
      patternIndex += 1;
    } else if (patternIndex < pattern.length && pattern[patternIndex] === text[textIndex]) {
      patternIndex += 1;
      textIndex += 1;
    } else if (star !== -1) {
      patternIndex = star + 1;
      afterStar += 1;
      textIndex = afterStar;
    } else {
      return false;
    }
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}
