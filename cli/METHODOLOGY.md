# How fathohm reads a repository

The claims on the [README](./README.md), and what backs each one. Nothing here
is a summary — this is the argument itself, kept in one document so that a
reader deciding whether to trust a number can read the reasoning end to end
rather than assembling it from asides.

The short version, which the README also carries:

- The headline is one number and you can check it against your own `git log`.
- It is a claim about a **record**, never about anybody's head.
- Every agent-share number is a **floor**: authorship is declared, not detected.
- Comprehension debt is **two readings**, because git records no reviews.
- It runs fully offline, writes nothing but the map file you name, and never
  reads your source.

---

## The headline is one number, and you can check it

    dark(file)  ⇔  no human authored or prompted a commit touching it
                   inside the last 180 days

That is the scorer's own `human_author_recency` factor read at zero, not a
second derivation living in the CLI. A human-authored commit counts in full, a
mixed one — a person formed the intent, an agent produced the diff — counts at
the scorer's own quarter weight, and both words in *"wrote or prompted"* are
therefore load-bearing: a file somebody prompted last week is lit, and a
sentence claiming nobody had written any of it would be wrong in exactly the
direction that flatters the headline.

Nothing in it is a claim about anybody's head. It is a claim about a record,
reproducible from the same clone and the same clock with `git log`.

## What the dark share is not

It is not a comprehension-debt estimate and it never stands in for one. Dark
code can be thoroughly reviewed code that nobody has needed to touch in a year;
lit code can be code three people rewrote yesterday with nobody reading the
diff. The card prints both numbers, under two different headings, with the
denominator and the window named on each.

## `start here:` is advice, and the advice shows its working

The line under the headline names one file:

> `start here: components/Map.tsx · hand-written 300d ago · 1 human in its
> history`

It is deliberately an **imperative and not a superlative**. "The largest blind
spot" would be a measurement, and it is one the ordering does not support — the
row is the biggest *application* file of the biggest *group*, so a larger dark
file can easily sit in a smaller group or a lower tier. A false superlative in
the most-read line on the card is exactly what a tool like this cannot afford.

A recommendation cannot be false. What stops it being empty is that its whole
basis is printed with it: when a human last touched the file and by which hand,
how many humans are anywhere in its history — and the ordering that chose the
row is stated out loud in the section head a few lines below. Disagree with it
and you can see precisely what produced it.

It is row one of the ledger, so it is also the path the `factor by factor:`
line prints and the file `fathohm explain 1` resolves.

**"1 human in its history", not "bus factor 1."** They are the same count and
not the same sentence: a bus factor is a claim about an organisation — who
still works here, who else has read the file — and this reading has no view of
any of that. What git carries is how many humans appear in the file's commit
history, and that is what the row says. The factor keeps its name inside
`fathohm explain`, where it sits beside its weight and its contribution.

## The chart is a stacked bar, and it names its own cells

```
WHERE THE DARK CODE IS  ·  bar length = share of this repository
█ = gone dark     ░ = a human wrote or prompted it recently
app/                     ██░░░░░░░                            26% · 17% dark
components/              ████████░                            25% · 92% dark
workers/                 ░░░░░░░░                             21% · 0% dark
```

Two encodings, and neither can erase the other. The **length** of a bar is that
directory's share of the repository — `app/` is a quarter of the code. The
**solid run inside it** is how much of *that directory* is dark, which is a
share of the folder rather than of the repo, and is spelled out again in the
clause at the end of the row.

It used to be one glyph per bar, picked off a height ramp by the row's
darkness: taller block, darker directory. That reads well on a repository in
trouble and fails on a healthy one, because the ramp's bottom rung is `▁` — so
a directory with nothing dark drew as a hairline on the baseline, and a
repository with nothing dark anywhere printed a whole chart of underscores in
one flat colour. The encoding meant to carry the alarm was erasing the one
carrying the size.

Rounding is not allowed to flatter. A directory with **any** dark bytes draws
at least one solid cell, and a directory that is not **wholly** dark keeps at
least one light cell — except in a one-cell bar, which cannot hold a proportion
and goes solid, because "some dark" drawn as clean is the error that costs a
reader something.

With nothing dark anywhere the heading says what the block actually is —
`WHERE THE CODE IS` — rather than promising a map of something that is not
there.

## GONE DARK adds up, and that is the whole point of it

It is not a list of files with a banner over it. It is a decomposition: one
group per reason a file went dark, the files that carry it printed underneath
the group that describes them, and a column of percentages that sums — in
print, on the screenshot — to the number drawn at the top of the card.

The groups are a total, disjoint partition of exactly the file set the headline
is computed from, which is what makes *"the groups plus the coda are the whole
repository"* a property rather than a promise. The coda is the lit remainder:
`still lit — 55% of the code · a human wrote or prompted it inside the last 180
days`.

**The shares are allocated, not rounded.** Rounding each group on its own does
not add up: three groups of 33.3% print `33` three times, and a reader counts
99 against a headline of 100. So the arithmetic runs in one direction:

1. **the headline is the authority** — its printed value is computed exactly as
   it always was, and the ledger never moves it;
2. the dark groups share out exactly that many whole points by **largest
   remainder** — floor every exact percentage, then hand the leftovers to the
   largest fractions first;
3. the coda takes **what is left of a hundred**, rather than being rounded on
   its own. Two complementary shares rounded independently can both be correct
   and still print 101.

The one exception is a display floor. `<1%` and `>99%` are deliberately not
integer claims — a repository that is 99.9% dark must print `>99%` beside
`<1%`, because `100%` beside `0%` would claim a codebase with no human hand
anywhere in it. A group inside a floor prints its floor and is never handed a
point it could not show.

**Five file rows, shared across the groups by weight.** The row budget is
allocated the same way the percentages are, capped by what each group actually
holds. A group that ends up with no rows still prints its heading — the heading
is the finding, the rows are only evidence for it, and a small group
disappearing would be the decomposition quietly losing a term. When the entire
dark set weighs zero bytes — a tree whose only dark files are empty ones — the
rows are shared out by file count instead, because a byte-weighted share of
nothing is a division by zero rather than a judgement, and the section does not
get to vanish because its subject weighs nothing.

**A row is a path and two clauses**, and neither of them is a score. The
clauses are the file's newest human contact (hand-written, prompted, or none)
and how many humans are anywhere in its history — both read off the same
engagement record the heading above the row was built from, so a row can never
describe a different contact than the group it sits under. The score left the
row because the section is no longer selected on it; it is still in
`fathohm explain`, still in `--full`, and still in the closing block.

## Inside a group, application code comes first

The rows are ordered by three keys: **kind, then bytes, then path.**

Three tiers, read off the filename and the path segments, and nothing else:

| tier | what is in it |
| --- | --- |
| application code | everything else — what a reader would call "the code" |
| the scaffolding | config (`json`, `yml`, `toml`, `ini`, `Dockerfile`, `Makefile`), sql and `migrations/`, `scripts/`, `dist/`, `build/` |
| tests and styles | `*.test.*`, `*.spec.*`, `_test.`, `test_*`, `test/`, `tests/`, `__tests__/`, `e2e/`, and `css`/`scss`/`sass`/`less`/`styl` |

A test nobody has touched in a year is a different sentence from an API route
nobody has touched in a year, and the card has about four seconds to hand over
the second one. A test that lives under `scripts/` is a test — the further tier
wins.

**This is ordering only.** It enters no score, removes nothing from any count,
and changes no denominator: a demoted file is still dark, still in the roster,
still in the byte share the headline is computed from, and still printed when
it reaches the rows. A repository whose dark code genuinely is all tests gets
told so, because the list runs out of everything else before it runs out of
rows.

## Comprehension debt closes the card, as two readings

> `COMPREHENSION DEBT — git alone cannot measure it`

Git records commits. It does not record **reviews** — there is no such thing as
a pull-request review in a `.git` directory. A tool that scored your repository
with `human_review_depth = 0` and printed one number would be reporting *"not
measured"* as *"measured, and it was nothing"*, which would make a thoroughly
reviewed codebase look exactly like an unreviewed one. So the debt reading is a
pair:

- the **floor** is the record as it stands — no review counted anywhere,
  because git records none;
- the **ceiling** is the same record with full review credit for every file
  that went through a pull request.

**The range between them is your unmeasured review record.** As much of it as
git can point at, which is the catch, and the reason this pair is no longer the
headline: the ceiling is only handed to a file git can see was PR-mediated — it
was touched by a merge commit, or by a commit whose subject ends `(#1234)`,
GitHub's squash convention. A squash-merged pull request that leaves neither
marker leaves nothing for the ceiling to credit, however carefully it was
reviewed.

So the card prints them as **two labelled readings and nothing else**: each is
one reading of the same record, nothing in git says which is right, and the App
is what settles it. It never says the truth sits between them. That phrasing
sounds like humility and is a claim about a distribution nobody has measured —
worse, it is testably wrong in one direction, because the hosted number for a
squash-merging repository can land outside the interval rather than inside it.

The **TREND** block lives here for the same reason: it plots the debt interval
over the past year against the files you have today, and a trend printed a
dozen lines away from the quantity it belongs to is two unexplained numbers on
one card.

It used to open with a sparkline — twelve monthly cells, a rule, today, a rule,
the forecast. It had no axis, the two rules separating measurement from
prediction were never named, and every cell plotted the *floor* while the rows
underneath print the *interval*, so on a repository whose floor had fallen the
picture read "better" beside a row ending `>99%`. Fifteen characters, four ways
to be misread. The rows carry every fact it carried and label themselves.

It draws **only the months git's record covers**. Every point is a full reading
at a moved clock, so at any instant before the first commit every file reads as
though nothing had ever been written to it, and the point renders `100%` —
which on a ten-week-old repository filled ten of the twelve cells with a
year-long cleanup that never happened. When the
record is shorter than the window the strip says so, with the date you can
check:

> `git's record here starts 2026-06-05, so there is no full year to draw.`

The stops are **rows, not an arrow chain**. Each stop is an interval and an
interval already contains a separator, so `2025-07-31: 100% → today: <1% →
2026-11-12: 14% – >99%` put two lookalike separators on one line meaning
opposite things, and mixed bare values with pairs depending on whether the
interval happened to be zero-width. One stop per line, share in a right-aligned
column. A series that never moves collapses to a single sentence rather than
printing the same interval three times.

## The provenance block says what could not be seen

Every card ends with what the reading did not have. One line of it is
permanent, on every reading, with nothing to trigger it:

> authorship is declared, not detected: undeclared agent work reads as human.

Agent authorship is detected from things an agent declares: a
`Co-Authored-By:` trailer, a recognized committer signature (`claude_code`,
`copilot`, `cursor`). An agent that signs nothing is indistinguishable from a
person typing. So **every agent-share number fathohm prints is a floor**, never
an estimate and never a ceiling.

The conditional lines join it when they apply: a shallow or grafted clone gets
a loud `PARTIAL READING` banner (and `fathohm check` exits 3 rather than
passing or failing on a fragment); a `--since` window, an `--at` ref, skipped
submodules, `.fathohm.toml` exclusions and a `--without` that matched nobody
all get a line of their own.

## Nothing to fathom is its own answer

An empty repository, a tree with no code in it, a tree whose code files are all
empty: these print *"nothing to fathom here yet"* and exit 0. You will never
get a `0%` or a `100%` screenshot out of a repository the tool could not
actually see into.

A genuine zero is not that case, and it does not get a reassuring sentence
either. A repository where a human wrote or prompted everything this month is
`0%` dark and can still be entirely in comprehension debt — so the zero card
does two things differently. It **banners** the result instead of drawing it at
the size of a claim (a five-row `0%` under the words GONE DARK reads as either
direction until you already know the vocabulary), and it **prints the wider
reading's own share in the lede** rather than pointing at a block a screen
below. Here that number is `100%`, and you meet it in the fourth line:

```
FATHOHM — git-only reading of prompted-only (6 code files)
2026-07-31T00:00:00Z · scorer v4

  None of this code has gone dark: a human wrote or prompted every one of
  these 6 files within the last 180 days.

  100% of it is code no human has recently written, reviewed, or explained —
  the question git cannot close alone. The block below decomposes it.

  Every one of these 6 files has exactly one human in its history: when that
  person stops committing, nothing keeps the file lit.

  to see who they are: fathohm team

  WHERE THE CODE IS  ·  bar length = share of this repository
  src/                     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░     91%
  test/                    ░░                                    7%
  ./                       ░                                     3%

  authorship is declared, not detected: undeclared agent work reads as human.

  ────────────────────────────────────────
  COMPREHENSION DEBT — git alone cannot measure it
  Comprehension debt: code no human has recently written, reviewed, or
  explained — measured from the record, not a survey.
    100% here, and it is exact: nothing counted as debt ever went through a
    pull request, so no review credit could lower it.

  TREND — today's files, re-scored as of each date
    100% throughout, unchanged over the 3 months read, and unchanged in 90
    days with no new commits.
  git's record here starts 2026-04-02, so there is no full year to draw.

  git does not record PR reviews. The GitHub App reads them and settles which
  reading is right — https://fathohm.dev

  no telemetry, no network: this reading used only your local git history.
  Verify by running it offline.
```

**A zero can also mean "the dark files weigh nothing".** The headline is
byte-weighted and the dark set is a predicate, so an empty code file —
`__init__.py`, `py.typed`, a placeholder `index.ts` — is dark and weighs
nothing, and a repository whose only dark files are empty ones reads `0%` while
the ledger still names them. That reading gets its own sentence rather than the
one above:

> `The 2 files that have gone dark here are empty, so they weigh nothing: every
> file with code in it was written or prompted in the last 180 days. The ledger
> below names them.`

…and then, like every zero card, the wider reading's own share in the same
breath.

The card that said *"Nothing here has gone dark"* while `--full` listed the
files, `explain 1` resolved one and `--json` carried them was reporting a
weight as a count.

## What the practice a rung asks for is called

fathohm computes a mechanism and stops there — the card names files and factors,
never techniques. The practice the field has converged on for the reading itself
is **explain-back review** (*"can you explain this without referencing the
prompt?"*) and **system walks**; that vocabulary is not ours and it is not on the
card, but it is what a rung is asking somebody to do. The hosted product's
verification loop is built on it.

## It runs fully offline

fathohm opens no socket. Not for telemetry, not for a version check, not for
the hosted product.

**Verify it behind a firewall:** disconnect the machine, or drop all egress,
and run every command. Nothing changes, because there is nothing to change —
the bundle contains no `http`, `https`, `net`, `dns` or `tls` import, no
`fetch(`, no `WebSocket`. There is a test in this repository that greps both
the source *and* the built bundle and fails if one appears. The single URL that
appears anywhere in the output (`https://fathohm.dev`) is a string in a
sentence; there is no code that could fetch it.

It also has **zero runtime dependencies**. One bundled file, no `postinstall`,
Node ≥ 20.9.

## It never writes to your repository

Every command is a read: `git log`, `git ls-tree`, `git rev-parse`. The one
exception is `fathohm map`, which writes exactly one HTML file — the path you
named — and refuses to write inside `.git`.

Source code is never read. Not sampled, not hashed, not sent anywhere: the tool
reads commit metadata (messages, authors, dates, the paths each commit touched)
and the byte size of each file in the tree. It has no code path that opens a
file in your working tree.
