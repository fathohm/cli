import { describe, expect, it } from "vitest";

import {
  KINDS_BELOW,
  MIXED,
  PROMPTED_DOMINANT,
  PROMPTED_ONLY,
  readingOf,
} from "../../test-helpers/reading-fixtures";
import { isDark } from "../reading/dark";
import { createTerm, type Term } from "./term";
import { TOP_PATHS, darkFiles, darkRows } from "./below";
import { renderCard } from "./card";
import { kindRank } from "../reading/kind";
import { ledgerOf } from "./ledger";
import type { RenderMeta } from "./meta";
import { SCORER_VERSION } from "../version";

/**
 * THE ORDERING, as a contract rather than as a sort call.
 *
 * Three surfaces read this list and they must agree: the card prints the first
 * five rows, `fathohm explain 3` resolves the third entry, and the selector
 * lists the rows the card printed. The tests below are about that agreement —
 * the shape of a row is the card's golden file's business.
 */

function term(columns = 80): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns });
}

const META: RenderMeta = {
  target: "fixture",
  quiet: false,
  full: false,
  horizonDays: 90,
  scorerVersion: SCORER_VERSION,
};

const FIXTURES = [
  { name: "mixed", fixture: MIXED },
  { name: "prompted-dominant", fixture: PROMPTED_DOMINANT },
  { name: "prompted-only", fixture: PROMPTED_ONLY },
] as const;

describe("darkFiles", () => {
  for (const { name, fixture } of FIXTURES) {
    it(`${name}: holds every dark file and nothing else`, () => {
      // THE PREDICATE CHANGED AT 1.5.0 and the contract did not. This list used
      // to be the files below the comprehension line; it is now the files that
      // have gone dark, because that is what the card's headline counts and
      // this list is what the card prints under it. The two are genuinely
      // different sets — `PROMPTED_ONLY` is every file below the line and not
      // one file dark — so asserting the old predicate here would have quietly
      // numbered rows the reader is not looking at.
      const { reading } = readingOf(fixture);
      const dark = darkFiles(reading);
      const expected = reading.files.filter(isDark);
      expect(dark.length).toBe(expected.length);
      expect(new Set(dark.map((file) => file.path))).toEqual(
        new Set(expected.map((file) => file.path)),
      );
      for (const file of dark) expect(file.factors.human_author_recency).toBe(0);
    });

    it(`${name}: IS the ledger's print order, group by group`, () => {
      // Not "sorted the same way as" — the same array. A second sort here
      // would number rows the reader is not looking at, which is the failure
      // mode an ordinal argument has to be incapable of.
      const { reading } = readingOf(fixture);
      expect(darkFiles(reading).map((file) => file.path)).toEqual(
        ledgerOf(reading).groups.flatMap((group) => group.files.map((file) => file.path)),
      );
    });

    it(`${name}: inside a group, ranks by tier, then bytes, then path`, () => {
      for (const group of ledgerOf(readingOf(fixture).reading).groups) {
        for (let index = 1; index < group.files.length; index += 1) {
          const previous = group.files[index - 1];
          const current = group.files[index];
          if (kindRank(previous.path) !== kindRank(current.path)) {
            expect(kindRank(previous.path)).toBeLessThan(kindRank(current.path));
            continue;
          }
          if (previous.bytes === current.bytes) expect(previous.path < current.path).toBe(true);
          else expect(previous.bytes).toBeGreaterThan(current.bytes);
        }
      }
    });

    it(`${name}: the demoted tiers are a SUFFIX of their group, never a hole in it`, () => {
      for (const group of ledgerOf(readingOf(fixture).reading).groups) {
        const ranks = group.files.map((file) => kindRank(file.path));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      }
    });

    it(`${name}: orders identically across readings of the same fixture`, () => {
      const one = darkFiles(readingOf(fixture).reading).map((file) => file.path);
      const two = darkFiles(readingOf(fixture).reading).map((file) => file.path);
      expect(one).toEqual(two);
    });
  }

  it("does not reorder the reading it was handed", () => {
    // `Array.prototype.sort` mutates. A helper that quietly re-sorted
    // `reading.files` would change every surface downstream of it.
    const { reading } = readingOf(MIXED);
    const before = reading.files.map((file) => file.path);
    darkFiles(reading);
    expect(reading.files.map((file) => file.path)).toEqual(before);
  });
});

describe("darkRows", () => {
  it("stops at the number of paths the card names", () => {
    // KINDS_BELOW rather than MIXED: the cap is only tested by a fixture that
    // EXCEEDS it, and MIXED holds exactly five dark files at 1.5.0 — enough to
    // make this assertion pass while proving nothing about the cap.
    const { reading } = readingOf(KINDS_BELOW);
    expect(darkFiles(reading).length).toBeGreaterThan(TOP_PATHS);
    expect(darkRows(reading, term()).length).toBe(TOP_PATHS);
  });

  it("is the ledger's printed rows, in print order", () => {
    // NOT the first five of the ordering: the rows are shared across groups by
    // weight, so a small group's row can sit above a big group's fourth file.
    const { reading } = readingOf(MIXED);
    expect(darkRows(reading, term()).map((row) => row.file.path)).toEqual(
      ledgerOf(reading).rows.map((file) => file.path),
    );
  });

  it("is a subsequence of the ordering, so a row number never goes backwards", () => {
    const { reading } = readingOf(MIXED);
    const order = darkFiles(reading).map((file) => file.path);
    const positions = darkRows(reading, term()).map((row) => order.indexOf(row.file.path));
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  for (const columns of [80, 100, 132]) {
    it(`${columns} columns: every body is a line the card printed, verbatim`, () => {
      // The one assertion the selector depends on. It re-lists these bodies
      // under a cursor cell, so a body that was not on the card would be a
      // second rendering of the same file — the exact drift this module exists
      // to prevent.
      const { reading, tide } = readingOf(MIXED);
      const shared = term(columns);
      const card = renderCard(reading, tide, shared, META);
      for (const row of darkRows(reading, shared)) {
        expect(card, `not on the card: ${row.body}`).toContain(`  ${row.body}`);
      }
    });
  }

  it("returns nothing when nothing has gone dark", () => {
    // The empty case is the selector's own gate: no rows, no selector.
    const { reading } = readingOf(MIXED);
    const lit = { ...reading, files: reading.files.filter((file) => !isDark(file)) };
    expect(darkFiles(lit)).toEqual([]);
    expect(darkRows(lit, term())).toEqual([]);
  });
});
