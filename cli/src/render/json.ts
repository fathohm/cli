import * as z from "zod/mini";

import { identityId } from "../../../workers/src/identity-map";

import { exactBlindShare, formatBlindShare, formatLimitPercent } from "../../../lib/blind-share-format";
import { bucketOf, bucketSentence, explainReading } from "../../../lib/reading-explained";
import type { CheckVerdict } from "../reading/check";
import { holdsAtCeiling } from "../reading/fade";
import type { OffboardReading } from "../reading/offboard";
import type { PaydownReading } from "../reading/paydown";
import type { RepoReading, ScoredFile } from "../reading/scoring";
import { SIGNATURE_NOTE } from "../reading/signatures";
import type { TeamReading } from "../reading/team";
import type { TidePoint, TideSeries } from "../reading/tide";
import { CLI_VERSION, SCORER_VERSION } from "../version";
import { fileEntries } from "./entries";
import { ledgerOf, printedShare } from "./ledger";
import type { RenderMeta } from "./meta";

/**
 * `--json` — the reading as data, and the contract a pipeline is allowed to
 * build on.
 *
 * Three properties, and they are the whole design:
 *
 * **Every number is carried raw AND rendered.** `headline.floor` is the exact
 * share; `headline.display.floor` is what a person should be shown, through
 * `lib/blind-share-format`'s floors. A consumer that wants to compute gets the
 * float; a consumer that wants to print gets a string that can never say "0%"
 * about a repository with debt in it. Re-deriving the second from the first is
 * how the `<1%` floor got lost on six surfaces before it was one function.
 *
 * **Units are stated, not guessed.** Every SHARE in this document — the
 * headline's, a bucket's, the tide's, the verdict's — is a percent in 0–100.
 * Every SCORE — a file's floor and ceiling, a factor's value — is 0–1, the
 * scorer's own scale, with the line at `BLIND_SPOT_THRESHOLD`. The two never
 * meet in one object.
 *
 * **The schema is exported and enforced on the way out.** `emitJson` parses
 * the document against it before a byte reaches stdout, so a builder that
 * drifts fails here rather than in somebody's CI six weeks later. The schemas
 * are strict: an unexpected key is a bug, not a bonus field.
 *
 * The shape is one document with optional sections, not five documents. A
 * consumer can read `.headline` and `.provenance` from any command, which is
 * what makes `fathohm check --json` and `fathohm read --json` interchangeable
 * inputs to the same dashboard.
 */

const engagementSchema = z.strictObject({
  last_hand_authored: z.nullable(z.string()),
  last_prompted: z.nullable(z.string()),
  contributors: z.strictObject({ full: z.number(), prompted: z.number() }),
});

const factorsSchema = z.strictObject({
  human_review_depth: z.number(),
  human_author_recency: z.number(),
  bus_factor: z.number(),
  question_answerability: z.number(),
  engagement: engagementSchema,
});

/** One file. `floor`/`ceiling` are SCORES (0–1), not shares. */
const fileSchema = z.strictObject({
  path: z.string(),
  bytes: z.number(),
  floor: z.number(),
  ceiling: z.number(),
  prMediated: z.boolean(),
  fadesAt: z.nullable(z.string()),
  bucket: z.nullable(z.string()),
  factors: factorsSchema,
});

const provenanceSchema = z.strictObject({
  shallow: z.boolean(),
  grafted: z.boolean(),
  emptyRepo: z.boolean(),
  squashOnly: z.boolean(),
  sinceBound: z.nullable(z.string()),
  atRef: z.nullable(z.string()),
  submodulesSkipped: z.number(),
  excluded: z.strictObject({
    patterns: z.array(z.string()),
    fileCount: z.number(),
    bytes: z.number(),
  }),
  /**
   * The permanent provenance line, in machine form: git records who declared
   * themselves, so an agent that signs nothing is indistinguishable from a
   * person and every agent share here is a LOWER bound. It is a literal `true`
   * rather than a comment because a machine consumer deserves the same caveat
   * the card prints, and a caveat that only exists in prose is a caveat that
   * does not survive a pipeline.
   */
  agentShareIsLowerBound: z.literal(true),
});

/**
 * `dark`, `floor` and `ceiling` here are SHARES: percents in 0–100.
 *
 * `dark` is what the card prints at headline size from 1.5.0: the share of
 * bytes no human wrote or prompted inside the scorer's recency window. It is
 * one number with no missing factor in it.
 *
 * `floor`/`ceiling` are the comprehension-debt interval, unchanged and still
 * first-class — `check` gates on them, `paydown` ladders them, the card's
 * closing block prints them, and `scripts/cli-gallery-parity.ts` asserts the
 * floor against the hosted number. A consumer built on either key before 1.5.0
 * still reads the value it always read.
 */
const headlineSchema = z.strictObject({
  dark: z.number(),
  floor: z.number(),
  ceiling: z.number(),
  fileCount: z.number(),
  scoredBytes: z.number(),
  darkBytes: z.number(),
  floorBlindBytes: z.number(),
  ceilingBlindBytes: z.number(),
  display: z.strictObject({
    dark: z.string(),
    floor: z.string(),
    ceiling: z.string(),
  }),
});

/**
 * BYTES BY DECLARED SIGNATURE — data only, and never on a card.
 *
 * Every agent-authored byte in this reading is agent-authored because of a
 * specific declaration, and the detector already knows which. Carrying it here
 * lets a pipeline ask the question the label alone cannot ("which tool wrote
 * the part nobody has a name on"), and keeping it out of every printed surface
 * is deliberate: the subject of this product is the codebase and the humans on
 * its record, and a vendor breakdown at card size would be a different one.
 *
 * `note` travels INSIDE the object rather than in prose, because the two ways
 * to misread these numbers are both fatal and neither is visible from the key
 * names: the vocabulary is three patterns rather than a census of the field,
 * and `unsigned` is agent-labelled work whose event recorded no signature —
 * never human work. A caveat that lives only in a README is a caveat that does
 * not survive a pipeline.
 *
 * OPTIONAL, so that a document written by any CLI before 1.6.0 still parses
 * against the published schema. Every 1.6.0 reading emits it.
 */
const signaturesSchema = z.strictObject({
  claude_code: z.number(),
  copilot: z.number(),
  cursor: z.number(),
  unsigned: z.number(),
  note: z.string(),
});

const bucketSchema = z.strictObject({
  id: z.string(),
  fileCount: z.number(),
  bytes: z.number(),
  share: z.number(),
  display: z.string(),
  sentence: z.string(),
  aboveReason: z.optional(z.string()),
  handAgeDays: z.optional(z.number()),
  reviewLift: z.optional(z.number()),
});

/**
 * One LEDGER GROUP — a dark reason as the card prints it.
 *
 * Beside `buckets`, not instead of it, and the two now answer different
 * questions rather than being two views of one partition. `buckets` is
 * `lib/reading-explained`'s engagement partition — the HOSTED reading's own
 * decomposition, still computed and still true, cut on the comprehension line.
 * `groups` is what the card actually printed from 1.5.0: the DARK partition,
 * with the allocated integer share that made the column add up and the paths
 * that appeared under each heading. `id` therefore carries a `DarkReasonId`
 * (`faded-hand`, `faded-prompted`, `never`) rather than a `BucketId`.
 */
const groupSchema = z.strictObject({
  id: z.string(),
  /** Share of scored bytes, 0–100 — the exact value, as everywhere else. */
  share: z.number(),
  /** The share AS PRINTED, allocated under the headline by largest remainder. */
  display: z.string(),
  fileCount: z.number(),
  /** The paths printed under this heading, in the card's own order. */
  paths: z.array(z.string()),
});

const tidePointSchema = z.strictObject({
  at: z.string(),
  floor: z.number(),
  ceiling: z.number(),
});

const tideSchema = z.strictObject({
  past: z.array(tidePointSchema),
  today: tidePointSchema,
  forecast: z.array(tidePointSchema),
  nextToFade: z.nullable(z.strictObject({ path: z.string(), at: z.string() })),
});

const crossingsSchema = z.strictObject({
  horizonDays: z.number(),
  files: z.array(
    z.strictObject({
      path: z.string(),
      bytes: z.number(),
      floor: z.number(),
      fadesAt: z.string(),
      holdsAtCeiling: z.boolean(),
    }),
  ),
});

/** Both ends of one reading's interval, as SHARES: percents in 0–100. */
const boundsSchema = z.strictObject({
  floorBlindShare: z.number(),
  ceilingBlindShare: z.number(),
});

/**
 * `offboard`: the two readings, and what sits between them.
 *
 * `headline` on this document is the repository AS IT STANDS — the same
 * headline every other command carries, so a pipeline can read `.headline` off
 * any of them. The simulation lives here, with its own before and after, so
 * nothing has to guess which of the two the top-level number was.
 *
 * `before` and `after` are both present even though `before` duplicates
 * `headline`: the two are the same today and a consumer diffing them is
 * checking exactly the claim the card makes, which it should not have to
 * assemble from two different levels of the document.
 */
const offboardSchema = z.strictObject({
  /** Whether the name found anybody. False means nothing was removed. */
  matched: z.boolean(),
  before: boundsSchema,
  after: boundsSchema,
  /** Code whose history carries their name and nobody else's. Share is 0–100. */
  soleKeeper: z.strictObject({
    files: z.number(),
    bytes: z.number(),
    share: z.number(),
  }),
  /** Above the line today, below it without them — the FULL set, uncapped. */
  crossings: z.array(
    z.strictObject({
      path: z.string(),
      /** SCORES (0–1), not shares: the file's floor on each side. */
      before: z.number(),
      after: z.number(),
      clause: z.string(),
    }),
  ),
});

/**
 * `team`: the keeper partition, and one leave reading per listed person.
 *
 * `kind` travels beside `name` because a person can be called "shared". A
 * consumer that told the rows apart by their label alone would mis-read exactly
 * the repository where getting it wrong matters.
 */
const teamSchema = z.strictObject({
  rows: z.array(
    z.strictObject({
      kind: z.enum(["keeper", "more", "shared", "no-human"]),
      /** The identity `--without` matches on — `identityId`'s `fh_` form, NOT
       *  the git email it is derived from. Empty on non-`keeper` rows — names
       *  collide, and a document a consumer cannot join person-to-person on
       *  would be two 'Alex' rows about nobody in particular. */
      key: z.string(),
      name: z.string(),
      fileCount: z.number(),
      bytes: z.number(),
      /** Share of scored bytes, 0–100, exact. */
      share: z.number(),
      /** The share the CARD prints: largest-remainder-allocated so the column
       *  sums to 100. A consumer rounding `share` on its own would disagree
       *  with a screenshot of the same reading. */
      units: z.number(),
      /** The printed string, display floors (`<1%`, `>99%`) included. */
      display: z.string(),
    }),
  ),
  leave: z.array(
    z.strictObject({
      /** Same identity id as the matching keeper row. */
      key: z.string(),
      name: z.string(),
      /** SHARES (0–100): the whole reading's floor, with and without them. */
      before: z.number(),
      after: z.number(),
    }),
  ),
});

/**
 * `paydown`: the ladder, and what it is drawn from.
 *
 * `rungs` carries both the raw shares and the strings a reader was SHOWN, from
 * day one — a consumer diffing a screenshot against a pipeline needs the
 * second, and re-deriving it from the first is guesswork about a floor rule.
 * `paths` is the FULL ladder in the card's print order, uncapped, so a
 * pipeline never has to read `--full` to find the sixth file.
 *
 * `gate` is present only when something said what the limit is. fathohm has no
 * default limit, and a document that carried one would be inventing somebody
 * else's tolerance.
 */
const paydownTallySchema = z.strictObject({
  files: z.number(),
  bytes: z.number(),
  /** Share of the scored bytes, 0–100, exact. */
  share: z.number(),
  /** The printed string, display floors included. */
  display: z.string(),
});

const paydownSchema = z.strictObject({
  /** Both ends of the reading before any rung: SHARES, percents in 0–100. */
  before: boundsSchema,
  rungs: z.array(
    z.strictObject({
      /** How many files of the ladder this rung covers. Cumulative. */
      files: z.number(),
      floor: z.number(),
      ceiling: z.number(),
      /** The bytes the gate compares — never a rounded share. */
      floorBlindBytes: z.number(),
      ceilingBlindBytes: z.number(),
      display: z.strictObject({ floor: z.string(), ceiling: z.string() }),
    }),
  ),
  liftable: paydownTallySchema,
  unliftable: paydownTallySchema,
  /** Every liftable file, in the card's print order. Uncapped. */
  paths: z.array(z.string()),
  gate: z.optional(
    z.strictObject({
      threshold: z.number(),
      bound: z.enum(["ceiling", "floor"]),
      passesToday: z.boolean(),
      /** 0 when it already passes; null when no rung on the ladder reaches it. */
      passesAt: z.nullable(z.number()),
      display: z.strictObject({ threshold: z.string() }),
    }),
  ),
});

const verdictSchema = z.strictObject({
  bound: z.enum(["ceiling", "floor"]),
  threshold: z.number(),
  share: z.number(),
  blindBytes: z.number(),
  scoredBytes: z.number(),
  passed: z.boolean(),
  indeterminate: z.boolean(),
  nothingToGate: z.boolean(),
  display: z.strictObject({ share: z.string(), threshold: z.string() }),
});

export const jsonDocumentSchema = z.strictObject({
  fathohm: z.strictObject({ cliVersion: z.string(), scorerVersion: z.string() }),
  command: z.enum([
    "read",
    "explain",
    "fade",
    "check",
    "map",
    "offboard",
    "team",
    "paydown",
  ]),
  now: z.string(),
  target: z.string(),
  provenance: provenanceSchema,
  headline: headlineSchema,
  authorshipSignatures: z.optional(signaturesSchema),
  verdict: z.optional(verdictSchema),
  buckets: z.optional(z.array(bucketSchema)),
  groups: z.optional(z.array(groupSchema)),
  file: z.optional(fileSchema),
  files: z.optional(z.array(fileSchema)),
  crossings: z.optional(crossingsSchema),
  offboard: z.optional(offboardSchema),
  team: z.optional(teamSchema),
  paydown: z.optional(paydownSchema),
  tide: z.optional(tideSchema),
  /** `map` only: where the page was written — resolve it against the directory
   *  fathohm was invoked in. Relative and `/`-separated wherever a relative
   *  spelling exists, which is everywhere except a target on a different
   *  Windows drive: this document is committed and posted, and an absolute path
   *  names the machine rather than the repository. */
  map: z.optional(z.strictObject({ out: z.string() })),
});

export type JsonDocument = z.infer<typeof jsonDocumentSchema>;
export type JsonFile = z.infer<typeof fileSchema>;

/**
 * The single serializer.
 *
 * Key order is the order the builders below write the keys in — JavaScript
 * preserves insertion order for string keys, so one ordered builder per section
 * IS the ordering rule, and there is no second table of key names to drift away
 * from it. The byte-goldens pin the result, which is what turns "stable order"
 * from an intention into a test.
 *
 * Two spaces, trailing newline added by the caller. A `--json` output that a
 * human can read in a terminal is worth four bytes a line: this is the surface
 * people debug a disagreement with the dashboard on.
 */
export function serializeJson(document: JsonDocument): string {
  return JSON.stringify(document, null, 2);
}

/** Validate on the way out: a document that does not match the published
 *  schema must never leave the process. */
export function validateJson(document: JsonDocument): JsonDocument {
  return jsonDocumentSchema.parse(document);
}

export interface DocumentInput {
  readonly reading: RepoReading;
  readonly meta: RenderMeta;
}

/** `read` and `map`: the whole reading — headline, buckets, files, tide. */
export function readDocument(
  input: DocumentInput,
  tide: TideSeries | null,
  extra: { readonly command?: "read" | "map"; readonly out?: string } = {},
): JsonDocument {
  const ledger = ledgerOf(input.reading);
  return {
    ...base(extra.command ?? "read", input),
    buckets: buckets(input.reading),
    groups: ledger.groups.map((group) => ({
      id: group.group.id,
      share: group.group.share * 100,
      display: group.printed,
      fileCount: group.group.fileCount,
      paths: group.files.slice(0, group.rowCount).map((file) => file.path),
    })),
    files: input.reading.files.map(jsonFile),
    ...(tide === null ? {} : { tide: jsonTide(tide) }),
    ...(extra.out === undefined ? {} : { map: { out: extra.out } }),
  };
}

/** `explain`: the reading's context, and the one file. */
export function explainDocument(input: DocumentInput, file: ScoredFile): JsonDocument {
  return {
    ...base("explain", input),
    file: jsonFile(file),
  };
}

/** `fade`: every crossing inside the horizon — the FULL set, uncapped. The
 *  table prints twenty and says so; this is where the rest lives. */
export function fadeDocument(input: DocumentInput, crossings: readonly ScoredFile[]): JsonDocument {
  return {
    ...base("fade", input),
    crossings: {
      horizonDays: input.meta.horizonDays,
      files: crossings.map((file) => ({
        path: file.path,
        bytes: file.bytes,
        floor: file.floor,
        fadesAt: file.fadesAt ?? "",
        holdsAtCeiling: holdsAtCeiling(file),
      })),
    },
  };
}

/**
 * `offboard`: the repository as it stands, and the same repository without one
 * person.
 *
 * Every number comes off the two `RepoReading`s the card was drawn from — there
 * is no second derivation here, which is what makes the document and the card
 * two renderings of one computation rather than two computations that agree.
 */
export function offboardDocument(
  input: DocumentInput,
  off: OffboardReading,
): JsonDocument {
  return {
    ...base("offboard", input),
    offboard: {
      matched: off.matched,
      before: bounds(off.before),
      after: bounds(off.after),
      soleKeeper: {
        files: off.soleKeeper.files,
        bytes: off.soleKeeper.bytes,
        share: off.soleKeeper.share,
      },
      crossings: off.crossings.map((crossing) => ({
        path: crossing.path,
        before: crossing.before,
        after: crossing.after,
        clause: crossing.clause,
      })),
    },
  };
}

/**
 * `paydown`: the ladder, as the card computed it.
 *
 * Every number comes off the `PaydownReading` the card was drawn from — there
 * is no second derivation here, which is what makes the document and the card
 * two renderings of one computation rather than two computations that agree.
 */
export function paydownDocument(
  input: DocumentInput,
  paydown: PaydownReading,
): JsonDocument {
  return {
    ...base("paydown", input),
    paydown: {
      before: {
        floorBlindShare: paydown.before.floor,
        ceilingBlindShare: paydown.before.ceiling,
      },
      rungs: paydown.rungs.map((rung) => ({
        files: rung.files,
        floor: rung.floor,
        ceiling: rung.ceiling,
        floorBlindBytes: rung.floorBlindBytes,
        ceilingBlindBytes: rung.ceilingBlindBytes,
        display: {
          floor: formatBlindShare(rung.floor),
          ceiling: formatBlindShare(rung.ceiling),
        },
      })),
      liftable: paydownTally(paydown.liftable),
      unliftable: paydownTally(paydown.unliftable),
      paths: paydown.ladder.map((file) => file.path),
      ...(paydown.gate === null
        ? {}
        : {
            gate: {
              threshold: paydown.gate.threshold,
              bound: paydown.gate.bound,
              passesToday: paydown.gate.passesToday,
              passesAt: paydown.gate.passesAt,
              display: { threshold: formatLimitPercent(paydown.gate.threshold) },
            },
          }),
    },
  };
}

function paydownTally(
  tally: PaydownReading["liftable"],
): z.infer<typeof paydownTallySchema> {
  return {
    files: tally.files,
    bytes: tally.bytes,
    share: tally.share,
    display: formatBlindShare(tally.share),
  };
}

/**
 * `team`: the keeper partition and the leave column, as the card ordered them.
 *
 * THE ONLY PLACE THIS PRODUCT EVER PRINTED AN EMAIL ADDRESS, and it no longer
 * does. `row.key` is `authorKeyFor`'s — a lowercased git email for nearly every
 * human — and this document is the one output built to be piped into CI, posted
 * onto a pull request and kept as an artefact. The card beside it prints names
 * and never addresses; the machine form was disclosing more than the human form
 * of the same reading, which is backwards. `identityId` carries the join (see
 * its note on what that claim is and is not), and `--without` takes the `fh_`
 * form, so a pipeline that read a key out of this document and fed it back
 * keeps working.
 *
 * Non-keeper rows keep their empty key, exactly as before: an empty string
 * hashes to a real digest, and a `shared` row wearing an id would invite a
 * consumer to join two repositories on "nobody".
 */
export function teamDocument(input: DocumentInput, team: TeamReading): JsonDocument {
  const id = (key: string): string => (key === "" ? "" : identityId(key));
  return {
    ...base("team", input),
    team: {
      rows: team.rows.map((row) => ({
        kind: row.kind,
        key: id(row.key),
        // The two category rows carry the SPEC's tokens rather than their
        // printed labels: "no human" is typography, `no-human` is a key.
        name:
          row.kind === "shared" ? "shared" : row.kind === "no-human" ? "no-human" : row.name,
        fileCount: row.files,
        bytes: row.bytes,
        share: row.share,
        units: row.units,
        display: printedShare(row.units, row.share),
      })),
      leave: team.leave.map((row) => ({
        key: id(row.key),
        name: row.name,
        before: row.before,
        after: row.after,
      })),
    },
  };
}

function bounds(reading: RepoReading): z.infer<typeof boundsSchema> {
  return {
    floorBlindShare: exactBlindShare(reading.floorBlindBytes, reading.scoredBytes),
    ceilingBlindShare: exactBlindShare(reading.ceilingBlindBytes, reading.scoredBytes),
  };
}

/** `check`: the verdict, and the reading it was taken on. */
export function checkDocument(input: DocumentInput, verdict: CheckVerdict): JsonDocument {
  return {
    ...base("check", input),
    verdict: {
      bound: verdict.bound,
      threshold: verdict.threshold,
      share: verdict.share,
      blindBytes: verdict.blindBytes,
      scoredBytes: verdict.scoredBytes,
      passed: verdict.passed,
      indeterminate: verdict.indeterminate,
      nothingToGate: verdict.nothingToGate,
      display: {
        share: formatBlindShare(verdict.share),
        threshold: formatLimitPercent(verdict.threshold),
      },
    },
  };
}

/** What every document opens with, in the order every document opens with it. */
function base(
  command: JsonDocument["command"],
  { reading, meta }: DocumentInput,
): JsonDocument {
  const dark = exactBlindShare(reading.darkBytes, reading.scoredBytes);
  const floor = exactBlindShare(reading.floorBlindBytes, reading.scoredBytes);
  const ceiling = exactBlindShare(reading.ceilingBlindBytes, reading.scoredBytes);
  return {
    fathohm: { cliVersion: CLI_VERSION, scorerVersion: SCORER_VERSION },
    command,
    now: reading.now.toISOString(),
    target: meta.target,
    provenance: {
      shallow: reading.provenance.shallow,
      grafted: reading.provenance.grafted,
      emptyRepo: reading.provenance.emptyRepo,
      squashOnly: reading.squashOnly,
      sinceBound: reading.provenance.sinceBound,
      atRef: reading.provenance.atRef,
      submodulesSkipped: reading.provenance.submodulesSkipped,
      excluded: {
        patterns: [...reading.excluded.patterns],
        fileCount: reading.excluded.fileCount,
        bytes: reading.excluded.bytes,
      },
      agentShareIsLowerBound: true,
    },
    headline: {
      dark,
      floor,
      ceiling,
      fileCount: reading.files.length,
      scoredBytes: reading.scoredBytes,
      darkBytes: reading.darkBytes,
      floorBlindBytes: reading.floorBlindBytes,
      ceilingBlindBytes: reading.ceilingBlindBytes,
      display: {
        dark: formatBlindShare(dark),
        floor: formatBlindShare(floor),
        ceiling: formatBlindShare(ceiling),
      },
    },
    // Read off the reading rather than recomputed here: the tally was taken
    // where the events and the tree were both in hand, and a second pass over
    // the messages would be a second detector.
    authorshipSignatures: {
      claude_code: reading.signatures.claude_code,
      copilot: reading.signatures.copilot,
      cursor: reading.signatures.cursor,
      unsigned: reading.signatures.unsigned,
      note: SIGNATURE_NOTE,
    },
  };
}

/**
 * The buckets, from the dashboard's own explainer, over the SAME file set the
 * headline above them was computed from — one denominator, in the document as
 * on the card. The sentence travels with the bucket: it is the product's
 * voice, it is already tested, and a consumer that wrote its own would be
 * writing a second product.
 */
function buckets(reading: RepoReading): z.infer<typeof bucketSchema>[] {
  return explainReading(fileEntries(reading), reading.now).buckets.map((bucket) => {
    const share = bucket.share * 100;
    const row: z.infer<typeof bucketSchema> = {
      id: bucket.id,
      fileCount: bucket.fileCount,
      bytes: bucket.bytes,
      share,
      display: formatBlindShare(share),
      sentence: bucketSentence(bucket),
    };
    if (bucket.aboveReason !== undefined) row.aboveReason = bucket.aboveReason;
    if (bucket.handAgeDays !== undefined) row.handAgeDays = bucket.handAgeDays;
    if (bucket.reviewLift !== undefined) row.reviewLift = bucket.reviewLift;
    return row;
  });
}

function jsonFile(file: ScoredFile): JsonFile {
  return {
    path: file.path,
    bytes: file.bytes,
    floor: file.floor,
    ceiling: file.ceiling,
    prMediated: file.prMediated,
    fadesAt: file.fadesAt,
    bucket: bucketOf({
      path: file.path,
      size: file.bytes,
      score: file.floor,
      factors: file.factors,
      latestAuthorship: null,
    }),
    factors: {
      human_review_depth: file.factors.human_review_depth,
      human_author_recency: file.factors.human_author_recency,
      bus_factor: file.factors.bus_factor,
      question_answerability: file.factors.question_answerability,
      engagement: {
        last_hand_authored: file.factors.engagement.last_hand_authored,
        last_prompted: file.factors.engagement.last_prompted,
        contributors: {
          full: file.factors.engagement.contributors.full,
          prompted: file.factors.engagement.contributors.prompted,
        },
      },
    },
  };
}

function jsonTide(tide: TideSeries): z.infer<typeof tideSchema> {
  return {
    past: tide.past.map(point),
    today: point(tide.today),
    forecast: tide.forecast.map(point),
    nextToFade:
      tide.nextToFade === null
        ? null
        : { path: tide.nextToFade.path, at: tide.nextToFade.at },
  };
}

/** A tide point's shares, as percents like every other share in the document. */
function point(value: TidePoint): z.infer<typeof tidePointSchema> {
  return {
    at: value.at,
    floor: value.floorShare * 100,
    ceiling: value.ceilingShare * 100,
  };
}
