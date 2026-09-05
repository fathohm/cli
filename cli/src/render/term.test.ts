import { describe, expect, it } from "vitest";
import { BLOCK_RAMP, createTerm, type Ground, MIN_WIDTH, type TermOptions } from "./term";

const ESC = "\u001b";

function term(options: TermOptions) {
  return createTerm({ env: {}, isTTY: false, columns: undefined, ...options });
}

describe("colour resolution", () => {
  // The matrix is the spec: NO_COLOR × FORCE_COLOR × TTY × --no-color.
  const cases: Array<{
    name: string;
    options: TermOptions;
    expected: boolean;
  }> = [
    { name: "plain pipe: no colour", options: { isTTY: false }, expected: false },
    { name: "a TTY: colour", options: { isTTY: true }, expected: true },
    {
      name: "--no-color beats a TTY",
      options: { isTTY: true, noColor: true },
      expected: false,
    },
    {
      name: "--no-color beats FORCE_COLOR",
      options: { isTTY: false, noColor: true, env: { FORCE_COLOR: "1" } },
      expected: false,
    },
    {
      name: "NO_COLOR beats a TTY",
      options: { isTTY: true, env: { NO_COLOR: "1" } },
      expected: false,
    },
    {
      name: "NO_COLOR beats FORCE_COLOR",
      options: { isTTY: true, env: { NO_COLOR: "1", FORCE_COLOR: "1" } },
      expected: false,
    },
    {
      name: "an empty NO_COLOR is not a signal (no-color.org)",
      options: { isTTY: true, env: { NO_COLOR: "" } },
      expected: true,
    },
    {
      name: "FORCE_COLOR turns colour on off-TTY",
      options: { isTTY: false, env: { FORCE_COLOR: "1" } },
      expected: true,
    },
    {
      name: "FORCE_COLOR=0 turns colour off on a TTY",
      options: { isTTY: true, env: { FORCE_COLOR: "0" } },
      expected: false,
    },
    {
      name: "FORCE_COLOR=false turns colour off",
      options: { isTTY: true, env: { FORCE_COLOR: "false" } },
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(term(testCase.options).colorEnabled).toBe(testCase.expected);
    });
  }
});

describe("ground resolution", () => {
  const ground = (flag: Ground | null, env: Record<string, string | undefined> = {}): Ground =>
    createTerm({ ground: flag, env, isTTY: false, columns: 80 }).ground;

  it("takes the reader's word over everything else", () => {
    expect(ground("light", { COLORFGBG: "15;0" })).toBe("light");
    expect(ground("dark", { COLORFGBG: "0;15" })).toBe("dark");
  });

  it("reads COLORFGBG's LAST field, which is the background", () => {
    // Two shapes are in the wild — `fg;bg` and `fg;default;bg` — and the
    // background is the last field in both. Reading the second field instead
    // would invert the answer on every terminal that sets the three-part form.
    expect(ground(null, { COLORFGBG: "0;15" })).toBe("light");
    expect(ground(null, { COLORFGBG: "0;default;15" })).toBe("light");
    expect(ground(null, { COLORFGBG: "15;0" })).toBe("dark");
    expect(ground(null, { COLORFGBG: "15;default;0" })).toBe("dark");
  });

  it("splits the ANSI background numbers where every terminal's palette does", () => {
    // 0-6 and 8 are the dark half, 7 and 9-15 the light half. 8 is the trap:
    // it is "bright black", so it sorts with the dark half despite its number
    // sitting among the brights.
    for (const background of [0, 1, 2, 3, 4, 5, 6, 8]) {
      expect(ground(null, { COLORFGBG: `15;${background}` }), String(background)).toBe("dark");
    }
    for (const background of [7, 9, 10, 11, 12, 13, 14, 15]) {
      expect(ground(null, { COLORFGBG: `0;${background}` }), String(background)).toBe("light");
    }
  });

  it("falls through to dark rather than guessing from something it cannot read", () => {
    // An unreadable value is NOT a signal. `default` alone, a 256-index, a
    // truncated variable — treating any of them as a hint would be inventing
    // information, and the fallback exists precisely for the case where there
    // is none.
    for (const value of ["", "default", "0;default", "15;256", "nonsense", "0;"]) {
      expect(ground(null, { COLORFGBG: value }), JSON.stringify(value)).toBe("dark");
    }
    expect(ground(null, {})).toBe("dark");
  });

  it("resolves a ground even when colour is off", () => {
    // `--no-color` is about whether escapes are emitted, not about which ground
    // they would have been picked for. Keeping the two independent is what lets
    // a `--no-color --light` run still be described honestly by `term.ground`.
    const term = createTerm({ noColor: true, ground: "light", env: {}, isTTY: false });
    expect(term.colorEnabled).toBe(false);
    expect(term.ground).toBe("light");
  });
});

describe("color()", () => {
  it("returns the text untouched when colour is off — no invisible bytes in a pipe", () => {
    const plain = term({ isTTY: false });
    for (const code of ["red", "dim", 214] as const) {
      expect(plain.color("77%", code)).toBe("77%");
    }
  });

  it("wraps the text and always closes the sequence", () => {
    const colored = term({ isTTY: true });
    const painted = colored.color("77%", "red");
    expect(painted.startsWith(`${ESC}[`)).toBe(true);
    expect(painted.endsWith(`${ESC}[0m`)).toBe(true);
    expect(painted).toContain("77%");
  });

  it("emits the standard SGR code for a named colour and 38;5;n for a 256-colour index", () => {
    const colored = term({ isTTY: true });
    expect(colored.color("x", "red")).toBe(`${ESC}[31mx${ESC}[0m`);
    expect(colored.color("x", 214)).toBe(`${ESC}[38;5;214mx${ESC}[0m`);
  });

  it("clamps an out-of-range 256-colour index instead of emitting a broken sequence", () => {
    const colored = term({ isTTY: true });
    expect(colored.color("x", 999)).toBe(`${ESC}[38;5;255mx${ESC}[0m`);
    expect(colored.color("x", -4)).toBe(`${ESC}[38;5;0mx${ESC}[0m`);
  });

  it("leaves an empty string empty (an empty cell must not carry colour)", () => {
    expect(term({ isTTY: true }).color("", "red")).toBe("");
  });
});

describe("glyphs", () => {
  it("swaps the whole set under --ascii, and every ascii glyph is 7-bit", () => {
    const unicode = term({});
    const ascii = term({ ascii: true });
    expect(unicode.ascii).toBe(false);
    expect(ascii.ascii).toBe(true);

    const names = [...BLOCK_RAMP, "bullet", "arrow", "ok", "fail", "dot", "rule"] as const;
    for (const name of names) {
      const plain = ascii.glyph(name);
      expect(plain).not.toBe("");
      expect(/^[\x20-\x7e]+$/.test(plain)).toBe(true);
    }
  });

  it("keeps a real ramp in unicode and a coarse but ordered one in ascii", () => {
    const unicode = term({});
    const ascii = term({ ascii: true });
    const unicodeRamp = BLOCK_RAMP.map((name) => unicode.glyph(name));
    const asciiRamp = BLOCK_RAMP.map((name) => ascii.glyph(name));

    expect(new Set(unicodeRamp).size).toBe(BLOCK_RAMP.length);
    // The ascii ramp collapses, but it must still rank: two distinct steps,
    // low ones before high ones.
    expect(new Set(asciiRamp).size).toBeGreaterThan(1);
    expect(asciiRamp[0]).toBe(asciiRamp[1]);
    expect(asciiRamp[0]).not.toBe(asciiRamp[asciiRamp.length - 1]);
  });
});

describe("width", () => {
  const cases: Array<{ name: string; options: TermOptions; expected: number }> = [
    { name: "nothing known: the 80-column floor", options: {}, expected: 80 },
    { name: "COLUMNS wins when it is wider", options: { env: { COLUMNS: "120" } }, expected: 120 },
    {
      name: "COLUMNS narrower than the floor is floored, not honoured",
      options: { env: { COLUMNS: "40" } },
      expected: MIN_WIDTH,
    },
    {
      name: "COLUMNS beats the TTY's own width",
      options: { env: { COLUMNS: "100" }, columns: 200 },
      expected: 100,
    },
    { name: "falls back to the TTY width", options: { columns: 132 }, expected: 132 },
    { name: "a fractional TTY width floors to an integer", options: { columns: 99.7 }, expected: 99 },
    {
      name: "junk in COLUMNS is ignored",
      options: { env: { COLUMNS: "wide" }, columns: 110 },
      expected: 110,
    },
    { name: "a zero TTY width is not a width", options: { columns: 0 }, expected: MIN_WIDTH },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(term(testCase.options).width).toBe(testCase.expected);
    });
  }
});
