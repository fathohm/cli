import { describe, expect, it } from "vitest";

import { formatInterval } from "./interval";
import { createTerm } from "./term";

const term = createTerm({ noColor: true, env: {}, isTTY: false, columns: 80 });

describe("the interval", () => {
  it("prints one number when both ends render the same", () => {
    // THE DEFECT THIS FILE SHIPPED WITH. The two ends here are genuinely
    // different values, and both fall under the display floor, so the range
    // this used to print was `<1% – <1%` — a range between a number and itself,
    // on the most-screenshotted line the product has.
    expect(formatInterval(0.003, 0.008, term)).toBe("<1%");
    expect(formatInterval(0.996, 0.999, term)).toBe(">99%");
  });

  it("still prints one number when the values are actually equal", () => {
    expect(formatInterval(0.47, 0.47, term)).toBe("47%");
    expect(formatInterval(1, 1, term)).toBe("100%");
  });

  it("prints both ends whenever they render differently", () => {
    expect(formatInterval(0.24, 0.72, term)).toBe("24% – 72%");
    // A floored end against an unfloored one is still a range, and the spacing
    // is what stops `– >` reading as an arrow.
    expect(formatInterval(0.86, 0.996, term)).toBe("86% – >99%");
  });

  it("keeps the separator spaced so a range can never read as a trend", () => {
    const rendered = formatInterval(0.67, 0.996, term);
    expect(rendered).toContain(" ");
    expect(rendered).not.toMatch(/–>/);
  });

  it("folds to ascii without losing either property", () => {
    const ascii = createTerm({ noColor: true, ascii: true, env: {}, isTTY: false, columns: 80 });
    expect(formatInterval(0.003, 0.008, ascii)).toBe("<1%");
    expect(formatInterval(0.24, 0.72, ascii)).toBe("24% - 72%");
  });
});
