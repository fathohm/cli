# `cli/src` — what lives where

Six lanes. The tree is the least of it; the **rules** below are the point,
because they are what a file added next month has to satisfy.

```
index.ts          entrypoint + command dispatch (the esbuild entry)
interactive.ts    the TTY loop — a composition of tty/ and render/
version.ts        the version constant (scripts/cli-version.ts edits this path)

cmd/       args config errors
repo/      git extract events glob
reading/   scoring dark fade tide team offboard paydown people check
           kind days allocate counterfactual signatures
tty/       keys selector
render/    term map card json ledger minimap explain text … (+ __golden__/)
```

## The rule for a new file

- **root** — only things that wire three or more lanes together. Importing
  from fewer means you belong in one of them.
- **`cmd/`** — being invoked and exiting: argv, `.fathohm.toml`, exit codes.
  It may name a default (`args.ts` reads `DARK_WINDOW_DAYS` to write the help
  text) but it may never *compute* one.
- **`repo/`** — turns a git working copy into typed data. It may spawn
  processes and touch the filesystem. It imports `cmd/` and nothing else in
  this tree — that is an invariant, and `layering.test.ts` holds it.
- **`reading/`** — arithmetic over a `RepoExtract` yielding a number, a bound
  or a ranking. **If it returns a string a human reads, it is in the wrong
  lane.**
- **`tty/`** — the input device: raw bytes to intentions, picker state. Pure;
  no printing, no ANSI. (It names one *type* from `render/term`, which is
  erased at build — the rule is about output, not about types.)
- **`render/`** — output for a human (ANSI, HTML, JSON) and the typesetting
  arithmetic serving it. It reads `reading/` freely; never the reverse.

The two that do the real work: **`reading/` never returns prose, and
`reading/` never imports `render/`.**

## Six names live twice, on purpose

`check` `fade` `offboard` `paydown` `team` `selector` each exist in two lanes:
one computes, one prints. The shared name is the documentation and the path
disambiguates. They are also exactly the files where the layering can rot, so
"does my twin import my twin?" is the one question a reviewer has to ask.

## The debt that used to be here, and how it was paid

Four files in `reading/` once imported `render/` — `check` `offboard` `paydown`
`team` — and `layering.test.ts` pinned the list so a fifth would fail the build.
The list is empty now, and the assertion is an invariant rather than a ratchet.

The fix in every case was the *opposite* of what the pin predicted. None of
them needed a formatting concern lifted out of a computing file; each was
computation that had been living in a printing file, and the move was
downward:

| what moved | from | to |
| --- | --- | --- |
| `isDegenerate` | `render/card.ts` | `reading/scoring.ts` |
| `kindRank` `byDisplayOrder` | `render/kind.ts` | `reading/kind.ts` |
| `allocateUnits` `pinnedUnits` | `render/ledger.ts` | `reading/allocate.ts` |
| `reviewedScore` `reviewedBlindBytes` `reviewedBlindShare` | `render/ledger.ts` | `reading/counterfactual.ts` |
| `daysBetween` | `render/text.ts` | `reading/days.ts` |

The test to apply to the next one that appears: **does it return a string a
human reads?** If not, it was never render's to hold, and the import pointing
the wrong way is the symptom rather than the defect.

## Known debt

`render/tide-strip.ts` carries a private second `daysBetween` that rounds
where `reading/days.ts` floors and clamps. Unifying them changes a printed
"in N days", so it is a behaviour change and needs its own fixture, not a
move. Four modules also declare their own `DAY_MS`.
