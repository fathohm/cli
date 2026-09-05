import { describe, expect, it } from "vitest";

import { scoreRepo, type RepoReading, type ScoredFile } from "../../cli/src/reading/scoring";
import {
  EMPTY,
  FIXTURE_NOW,
  MIXED,
  PROMPTED_ONLY,
  buildExtract,
  readingOf,
} from "../../cli/test-helpers/reading-fixtures";
import { DIVERGING } from "../../lib/palette";
import {
  TRUST_LINE,
  coveredLabelGloss,
  darkShareText,
  explainCommandLine,
  fileInReading,
  fileStatusColor,
  fileStatusText,
  fileTooltip,
  hasReading,
  relativeRepoPath,
  repoStatusColor,
  repoStatusText,
  repoTooltip,
} from "./status";

/**
 * The extension's words, pinned.
 *
 * Everything here runs on the same fixtures the CLI's goldens do, so a change
 * to the scorer moves these numbers exactly as it moves the card's — the tests
 * assert PROPERTIES of the rendering (the gloss opens every tooltip, the four
 * contributions add to the score, the display floors survive) rather than the
 * literals the scorer happens to produce today.
 */

const MIXED_READING = readingOf(MIXED).reading;
const EXACT_READING = readingOf(PROMPTED_ONLY).reading;
const EMPTY_READING = readingOf(EMPTY).reading;

/** A reading that exists only to carry two byte counts — the display-floor
 *  cases live in ranges no fixture repository happens to land in. */
function shareReading(darkBytes: number, scoredBytes: number): RepoReading {
  return { ...MIXED_READING, darkBytes, scoredBytes };
}

function fileNamed(reading: RepoReading, path: string): ScoredFile {
  const file = fileInReading(reading, path);
  if (file === null) throw new Error(`fixture has no ${path}`);
  return file;
}

describe("the workspace item", () => {
  it("names the tool and prints the dark share, with the word that says which way is bad", () => {
    expect(repoStatusText(MIXED_READING)).toMatch(/^fathohm \d+% dark$/);
    expect(repoStatusText(MIXED_READING)).toBe(`fathohm ${darkShareText(MIXED_READING)} dark`);
  });

  it("reads the SAME number the CLI card draws large, not a second derivation", () => {
    // The card divides `darkBytes` by `scoredBytes`. If this ever stopped being
    // the same division, the terminal and the status bar would be two readings
    // of one repository — the exact defect this change was made to close.
    const reading = shareReading(37, 100);
    expect(darkShareText(reading)).toBe("37%");
    expect(repoStatusText(reading)).toBe("fathohm 37% dark");
  });

  it("never rounds a real finding away to 0%", () => {
    // 0.4% of a large codebase is thousands of lines no human has been near.
    expect(darkShareText(shareReading(4, 1000))).toBe("<1%");
    expect(repoStatusText(shareReading(4, 1000))).toBe("fathohm <1% dark");
  });

  it("never rounds up into a codebase nobody has touched any of", () => {
    expect(darkShareText(shareReading(996, 1000))).toBe(">99%");
    expect(repoStatusText(shareReading(996, 1000))).toBe("fathohm >99% dark");
  });

  it("keeps the two absolutes when they are true", () => {
    expect(darkShareText(shareReading(0, 1000))).toBe("0%");
    expect(darkShareText(shareReading(1000, 1000))).toBe("100%");
  });

  it("colours off the public ramp, deep end first", () => {
    const deep = repoStatusColor(shareReading(900, 1000));
    const shallow = repoStatusColor(shareReading(100, 1000));
    expect(DIVERGING).toContain(deep);
    expect(DIVERGING).toContain(shallow);
    // DIVERGING[0] is the red pole. A deeper repo sits before a shallower one
    // on the ramp, never after it.
    const ramp = DIVERGING as readonly string[];
    expect(ramp.indexOf(deep)).toBeLessThan(ramp.indexOf(shallow));
  });

  it("has nothing to show for a repository with no commits", () => {
    expect(hasReading(EMPTY_READING)).toBe(false);
    expect(hasReading(MIXED_READING)).toBe(true);
  });
});

describe("the active-file chip", () => {
  it("reports a STATE, never a score — a file has no share of itself", () => {
    const file = fileNamed(MIXED_READING, "components/Map.tsx");
    const text = fileStatusText(MIXED_READING, file);
    expect(text).toMatch(/^this file · (lit|dark)/);
    // The old chip printed a comprehension-debt score beside a headline that no
    // longer reports one. Two measurements in adjacent items, nothing saying so.
    expect(text).not.toMatch(/\d\.\d\d/);
    expect(DIVERGING).toContain(fileStatusColor(file));
  });

  it("names its own two poles and nothing between them", () => {
    const poles = new Set(
      MIXED_READING.files.map((f) => fileStatusColor(f)),
    );
    expect(poles.size).toBeLessThanOrEqual(2);
    for (const colour of poles) expect(DIVERGING).toContain(colour);
  });

  it("says so rather than printing an age it does not have", () => {
    const never = MIXED_READING.files.find(
      (f) =>
        f.factors.engagement.last_hand_authored === null &&
        f.factors.engagement.last_prompted === null,
    );
    if (never === undefined) return; // the fixture has no such file today
    expect(fileStatusText(MIXED_READING, never)).toBe("this file · dark, no human contact");
  });

  it("hides for a path this reading never scored", () => {
    // README.md is in the fixture tree and out of the denominator: prose is
    // not code, so there is no score to put beside it.
    expect(fileInReading(MIXED_READING, "README.md")).toBeNull();
    expect(fileInReading(MIXED_READING, "does/not/exist.ts")).toBeNull();
  });

  it("matches paths exactly, case included", () => {
    expect(fileInReading(MIXED_READING, "components/map.tsx")).toBeNull();
    expect(fileInReading(MIXED_READING, "components/Map.tsx")).not.toBeNull();
  });
});

describe("the workspace-relative path", () => {
  it("takes the remainder under the folder", () => {
    expect(relativeRepoPath("/w/repo", "/w/repo/cli/src/index.ts")).toBe("cli/src/index.ts");
  });

  it("tolerates a trailing separator on the folder", () => {
    expect(relativeRepoPath("/w/repo/", "/w/repo/a.ts")).toBe("a.ts");
  });

  it("speaks git's separator on Windows", () => {
    expect(relativeRepoPath("C:\\w\\repo", "C:\\w\\repo\\cli\\src\\index.ts")).toBe(
      "cli/src/index.ts",
    );
  });

  it("refuses anything that is not under the folder", () => {
    expect(relativeRepoPath("/w/repo", "/w/other/a.ts")).toBeNull();
    expect(relativeRepoPath("/w/repo", "/w/repo-two/a.ts")).toBeNull();
    expect(relativeRepoPath("/w/repo", "/w/repo")).toBeNull();
  });
});

describe("the covered label", () => {
  it("says what the number is, over what window, and what kind of evidence it rests on", () => {
    expect(coveredLabelGloss("59%")).toBe(
      "59% of this code: no human wrote or prompted it in the last 180 days " +
        "— measured from the record, not a survey.",
    );
  });

  it("carries no metaphor of its own — plain sentence first, the label wears the word", () => {
    const gloss = coveredLabelGloss("59%");
    expect(gloss).not.toMatch(/\bdark\b/i);
    expect(gloss).not.toMatch(/\b(un)?fathomed\b/i);
    // And the label it glosses does wear it, so the pair is the whole rule.
    expect(repoStatusText(MIXED_READING)).toMatch(/\bdark\b/);
  });

  it("names the window rather than hiding it behind \"recently\"", () => {
    // Without a window a reader hears "no human EVER wrote it", which is far
    // bigger and false. The CLI title carries the same correction.
    expect(coveredLabelGloss("59%")).toContain("in the last 180 days");
  });

  it("opens both tooltips, before any arithmetic", () => {
    expect(repoTooltip(MIXED_READING, "repo")[0]).toBe(
      coveredLabelGloss(darkShareText(MIXED_READING)),
    );
    expect(fileTooltip(MIXED_READING, fileNamed(MIXED_READING, "app/page.tsx"))[0]).toBe(
      coveredLabelGloss(darkShareText(MIXED_READING)),
    );
  });

  it("makes no claim about what is in anybody's head", () => {
    const text = [
      ...repoTooltip(MIXED_READING, "repo"),
      ...fileTooltip(MIXED_READING, fileNamed(MIXED_READING, "app/page.tsx")),
    ].join("\n");
    expect(text).not.toMatch(/understand/i);
  });
});

describe("the workspace tooltip", () => {
  it("says the number has no range, because git settles authorship exactly", () => {
    const text = repoTooltip(MIXED_READING, "repo").join("\n");
    expect(text).toContain("no range in it");
    // The old tooltip carried an interval because the old headline had one.
    expect(text).not.toContain("Worst case");
    expect(text).not.toContain("Best case");
  });

  it("refuses the half of the story git cannot see, rather than staying silent", () => {
    // A reader handed an exact percentage assumes it is the whole story. It is
    // exactly half of one: git records authorship and keeps no review record.
    const text = repoTooltip(MIXED_READING, "repo").join("\n");
    expect(text).toContain("no review record");
    expect(text).toMatch(/read closely last week/i);
  });

  it("says the same thing for a reading with no PR mediation in it at all", () => {
    // There is no longer an "exact" special case to fork on — the dark share is
    // exact for every reading, so this tooltip must not vary by PR mediation.
    const text = repoTooltip(EXACT_READING, "repo").join("\n");
    expect(text).toContain("no range in it");
    expect(text).toContain("no review record");
  });

  it("names the denominator it divided by", () => {
    expect(repoTooltip(MIXED_READING, "acme-api").join("\n")).toContain(
      `${MIXED_READING.files.length} code files in \`acme-api\``,
    );
  });

  it("ends on the trust line", () => {
    const blocks = repoTooltip(MIXED_READING, "repo");
    expect(blocks[blocks.length - 1]).toBe(`_${TRUST_LINE}_`);
  });
});

describe("the file tooltip", () => {
  const file = fileNamed(MIXED_READING, "app/page.tsx");
  const blocks = fileTooltip(MIXED_READING, file);
  const text = blocks.join("\n");

  it("scopes the repo share before printing the file's own numbers", () => {
    expect(blocks[1]).toBe("That share is the whole repository. This file:");
  });

  it("names the file and says which of the four states it is in", () => {
    expect(text).toContain("`app/page.tsx`");
    expect(text).toMatch(/gone dark —|a human wrote or prompted it inside the last 180 days/);
  });

  it("shows no score at all, so there is no undecomposed number on the surface", () => {
    // The bright line asks that a score shown be decomposable. The extension
    // answers it by showing no score: the state it reports is fully evidenced
    // by the two contact dates and the window, both printed here. A four-factor
    // decomposition of a comprehension-debt number the headline no longer
    // reports would invite the reader to treat it as the reading.
    expect(text).not.toMatch(/\bscore \d\.\d{3}/);
    expect(text).not.toContain("human review depth");
    expect(text).not.toContain("question answerability");
    expect(text).not.toMatch(/→ \d\.\d{3}/);
  });

  it("evidences the state it does report, with dates and the window", () => {
    expect(text).toContain("180 days");
    expect(text).toContain("last hand-written: ");
  });

  it("covers every state the partition has, and never a remainder", () => {
    const seen = new Set(
      MIXED_READING.files.map((f) => {
        const clause = fileTooltip(MIXED_READING, f)[2];
        return clause.slice(clause.indexOf("— ") + 2);
      }),
    );
    // Whatever the fixture contains, no file may fall through to an empty or
    // undefined clause — "not any of the above" is a remainder, not a state.
    for (const clause of seen) expect(clause.length).toBeGreaterThan(10);
  });

  it("carries this file's two contacts, in the reading's own voice", () => {
    expect(text).toContain("last hand-written: ");
    expect(text).toContain("last prompted: ");
  });

  it("scores nobody: no person is named anywhere in it", () => {
    expect(text).not.toContain("Ada");
    expect(text).not.toContain("Grace");
    expect(text).not.toContain("example.dev");
  });

  it("points at the command that prints the same reading in full", () => {
    expect(text).toContain("**Fathohm: Explain This File**");
  });

  it("ends on the trust line", () => {
    expect(blocks[blocks.length - 1]).toBe(`_${TRUST_LINE}_`);
  });

  it("reads the injected clock and never a wall clock", () => {
    // The SAME history, scored a year later. Every age in the tooltip has to
    // move, which it cannot do if anything in here asked the machine what time
    // it is instead of reading the clock the reading was built with.
    const extract = buildExtract(MIXED);
    const later = scoreRepo(extract, {
      now: new Date(FIXTURE_NOW.getTime() + 365 * 24 * 60 * 60 * 1000),
      without: [],
    });
    expect(fileTooltip(later, fileNamed(later, "app/page.tsx")).join("\n")).not.toBe(text);
    expect(MIXED_READING.now).toEqual(FIXTURE_NOW);
  });
});

describe("the explain command", () => {
  it("shells out to the real CLI, so the card and the chip cannot disagree", () => {
    expect(explainCommandLine("cli/src/index.ts", false)).toBe(
      "npx fathohm explain 'cli/src/index.ts'",
    );
  });

  it("quotes a path with a space", () => {
    expect(explainCommandLine("my app/main.ts", false)).toBe(
      "npx fathohm explain 'my app/main.ts'",
    );
    expect(explainCommandLine("my app/main.ts", true)).toBe('npx fathohm explain "my app/main.ts"');
  });

  it("escapes the quote character of the shell it is writing for", () => {
    expect(explainCommandLine("it's.ts", false)).toBe("npx fathohm explain 'it'\\''s.ts'");
    expect(explainCommandLine('od"d.ts', true)).toBe('npx fathohm explain "od""d.ts"');
  });
});
