import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isKnownBot } from "./bot-identities";

/** Resolves a stored `author_key` to the id counted by `bus_factor`. */
export type ActorResolver = (authorKey: string | null) => string;

/**
 * The `author_key` an ingested event is stored under: the lowercased git author
 * EMAIL when there is one, otherwise the name.
 *
 * The name was never an identity. One human writing as "amitshrivastavaa" and
 * "Amit Shrivastava" from a single address counted as two of the three
 * contributors a healthy bus factor needs — a repo with one developer read as a
 * repo with two. The email is the stable key git actually carries.
 *
 * A known bot keeps its NAME, deliberately: the allowlist is exact-name by
 * design (see bot-identities.ts — a `[bot]` pattern would swallow real coding
 * agents), and a bot's commit email is a GitHub-generated noreply address the
 * allowlist cannot recognise. Keying it by email would quietly turn every bot
 * into a person in the identity UI and drop the read-time bot override's safety
 * net for all future rows.
 */
export function authorKeyFor(authorName: string, authorEmail: string): string {
  if (isKnownBot(authorName)) return authorName;
  const email = authorEmail.trim().toLowerCase();
  return email.length > 0 ? email : authorName;
}

/**
 * THE PUBLISHABLE FORM OF AN IDENTITY: `fh_` + 12 hex of SHA-256 over the key.
 *
 * `authorKeyFor` returns an EMAIL ADDRESS for nearly every human. That is the
 * right key to score by and the wrong thing to print into a document people
 * send on: `fathohm team --json` is built to be piped into CI, posted onto a
 * pull request and kept as a build artefact, and every one of those is a wider
 * audience than the repository whose git log the address came from.
 *
 * WHAT THIS IS NOT. It is not anonymisation, and nothing in this product will
 * claim it is. An email is low-entropy — anyone holding the repository can hash
 * the addresses in its own history and rebuild the mapping in a second. The
 * claim is exactly and only this: the DOCUMENT does not carry the address. A
 * reader who already has the history learns nothing new; a scraper reading a CI
 * log gets no mailbox.
 *
 * Stable, so it does the job the raw key did: the same person is the same id
 * across runs and across repositories, which is what lets a consumer join a
 * keeper row to its leave row and to last week's document. `dropAuthor` accepts
 * this spelling too, so an id read out of a document can be fed straight back
 * to `--without`.
 */
export function identityId(authorKey: string): string {
  const digest = createHash("sha256").update(authorKey.trim().toLowerCase(), "utf8").digest("hex");
  return `fh_${digest.slice(0, 12)}`;
}

/** The shape `identityId` emits — what `--without` recognises as an id rather
 *  than as a name somebody typed. */
export const IDENTITY_ID = /^fh_[0-9a-f]{12}$/;

/**
 * Today's behaviour: the raw key IS the identity. Every resolver parameter
 * defaults to this, so an unresolved key scores exactly as it does now.
 */
export const IDENTITY_RESOLVER: ActorResolver = (authorKey) => authorKey ?? "";

/**
 * Builds a resolver from `person_aliases` for one org. Loaded once per scoring
 * batch, not per row. Throws on a query error — silently falling back would
 * mean scoring against a partial identity map and producing numbers nobody
 * could reproduce.
 */
export async function loadActorResolver(supabase: SupabaseClient, orgId: string): Promise<ActorResolver> {
  const { data, error } = await supabase
    .from("person_aliases")
    .select("author_key, person_id")
    .eq("org_id", orgId);
  if (error) throw new Error(`person_aliases read failed: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of (data as Array<{ author_key: string; person_id: string }> | null) ?? []) {
    map.set(row.author_key, row.person_id);
  }
  return (authorKey) => {
    if (authorKey === null) return "";
    return map.get(authorKey) ?? authorKey;
  };
}
