import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGENT_ONLY,
  EMPTY,
  FIXTURE_NOW,
  HANDOVER,
  MANY_CROSSINGS,
  MIXED,
  NON_CODE,
  PROMPTED_DOMINANT,
  PROMPTED_ONLY,
  SHALLOW,
  SQUASH_ONLY,
  TINY_LADDER,
  offboardOf,
  paydownOf,
  readingOf,
  teamOf,
  type ExtractFixture,
} from "../../test-helpers/reading-fixtures";
import { evaluateCheck } from "../reading/check";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import { renderCard } from "./card";
import { renderCheck, renderCheckMarkdown } from "./check";
import { renderExplain, selectFile } from "./explain";
import { crossingFiles, renderFade } from "./fade";
import { renderMapPage } from "./html-map";
import {
  checkDocument,
  explainDocument,
  fadeDocument,
  offboardDocument,
  paydownDocument,
  readDocument,
  serializeJson,
  teamDocument,
} from "./json";
import type { RenderMeta } from "./meta";
import { renderOffboard } from "./offboard";
import { renderPaydown } from "./paydown";
import { renderTeam } from "./team";

/**
 * GOLDEN FILES — the card, byte for byte.
 *
 * The spec's determinism contract is that (repo state, `--now`, flags) produce
 * byte-identical stdout, and a card is the product's most public artefact: it
 * is the thing people screenshot. So these compare BYTES, not shapes. A
 * reordered section, a changed word, a column that moved by one space and a
 * score that shifted in the fourth decimal all fail here, which is the point —
 * every one of those is a change somebody should have to look at.
 *
 * Everything is pinned: `--now` (2026-07-31), `--no-color`, `--ascii`,
 * `COLUMNS=80`. One case pins the coloured form instead (`FORCE_COLOR=1`,
 * unicode), because ANSI is the half of the output the plain goldens can never
 * see, and a broken escape sequence is invisible until it is on a terminal.
 *
 * ── REGENERATING ────────────────────────────────────────────────────────────
 *
 *     UPDATE_GOLDEN=1 npx vitest run cli/src/render
 *
 * and then READ THE DIFF. That is the whole workflow, and the reason it is one
 * explicit environment variable rather than a flag on the runner: a golden
 * file that regenerates as a side effect of running the tests is a golden file
 * that pins nothing. The numbers in these files come out of the scorer, so a
 * diff in them is either the scorer moving (which is news the dashboard shares)
 * or the CLI having stopped running it.
 */

const GOLDEN_DIR = path.join(process.cwd(), "cli", "src", "render", "__golden__");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

function plainTerm(): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
}

function colorTerm(): Term {
  return createTerm({ env: { FORCE_COLOR: "1" }, isTTY: false, columns: 80 });
}

/**
 * The same card, picked for a WHITE terminal.
 *
 * The light table is shipped code that nothing compared byte-for-byte until
 * this existed, and it is the table the founder's own terminal draws with —
 * exactly the half of the product least likely to be looked at by whoever is
 * changing the palette. `--light` rather than a `COLORFGBG` string, because the
 * flag is the path a reader takes and the env var is covered in `term.test.ts`.
 */
function lightTerm(): Term {
  return createTerm({ ground: "light", env: { FORCE_COLOR: "1" }, isTTY: false, columns: 80 });
}

function meta(target: string, overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target,
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

function card(
  fixture: ExtractFixture,
  target: string,
  options: {
    term?: Term;
    meta?: Partial<RenderMeta>;
    without?: readonly string[];
    scope?: string | null;
  } = {},
): string[] {
  const { reading, tide } = readingOf(fixture, {
    without: options.without,
    scope: options.scope,
  });
  const overrides = options.meta ?? {};
  const term = options.term ?? plainTerm();
  return renderCard(
    reading,
    overrides.quiet === true ? null : tide,
    term,
    meta(target, overrides),
  );
}

function check(
  fixture: ExtractFixture,
  target: string,
  options: { maxBlind: number; pessimistic: boolean },
): string[] {
  const { reading } = readingOf(fixture);
  return renderCheck(reading, evaluateCheck(reading, options), plainTerm(), meta(target));
}

function offboard(
  fixture: ExtractFixture,
  query: string,
  target: string,
  options: { term?: Term; meta?: Partial<RenderMeta>; without?: readonly string[] } = {},
): string[] {
  const overrides = options.meta ?? {};
  return renderOffboard(
    offboardOf(fixture, query, { full: overrides.full === true, without: options.without }),
    options.term ?? plainTerm(),
    meta(target, overrides),
  );
}

/** The gate flags are part of the reading here, not of the rendering: they
 *  decide whether the card has a gate line at all. */
interface PaydownOptions {
  term?: Term;
  meta?: Partial<RenderMeta>;
  without?: readonly string[];
  maxBlind?: number;
  pessimistic?: boolean;
}

function paydown(
  fixture: ExtractFixture,
  target: string,
  options: PaydownOptions = {},
): string[] {
  const overrides = options.meta ?? {};
  return renderPaydown(
    paydownOf(fixture, {
      full: overrides.full === true,
      without: options.without,
      maxBlind: options.maxBlind ?? null,
      pessimistic: options.pessimistic ?? false,
    }),
    options.term ?? plainTerm(),
    meta(target, overrides),
  );
}

function team(
  fixture: ExtractFixture,
  target: string,
  options: { term?: Term; meta?: Partial<RenderMeta> } = {},
): string[] {
  const overrides = options.meta ?? {};
  return renderTeam(
    teamOf(fixture, { full: overrides.full === true }),
    options.term ?? plainTerm(),
    meta(target, overrides),
  );
}

const CASES: ReadonlyArray<{ name: string; lines: () => string[] }> = [
  { name: "card-mixed", lines: () => card(MIXED, "acme-api") },
  { name: "card-prompted-dominant", lines: () => card(PROMPTED_DOMINANT, "acme-jobs") },
  { name: "card-prompted-only", lines: () => card(PROMPTED_ONLY, "prompted-only") },
  { name: "card-empty", lines: () => card(EMPTY, "fresh-repo") },
  { name: "card-non-code", lines: () => card(NON_CODE, "assets-only") },
  { name: "card-shallow", lines: () => card(SHALLOW, "acme-api") },
  { name: "card-squash-only", lines: () => card(SQUASH_ONLY, "squashed") },
  {
    name: "card-quiet",
    lines: () => card(MIXED, "acme-api", { meta: { quiet: true } }),
  },
  {
    name: "card-full",
    lines: () => card(MIXED, "acme-api", { meta: { full: true } }),
  },
  {
    // A SUBTREE READING, pinned whole. Every number on this card is about
    // `lib/` and none of them is the repository's, which is the one shape of
    // output here that can be true and misleading at once — so what is pinned
    // is not the arithmetic but the SAYING SO: the header names the subtree,
    // the sentence under it names the denominator, and both are bytes a diff
    // would show somebody removing.
    name: "card-scoped",
    lines: () =>
      card(MIXED, "acme-api/lib", { scope: "lib" }),
  },
  {
    name: "card-color",
    lines: () => card(MIXED, "acme-api", { term: colorTerm() }),
  },
  {
    name: "card-color-light",
    lines: () => card(MIXED, "acme-api", { term: lightTerm() }),
  },
  {
    name: "explain-above",
    lines: () => {
      const { reading } = readingOf(MIXED);
      const file = selectFile(reading, "workers/src/scorer.ts");
      return renderExplain(reading, file, plainTerm(), meta("acme-api"));
    },
  },
  {
    // The painted twin of `explain-above`. Every other card that carries ink has
    // one; `explain` did not, so the score line, the factor heads and the
    // header's own path were the only painted surface in the CLI that nothing
    // compared byte-for-byte.
    name: "explain-color",
    lines: () => {
      const { reading } = readingOf(MIXED);
      const file = selectFile(reading, "workers/src/scorer.ts");
      return renderExplain(reading, file, colorTerm(), meta("acme-api"));
    },
  },
  {
    name: "explain-prompted",
    lines: () => {
      const { reading } = readingOf(PROMPTED_DOMINANT);
      const file = selectFile(reading, "src/agents/router.ts");
      return renderExplain(reading, file, plainTerm(), meta("acme-jobs"));
    },
  },
  {
    name: "fade-mixed",
    lines: () => {
      const { reading } = readingOf(MIXED);
      return renderFade(reading, plainTerm(), meta("acme-api"));
    },
  },
  {
    name: "fade-nothing-holds",
    lines: () => {
      const { reading } = readingOf(PROMPTED_ONLY);
      return renderFade(reading, plainTerm(), meta("prompted-only"));
    },
  },
  {
    // Twenty-six crossings against a twenty-row table: the cut, and the line
    // that says where the rest of them are.
    name: "fade-capped",
    lines: () => {
      const { reading } = readingOf(MANY_CROSSINGS);
      return renderFade(reading, plainTerm(), meta("many-crossings"));
    },
  },
  {
    name: "check-pass",
    lines: () => check(MIXED, "acme-api", { maxBlind: 90, pessimistic: false }),
  },
  {
    name: "check-fail",
    lines: () => check(MIXED, "acme-api", { maxBlind: 5, pessimistic: false }),
  },
  {
    // The same repository and the same limit, gated on the floor instead: the
    // flip is the whole argument for the interval, so it gets its own golden.
    name: "check-pessimistic",
    lines: () => check(MIXED, "acme-api", { maxBlind: 40, pessimistic: true }),
  },
  {
    name: "check-indeterminate",
    lines: () => check(SHALLOW, "acme-api", { maxBlind: 5, pessimistic: false }),
  },
  {
    name: "check-nothing-to-gate",
    lines: () => check(NON_CODE, "assets-only", { maxBlind: 0, pessimistic: false }),
  },
  // ── offboard ──────────────────────────────────────────────────────────────
  // Every clause the handover lexicon has, on one fixture: two files where
  // priya is the only name, one where removing her moves the newest contact
  // back, two where it only costs a name, and a sixth that the cut defers.
  { name: "offboard-priya", lines: () => offboard(HANDOVER, "priya", "acme-api") },
  {
    name: "offboard-full",
    lines: () => offboard(HANDOVER, "priya", "acme-api", { meta: { full: true } }),
  },
  {
    // The failure mode a bus-factor simulation has to be incapable of: a name
    // that matched nobody, coming back as an unchanged reading that reads like
    // good news.
    name: "offboard-nobody",
    lines: () => offboard(HANDOVER, "pryia", "acme-api"),
  },
  {
    // The only human in the history. "100% of this has one name on it" is
    // arithmetically true and reads as an accusation, so the card says the
    // other thing instead.
    name: "offboard-solo",
    lines: () => offboard(PROMPTED_ONLY, "Ada Lovelace", "prompted-only"),
  },
  {
    name: "offboard-color",
    lines: () => offboard(HANDOVER, "priya", "acme-api", { term: colorTerm() }),
  },
  {
    name: "offboard-color-light",
    lines: () => offboard(HANDOVER, "priya", "acme-api", { term: lightTerm() }),
  },
  {
    // The composed simulation: a `--without` baseline under the offboard
    // query. The baseline is named in the header, "today" never describes the
    // baseline-stripped reading, and every history clause carries "remaining".
    name: "offboard-baseline",
    lines: () => offboard(HANDOVER, "priya", "acme-api", { without: ["sam"] }),
  },
  // ── team ──────────────────────────────────────────────────────────────────
  { name: "team-acme", lines: () => team(HANDOVER, "acme-api") },
  { name: "team-color", lines: () => team(HANDOVER, "acme-api", { term: colorTerm() }) },
  { name: "team-color-light", lines: () => team(HANDOVER, "acme-api", { term: lightTerm() }) },
  {
    // One human: the table renders honestly rather than suppressing itself, and
    // the leave row is the whole repository going.
    name: "team-solo",
    lines: () => team(PROMPTED_ONLY, "prompted-only"),
  },
  {
    // Nobody to remove. The section says so in one line rather than printing an
    // empty table under a heading.
    name: "team-agent-only",
    lines: () => team(AGENT_ONLY, "agent-only"),
  },
  // ── paydown ───────────────────────────────────────────────────────────────
  { name: "paydown-mixed", lines: () => paydown(MIXED, "acme-api") },
  {
    name: "paydown-full",
    lines: () => paydown(PROMPTED_DOMINANT, "acme-jobs", { meta: { full: true } }),
  },
  {
    name: "paydown-color",
    lines: () => paydown(MIXED, "acme-api", { term: colorTerm() }),
  },
  {
    name: "paydown-quiet",
    lines: () => paydown(MIXED, "acme-api", { meta: { quiet: true } }),
  },
  {
    // The reader's own gate, in the form that names a rung: the limit fails on
    // this reading and passes further down the ladder, and the command printed
    // beside it is the exact invocation that answers it.
    name: "paydown-gate",
    lines: () => paydown(PROMPTED_DOMINANT, "acme-jobs", { maxBlind: 40 }),
  },
  {
    // The composed ladder: a `--without` baseline under it. The baseline is
    // named in the header and travels into every command the card prints.
    name: "paydown-baseline",
    lines: () =>
      paydown(HANDOVER, "acme-api", {
        without: ["sam"],
        maxBlind: 40,
        pessimistic: true,
      }),
  },
  {
    // A ladder whose ten rungs are a thousand bytes against two megabytes: the
    // printed share never moves, so there is no ladder — one sentence instead,
    // and it declines the whole-card claim because the gate line moves.
    name: "paydown-still",
    lines: () => paydown(TINY_LADDER, "wide-repo", { maxBlind: 50 }),
  },
  // Nothing to fathom, on all three. A repository with no commits has no share
  // to print, no people to print it about and no ladder to climb, and the cards
  // must reach the same three sentences the reading card reaches rather than
  // dividing by zero in their own way.
  { name: "offboard-empty", lines: () => offboard(EMPTY, "priya", "fresh-repo") },
  { name: "team-empty", lines: () => team(EMPTY, "fresh-repo") },
  { name: "paydown-empty", lines: () => paydown(EMPTY, "fresh-repo") },
];

/**
 * The written artefacts, byte for byte: one JSON document per command, and the
 * HTML map. Same pinned clock, same fixtures — a diff here is the scorer
 * moving, the schema moving, or a bug.
 */
const FILE_CASES: ReadonlyArray<{
  name: string;
  extension?: string;
  text: () => string;
}> = [
  {
    // THE PASTEABLE VERDICT, byte for byte. It is a written artefact like the
    // map: it leaves the terminal, gets kept, and is read by people who never
    // ran the command — so its copy is pinned rather than reviewed. The FAIL
    // case, because that is the one somebody has to defend.
    name: "check-markdown",
    extension: "md",
    text: () => {
      const { reading } = readingOf(MIXED);
      // A limit MIXED misses, so this golden is the branch somebody has to
      // defend at five o'clock rather than the one nobody reads.
      const verdict = evaluateCheck(reading, { maxBlind: 10, pessimistic: false });
      return renderCheckMarkdown(reading, verdict, meta("acme-api")).join("\n");
    },
  },
  {
    // …and the boring one. A gate that passes is the reading most people get,
    // and the shape a renderer written against the dramatic case degrades
    // badly on — here with the floor gated, so the `--pessimistic` bound
    // travels into the reproduction command too.
    name: "check-markdown-pass",
    extension: "md",
    text: () => {
      const { reading } = readingOf(PROMPTED_ONLY);
      const verdict = evaluateCheck(reading, { maxBlind: 100, pessimistic: true });
      return renderCheckMarkdown(reading, verdict, meta("prompted-only")).join("\n");
    },
  },
  {
    // No verdict at all: the fragment case, where the markdown must refuse in
    // the same words the terminal refuses in and print no share anywhere.
    name: "check-markdown-shallow",
    extension: "md",
    text: () => {
      const { reading } = readingOf(SHALLOW);
      const verdict = evaluateCheck(reading, { maxBlind: 40, pessimistic: false });
      return renderCheckMarkdown(reading, verdict, meta("acme-api")).join("\n");
    },
  },
  {
    name: "json-read",
    text: () => {
      const { reading, tide } = readingOf(MIXED);
      return serializeJson(readDocument({ reading, meta: meta("acme-api") }, tide));
    },
  },
  {
    name: "json-explain",
    text: () => {
      const { reading } = readingOf(PROMPTED_DOMINANT);
      const file = selectFile(reading, "src/agents/router.ts");
      return serializeJson(explainDocument({ reading, meta: meta("acme-jobs") }, file));
    },
  },
  {
    name: "json-fade",
    text: () => {
      const { reading } = readingOf(MIXED);
      return serializeJson(
        fadeDocument({ reading, meta: meta("acme-api") }, crossingFiles(reading)),
      );
    },
  },
  {
    name: "json-check",
    text: () => {
      const { reading } = readingOf(MIXED);
      const verdict = evaluateCheck(reading, { maxBlind: 40, pessimistic: false });
      return serializeJson(checkDocument({ reading, meta: meta("acme-api") }, verdict));
    },
  },
  {
    name: "json-offboard",
    text: () => {
      const off = offboardOf(HANDOVER, "priya");
      return serializeJson(
        offboardDocument({ reading: off.before, meta: meta("acme-api") }, off),
      );
    },
  },
  {
    name: "json-team",
    text: () => {
      const roster = teamOf(HANDOVER);
      return serializeJson(
        teamDocument({ reading: roster.reading, meta: meta("acme-api") }, roster),
      );
    },
  },
  {
    name: "json-paydown",
    text: () => {
      const ladder = paydownOf(MIXED, { maxBlind: 40 });
      return serializeJson(
        paydownDocument({ reading: ladder.reading, meta: meta("acme-api") }, ladder),
      );
    },
  },
  {
    name: "json-map",
    text: () => {
      const { reading, tide } = readingOf(MIXED);
      return serializeJson(
        readDocument({ reading, meta: meta("acme-api") }, tide, {
          command: "map",
          // What `index.ts` passes: `relativeMapTarget`'s output, never the
          // absolute path the write used.
          out: "fathohm-map.html",
        }),
      );
    },
  },
  {
    // A written file is the artefact people keep and send on, so its bytes are
    // pinned like the card's: a stray attribute or a moved rectangle is a
    // change somebody should have to look at.
    name: "map",
    extension: "html",
    text: () => {
      const { reading } = readingOf(MIXED);
      return renderMapPage(reading, meta("acme-api"));
    },
  },
];

/** Compare, or (under `UPDATE_GOLDEN=1`) rewrite. One place, both kinds. */
function pin(name: string, extension: string, actual: string): void {
  const file = path.join(GOLDEN_DIR, `${name}.${extension}`);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, actual, "utf8");
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

describe("golden files", () => {
  for (const testCase of CASES) {
    it(`${testCase.name} renders byte-for-byte`, () => {
      pin(testCase.name, "txt", `${testCase.lines().join("\n")}\n`);
    });
  }

  for (const testCase of FILE_CASES) {
    it(`${testCase.name} serialises byte-for-byte`, () => {
      const text = testCase.text();
      pin(testCase.name, testCase.extension ?? "json", text.endsWith("\n") ? text : `${text}\n`);
    });
  }

  it("renders the same bytes twice — no clock, no ordering luck", () => {
    for (const testCase of CASES) {
      expect(testCase.lines().join("\n")).toBe(testCase.lines().join("\n"));
    }
    for (const testCase of FILE_CASES) {
      expect(testCase.text()).toBe(testCase.text());
    }
  });

  it("pins the clock it was rendered at, on every command", () => {
    const stamp = FIXTURE_NOW.toISOString().replace(/\.\d{3}Z$/, "Z");
    for (const testCase of CASES) {
      expect(testCase.lines()[0] + testCase.lines()[1]).toContain(stamp);
    }
  });
});
