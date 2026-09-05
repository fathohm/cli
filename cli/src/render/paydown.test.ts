import { describe, expect, it } from "vitest";

import {
  HANDOVER,
  MIXED,
  PROMPTED_DOMINANT,
  TINY_LADDER,
  paydownOf,
} from "../../test-helpers/reading-fixtures";
import { createTerm, type Term } from "./term";
import { SCORER_VERSION } from "../version";
import type { RenderMeta } from "./meta";
import { renderPaydown } from "./paydown";

/**
 * THE CLAIMS THE GOLDENS CANNOT PIN — the paydown card's suppression seam, its
 * printed commands, and the words it is not allowed to reach for.
 *
 * The goldens hold the card on readings where the ladder moves and there is no
 * baseline. These are the assertions for the other arrangements: a ladder whose
 * rungs are a rounding error (where four identical rows would be a leverage
 * claim refuting itself), a gate that flips while the printed shares hold (where
 * "moves nothing this card prints" would be refuted two lines down), and a
 * `--without` baseline that has to travel into every command the card prints.
 */

function term(columns = 80): Term {
  return createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns });
}

/** The card as one line of prose, so a phrase assertion survives the wrap. */
function flat(lines: readonly string[]): string {
  return lines.join(" ").replace(/\s+/g, " ");
}

function meta(overrides: Partial<RenderMeta> = {}): RenderMeta {
  return {
    target: "acme-api",
    quiet: false,
    full: false,
    horizonDays: 90,
    scorerVersion: SCORER_VERSION,
    ...overrides,
  };
}

describe("the moves-nothing claim is about the whole card", () => {
  it("suppresses a ladder of identical numbers and says so once", () => {
    const paydown = paydownOf(TINY_LADDER);
    // The fixture's own contract, asserted so a scorer change cannot quietly
    // turn this into a test of nothing: the bytes move, the printed share does
    // not, and there are rungs to suppress.
    expect(paydown.rungs.length).toBeGreaterThan(0);
    expect(paydown.rungs.at(-1)?.floorBlindBytes).toBeLessThan(
      paydown.reading.floorBlindBytes,
    );

    const text = flat(renderPaydown(paydown, term(), meta()));
    expect(text).toContain("moves nothing this card prints");
    expect(text).toContain("the share holds at both ends");
    expect(text).not.toContain("THE LADDER");
  });

  it("drops the whole-card claim the moment the gate line moves", () => {
    // Same reading, same still shares — but a limit of 50 that fails today and
    // passes at the tenth rung. The card prints that move, so it may not deny
    // one two lines above it.
    const paydown = paydownOf(TINY_LADDER, { maxBlind: 50 });
    expect(paydown.gate?.passesToday).toBe(false);
    expect(paydown.gate?.passesAt).toBe(10);

    const text = flat(renderPaydown(paydown, term(), meta()));
    expect(text).not.toContain("moves nothing this card prints");
    expect(text).toContain("holds the printed worst case exactly where it is");
    expect(text).toContain("a recorded, commented review of 10 files");
  });

  it("prints the ladder whenever the printed share actually moves", () => {
    const text = flat(renderPaydown(paydownOf(MIXED), term(), meta()));
    expect(text).toContain("THE LADDER");
    expect(text).not.toContain("moves nothing this card prints");
  });
});

describe("every printed command reproduces the card that printed it", () => {
  it("carries a --without baseline into the ladder's own commands", () => {
    const paydown = paydownOf(PROMPTED_DOMINANT, { without: ["Ada Lovelace"] });
    const text = flat(renderPaydown(paydown, term(), meta({ target: "job-ai" })));

    expect(text).toContain("baseline: without Ada Lovelace");
    expect(text).toContain("fathohm paydown --without 'Ada Lovelace' --full");
    expect(text).toContain("--without 'Ada Lovelace'");
  });

  it("carries the gate flags, so --full prints the same gate line", () => {
    const paydown = paydownOf(PROMPTED_DOMINANT, { maxBlind: 40, pessimistic: true });
    const text = flat(renderPaydown(paydown, term(), meta({ target: "job-ai" })));
    expect(text).toContain("fathohm paydown --max-blind 40 --pessimistic --full");
    expect(text).toContain("fathohm check --max-blind 40 --pessimistic");
  });

  it("names the check invocation the gate was actually answered against", () => {
    const ceiling = flat(
      renderPaydown(paydownOf(HANDOVER, { maxBlind: 5 }), term(), meta()),
    );
    expect(ceiling).toContain("fathohm check --max-blind 5");
    expect(ceiling).not.toContain("--pessimistic");
  });

  it("says nothing about a gate nobody set a limit for", () => {
    const text = flat(renderPaydown(paydownOf(MIXED), term(), meta()));
    expect(text).not.toContain("fathohm check");
    expect(text).not.toContain("--max-blind");
  });

  it("keeps the baseline out of the header when there is none", () => {
    expect(flat(renderPaydown(paydownOf(MIXED), term(), meta()))).not.toContain("baseline:");
  });
});

describe("the copy claims only what the ladder computed", () => {
  const cards = [
    renderPaydown(paydownOf(MIXED, { maxBlind: 40 }), term(), meta()),
    renderPaydown(paydownOf(PROMPTED_DOMINANT), term(), meta()),
    renderPaydown(paydownOf(HANDOVER, { maxBlind: 5, pessimistic: true }), term(), meta()),
    renderPaydown(paydownOf(TINY_LADDER, { maxBlind: 50 }), term(), meta()),
    renderPaydown(paydownOf(MIXED), term(), meta({ full: true })),
    renderPaydown(paydownOf(MIXED), term(), meta({ quiet: true })),
  ];

  /**
   * The banned lexicon, in one place. Each of these is a claim git carries no
   * evidence for: an ordering claim the ladder cannot back, a person-shaped
   * word, an estimate of somebody's afternoon, or an assertion about a review
   * record this tool does not have.
   */
  for (const word of [
    "cheapest",
    "shortest",
    "fastest",
    "quick",
    "easy",
    "hours",
    "effort",
    "critical",
    "risk",
    "never reviewed",
    "nobody understands",
  ]) {
    it(`never says "${word}"`, () => {
      for (const card of cards) {
        expect(flat(card).toLowerCase()).not.toContain(word);
      }
    });
  }

  it("keeps every rung in the conditional", () => {
    const text = flat(renderPaydown(paydownOf(MIXED), term(), meta()));
    expect(text).toContain("git records no reviews");
    expect(text).toContain("what a recorded, commented review would return");
  });
});

describe("the shapes a ladder can take", () => {
  it("--full prints every file on the ladder and defers to nothing", () => {
    const paydown = paydownOf(PROMPTED_DOMINANT);
    const full = flat(renderPaydown(paydown, term(), meta({ full: true })));
    for (const file of paydown.ladder) expect(full).toContain(file.path);
    expect(full).not.toContain("more on this ladder");
  });

  it("the default card defers, and names the command that finishes the list", () => {
    const paydown = paydownOf(PROMPTED_DOMINANT);
    expect(paydown.ladder.length).toBeGreaterThan(5);
    const text = flat(renderPaydown(paydown, term(), meta()));
    expect(text).toContain(`${paydown.ladder.length - 5} more on this ladder`);
  });

  it("--quiet is one line, whatever the ladder is", () => {
    const lines = renderPaydown(paydownOf(MIXED), term(), meta({ quiet: true }));
    const body = lines.filter((line) => line.trim() !== "" && line.startsWith("  "));
    // The headline and the provenance line, and nothing between them.
    expect(body).toHaveLength(2);
    // "comprehension debt", not "unfathomed": the metaphor word retired from
    // every CLI surface at 1.5.0 and stayed on the hosted ones, where it was
    // earned. A quiet line is captured into scripts, so the word in it is a
    // published interface and worth pinning.
    expect(body[0]).toContain("comprehension debt");
  });

  it("fits eighty columns with a baseline and a gate on the same card", () => {
    const paydown = paydownOf(HANDOVER, {
      without: ["sam", "marco"],
      maxBlind: 40,
      pessimistic: true,
    });
    for (const line of renderPaydown(paydown, term(), meta())) {
      expect(line.length, `too wide: ${line}`).toBeLessThanOrEqual(80);
    }
  });
});
