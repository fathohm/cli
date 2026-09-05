import { describe, expect, it } from "vitest";

import { formatBlindShare } from "../../../lib/blind-share-format";
import { explainReading } from "../../../lib/reading-explained";
import {
  EMPTY,
  MIXED,
  PROMPTED_DOMINANT,
  SHALLOW,
  offboardOf,
  paydownOf,
  readingOf,
  teamOf,
} from "../../test-helpers/reading-fixtures";
import { evaluateCheck } from "../reading/check";
import { CLI_VERSION, SCORER_VERSION } from "../version";
import { fileEntries } from "./entries";
import { crossingFiles } from "./fade";
import {
  checkDocument,
  explainDocument,
  fadeDocument,
  jsonDocumentSchema,
  offboardDocument,
  paydownDocument,
  readDocument,
  serializeJson,
  teamDocument,
  validateJson,
} from "./json";
import { ledgerOf } from "./ledger";
import type { RenderMeta } from "./meta";

/**
 * `--json`, as a contract rather than as a dump.
 *
 * The tests below are the four promises a pipeline is allowed to build on:
 * the document parses against its own published schema, its shares are floored
 * where they are rendered and exact where they are not, its sections are the
 * ones the command produced, and the same reading serialises to the same bytes
 * twice.
 */

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

function readInput(fixture = MIXED, exclude: readonly string[] = []) {
  const { reading, tide } = readingOf(fixture, { exclude });
  return { input: { reading, meta: meta("acme-api") }, tide, reading };
}

describe("the document parses against its own schema", () => {
  it("round-trips every command's output", () => {
    const { input, tide, reading } = readInput();
    const documents = [
      readDocument(input, tide),
      readDocument(input, tide, { command: "map", out: "/tmp/fathohm-map.html" }),
      explainDocument(input, reading.files[0]),
      fadeDocument(input, crossingFiles(reading)),
      checkDocument(input, evaluateCheck(reading, { maxBlind: 40, pessimistic: false })),
      // The two people-shaped documents, so "every command" stays every
      // command: a schema field one of them stopped carrying must fail HERE,
      // not first in the slower integration matrix.
      offboardDocument(input, offboardOf(MIXED, "Ada Lovelace")),
      teamDocument(input, teamOf(MIXED)),
      paydownDocument(input, paydownOf(MIXED)),
      paydownDocument(input, paydownOf(MIXED, { maxBlind: 40, pessimistic: true })),
    ];
    for (const document of documents) {
      const parsed = jsonDocumentSchema.parse(JSON.parse(serializeJson(document)));
      expect(parsed.fathohm).toEqual({
        cliVersion: CLI_VERSION,
        scorerVersion: SCORER_VERSION,
      });
    }
  });

  it("rejects a document with a key the schema does not know", () => {
    const { input, tide } = readInput();
    const rogue = { ...readDocument(input, tide), surprise: true };
    expect(() => validateJson(rogue as never)).toThrow();
  });
});

describe("every command carries the same spine", () => {
  const { input, tide, reading } = readInput();

  it("read: headline, buckets, files and the tide", () => {
    const document = readDocument(input, tide);
    expect(document.command).toBe("read");
    expect(document.files).toHaveLength(reading.files.length);
    expect(document.buckets?.length).toBeGreaterThan(0);
    expect(document.tide?.past).toHaveLength(tide.past.length);
    expect(document.verdict).toBeUndefined();
    expect(document.file).toBeUndefined();
  });

  it("explain: the one file, and no file list", () => {
    const document = explainDocument(input, reading.files[0]);
    expect(document.command).toBe("explain");
    expect(document.file?.path).toBe(reading.files[0].path);
    expect(document.files).toBeUndefined();
    // The reading's headline travels with it: a file's score means nothing
    // without the denominator it was measured against.
    expect(document.headline.scoredBytes).toBe(reading.scoredBytes);
  });

  it("fade: the FULL crossing set, past the table's twenty-row cap", () => {
    const document = fadeDocument(input, crossingFiles(reading));
    expect(document.command).toBe("fade");
    expect(document.crossings?.files).toHaveLength(crossingFiles(reading).length);
    expect(document.crossings?.horizonDays).toBe(90);
    for (const crossing of document.crossings?.files ?? []) {
      expect(crossing.fadesAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("check: the verdict, the headline and the provenance", () => {
    const verdict = evaluateCheck(reading, { maxBlind: 40, pessimistic: true });
    const document = checkDocument(input, verdict);
    expect(document.command).toBe("check");
    expect(document.verdict?.bound).toBe("floor");
    expect(document.verdict?.passed).toBe(verdict.passed);
    expect(document.files).toBeUndefined();
  });

  it("paydown: the ladder, both display strings, and the full path list", () => {
    const paydown = paydownOf(MIXED);
    const document = paydownDocument(input, paydown);
    expect(document.command).toBe("paydown");
    expect(document.paydown?.paths).toEqual(paydown.ladder.map((file) => file.path));
    expect(document.paydown?.rungs.map((rung) => rung.files)).toEqual(
      paydown.rungs.map((rung) => rung.files),
    );
    // Rendered beside raw, from day one: a consumer diffing a screenshot
    // against a pipeline needs the string the reader was actually shown.
    for (const rung of document.paydown?.rungs ?? []) {
      expect(rung.display.floor).toBe(formatBlindShare(rung.floor));
      expect(rung.display.ceiling).toBe(formatBlindShare(rung.ceiling));
    }
    expect(document.paydown?.liftable.display).toBe(
      formatBlindShare(paydown.liftable.share),
    );
    // No limit was set, so no gate is claimed.
    expect(document.paydown?.gate).toBeUndefined();
    expect(document.files).toBeUndefined();
  });

  it("paydown: the gate travels only when a limit was actually set", () => {
    const document = paydownDocument(input, paydownOf(MIXED, { maxBlind: 5 }));
    expect(document.paydown?.gate?.threshold).toBe(5);
    expect(document.paydown?.gate?.bound).toBe("ceiling");
    expect(document.paydown?.gate?.display.threshold).toBe("5%");
    expect(
      paydownDocument(input, paydownOf(MIXED, { maxBlind: 5, pessimistic: true })).paydown
        ?.gate?.bound,
    ).toBe("floor");
  });

  it("map: the whole reading, plus the file it wrote", () => {
    const document = readDocument(input, tide, { command: "map", out: "/tmp/x.html" });
    expect(document.command).toBe("map");
    expect(document.map?.out).toBe("/tmp/x.html");
    expect(document.files).toHaveLength(reading.files.length);
  });
});

describe("raw numbers and display strings, side by side", () => {
  it("the headline carries both, and the strings are the floored ones", () => {
    const { input, tide, reading } = readInput(PROMPTED_DOMINANT);
    const document = readDocument({ ...input, meta: meta("job-ai") }, tide);
    expect(document.headline.floor).toBeCloseTo(
      (reading.floorBlindBytes / reading.scoredBytes) * 100,
      10,
    );
    expect(document.headline.display.floor).toBe(formatBlindShare(document.headline.floor));
    expect(document.headline.display.ceiling).toBe(
      formatBlindShare(document.headline.ceiling),
    );
  });

  /**
   * THE HEADLINE FIELD, and until 2026-08-11 this whole file said nothing about
   * it. `dark` is the number the card prints at headline size from 1.5.0 — the
   * one a consumer will put on a dashboard — and the contract suite asserted
   * `floor` and `ceiling` (which are now the DEMOTED pair) while never once
   * naming it. A schema field with no test is a field that can be renamed,
   * rescaled or silently dropped by a green build.
   */
  it("the headline's dark share is a percent, from the reading's own bytes", () => {
    const { input, tide, reading } = readInput();
    const document = readDocument(input, tide);
    // NOT a recomputation of the predicate — the whole point of `darkBytes` is
    // that one place decides what dark means. This asserts the document did not
    // invent a second denominator, rescale, or round on the way out.
    expect(document.headline.darkBytes).toBe(reading.darkBytes);
    expect(document.headline.dark).toBeCloseTo(
      (reading.darkBytes / reading.scoredBytes) * 100,
      10,
    );
    expect(document.headline.dark).toBeGreaterThan(0);
    expect(document.headline.display.dark).toBe(formatBlindShare(document.headline.dark));
  });

  it("the dark share is a different reading from the debt interval", () => {
    // The release exists because these two numbers are NOT the same reading:
    // dark answers "who has left the building?", the interval answers "did
    // anyone read it?". A fixture where they coincide would let a consumer wire
    // `dark` to `floor` and stay green forever.
    const { input, tide } = readInput();
    const document = readDocument(input, tide);
    expect(document.headline.dark).not.toBeCloseTo(document.headline.floor, 6);
    expect(document.headline.dark).not.toBeCloseTo(document.headline.ceiling, 6);
  });

  it("every ledger group carries a dark reason, and the groups exhaust the dark bytes", () => {
    const { input, tide, reading } = readInput();
    const document = readDocument(input, tide);
    const groups = document.groups ?? [];
    expect(groups.length).toBeGreaterThan(0);
    // The lit coda is not a group: the groups partition what went dark.
    for (const group of groups) {
      expect(["faded-hand", "faded-prompted", "never"]).toContain(group.id);
    }
    // The groups partition the dark bytes exactly, so their exact shares sum to
    // the headline. `display` is the largest-remainder allocation and is NOT
    // summed here — that it adds to the printed headline is the ledger's own
    // guarantee, and asserting it twice in two units would hide which one broke.
    const total = groups.reduce((sum, group) => sum + group.share, 0);
    expect(total).toBeCloseTo(document.headline.dark, 6);
    expect(groups.reduce((sum, group) => sum + group.fileCount, 0)).toBe(
      reading.files.filter((file) => file.factors.human_author_recency === 0).length,
    );
  });

  /**
   * The floor rule, where it is easiest to lose: a share under one percent
   * must not render as "0%" anywhere, including in a machine document that a
   * dashboard will print verbatim.
   */
  it("never renders a nonzero share as zero", () => {
    const tiny = {
      tree: [
        ["src/big.ts", 1_000_000] as const,
        ["src/tiny.ts", 500] as const,
      ],
      commits: [
        { daysAgo: 1, paths: ["src/big.ts"] },
        { daysAgo: 900, paths: ["src/tiny.ts"] },
      ],
    };
    const { reading, tide } = readingOf(tiny);
    const document = readDocument({ reading, meta: meta("tiny") }, tide);
    expect(document.headline.floor).toBeGreaterThan(0);
    expect(document.headline.display.floor).toBe("<1%");
  });

  it("bucket shares are percents, and agree with the explainer", () => {
    const { input, tide, reading } = readInput();
    const document = readDocument(input, tide);
    const explained = explainReading(fileEntries(reading), reading.now);
    expect(document.buckets?.map((bucket) => bucket.id)).toEqual(
      explained.buckets.map((bucket) => bucket.id),
    );
    const total = (document.buckets ?? []).reduce((sum, bucket) => sum + bucket.share, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("groups carry what a reader was SHOWN, beside the buckets they came from", () => {
    // `buckets` is the partition as computed; `groups` is the ledger as
    // printed. A consumer diffing a screenshot against a pipeline needs the
    // second, and deriving it from the first is guesswork about a rounding rule.
    const { input, tide, reading } = readInput();
    const document = readDocument(input, tide);
    const ledger = ledgerOf(reading);

    expect(document.groups?.map((group) => group.id)).toEqual(
      ledger.groups.map((group) => group.group.id),
    );
    expect(document.groups?.map((group) => group.display)).toEqual(
      ledger.groups.map((group) => group.printed),
    );
    // The paths are the printed rows, not the whole bucket.
    expect(document.groups?.flatMap((group) => group.paths)).toEqual(
      ledger.rows.map((file) => file.path),
    );
    for (const group of document.groups ?? []) {
      expect(group.share).toBeGreaterThan(0);
      expect(group.share).toBeLessThanOrEqual(100);
    }
  });

  it("groups exclude the above-line bucket, and buckets do not", () => {
    const { input, tide } = readInput();
    const document = readDocument(input, tide);
    expect(document.buckets?.map((bucket) => bucket.id)).toContain("above");
    expect(document.groups?.map((group) => group.id)).not.toContain("above");
  });

  it("groups are absent from every command that is not a reading", () => {
    const { reading, input } = readInput();
    expect(explainDocument(input, reading.files[0]).groups).toBeUndefined();
  });

  it("a file's floor and ceiling are SCORES, not shares", () => {
    const { input, tide } = readInput();
    for (const file of readDocument(input, tide).files ?? []) {
      expect(file.floor).toBeGreaterThanOrEqual(0);
      expect(file.floor).toBeLessThanOrEqual(1);
      expect(file.ceiling).toBeGreaterThanOrEqual(file.floor);
    }
  });
});

describe("the provenance travels with the numbers", () => {
  it("carries the lower-bound caveat as a fact, not a footnote", () => {
    const { input, tide } = readInput();
    expect(readDocument(input, tide).provenance.agentShareIsLowerBound).toBe(true);
  });

  it("carries the truncation that makes a reading a fragment", () => {
    const { reading, tide } = readingOf(SHALLOW);
    const document = readDocument({ reading, meta: meta("acme-api") }, tide);
    expect(document.provenance.shallow).toBe(true);
    const verdict = evaluateCheck(reading, { maxBlind: 40, pessimistic: false });
    expect(checkDocument({ reading, meta: meta("acme-api") }, verdict).verdict?.indeterminate).toBe(
      true,
    );
  });

  it("carries what the config excluded", () => {
    const { input, tide } = readInput(MIXED, ["app/**"]);
    const document = readDocument(input, tide);
    expect(document.provenance.excluded.patterns).toEqual(["app/**"]);
    expect(document.provenance.excluded.fileCount).toBeGreaterThan(0);
  });

  it("says an empty repository is empty rather than perfectly understood", () => {
    const { reading } = readingOf(EMPTY);
    const document = readDocument({ reading, meta: meta("fresh") }, null);
    expect(document.provenance.emptyRepo).toBe(true);
    expect(document.headline.scoredBytes).toBe(0);
    expect(document.headline.display.floor).toBe("0%");
    expect(document.tide).toBeUndefined();
  });
});

describe("serialisation", () => {
  it("is byte-identical across two runs of the same reading", () => {
    const first = readInput();
    const second = readInput();
    expect(serializeJson(readDocument(first.input, first.tide))).toBe(
      serializeJson(readDocument(second.input, second.tide)),
    );
  });

  it("opens every document with the same keys in the same order", () => {
    const { input, tide, reading } = readInput();
    const documents = [
      readDocument(input, tide),
      explainDocument(input, reading.files[0]),
      checkDocument(input, evaluateCheck(reading, { maxBlind: 1, pessimistic: false })),
    ];
    for (const document of documents) {
      expect(Object.keys(JSON.parse(serializeJson(document))).slice(0, 6)).toEqual([
        "fathohm",
        "command",
        "now",
        "target",
        "provenance",
        "headline",
      ]);
    }
  });
});
