# fathohm

**How much of your code has gone dark — no human wrote or prompted any of it
inside the last 180 days? A git-only, offline reading, printed as one number
you can check against your own `git log`.**

```
npx fathohm
```

No install, no account, no config file, no network. Point it at a repository
and it prints a card.

Or keep it on your PATH:

```
npm install -g fathohm
fathohm
```

Or see the number in your editor's status bar, with the
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=fathohm.fathohm-vscode).

```
FATHOHM — git-only reading of acme-api (12 code files)
2026-07-31T00:00:00Z · scorer v4

  █  █  ████  ██   ██
  █  █  █     ██  ██
  ████  ████     ██    GONE DARK
     █     █    ██ ██
     █  ████   ██  ██

  45% of this code has gone dark: no human has written or prompted any of it
  in the last 180 days (exact — git records every commit's author and date).

  start here: components/Map.tsx · hand-written 300d ago · 1 human in its
    history

  9 of 12 files — 70% of the code — have exactly one human in their history:
  when that person stops committing, nothing keeps the file lit.

  to see who they are: fathohm team

  WHERE THE DARK CODE IS  ·  bar length = share of this repository
  █ = gone dark     ░ = a human wrote or prompted it recently
  app/                     ██░░░░░░░                            26% · 17% dark
  components/              ████████░                            25% · 92% dark
  workers/                 ░░░░░░░░                             21% · 0% dark
  lib/                     ██████░                              20% · 82% dark
  cli/                     ░░                                    6% · 0% dark
  ./                       █                                    <1% · 100% dark

  GONE DARK (nobody wrote or prompted it in 180d)
  application code first · config, sql, scripts · then tests & styles

  HAND-WRITTEN, BUT 220+ DAYS AGO — 45% OF THE CODE
  components/Map.tsx  hand-written 300d ago · 1 human in its history
  lib/map-tree.ts     hand-written 220d ago · 2 humans in its history
  lib/palette.ts      hand-written 220d ago · 2 humans in its history
  app/layout.tsx      hand-written 400d ago · 1 human in its history
  package.json        hand-written 400d ago · 1 human in its history

  still lit — 55% of the code · a human wrote or prompted it inside the last
  180 days (7 files)

  factor by factor: fathohm explain components/Map.tsx

  authorship is declared, not detected: undeclared agent work reads as human.

  ────────────────────────────────────────
  COMPREHENSION DEBT — git alone cannot measure it
  Comprehension debt: code no human has recently written, reviewed, or
  explained — measured from the record, not a survey.
    72%  if no pull request here was ever reviewed in depth — git records no
         reviews, so this is the record as it stands
    24%  if every pull request was reviewed in depth
  git cannot say which. That is the gap, not a margin of error.

  TREND — today's files, re-scored as of each date
    12 months ago       35%
    today         24% – 72%
    in 90 days    35% – 86%   with no new commits
  next file to cross into debt: app/api/route.ts (2026-08-05)

  git does not record PR reviews. The GitHub App reads them and settles which
  reading is right — https://fathohm.dev

  no telemetry, no network: this reading used only your local git history.
  Verify by running it offline.
```

That is the tool's own reading fixture — the one its golden tests pin — printed
by the same code that will print yours. Every block in this README comes out of
the CLI rather than out of a draft.

The big number is the **dark share**: the byte share of the code where no
commit authored or prompted by a human lands inside the scorer's 180-day
window. Not an interval, not an estimate, and nothing about what anybody knows
— git records every commit's author and date, so this is the one question a
local reading can close.

**Comprehension debt** — *code no human has recently written, reviewed, or
explained, measured from the record, not a survey* — is a different question,
and the card carries it in a closing block rather than in the headline. The
term is [Jason
Gorman's](https://codemanship.wordpress.com/2025/09/30/comprehension-debt-the-ticking-time-bomb-of-llm-generated-code/),
from September 2025, and was carried much further by [Addy
Osmani](https://addyosmani.com/blog/comprehension-debt/) in March 2026; fathohm
is an instrument for it, not a coinage of it.

---

**Two more documents, both in this package's repository:**
[METHODOLOGY.md](https://github.com/fathohm/cli/blob/main/cli/METHODOLOGY.md) —
every claim below, and what backs it.
[CHANGELOG.md](https://github.com/fathohm/cli/blob/main/cli/CHANGELOG.md) —
what moved in each release, and why.

---

## Two questions, and git can only close one

| The question | What answers it | What it needs |
| --- | --- | --- |
| **Who has left the building?** Which code has nobody written or prompted lately. | `fathohm read` — this CLI | your clone. Git carries every commit's author and date, so the answer is complete and offline. |
| **Did anybody actually read it?** Comprehension debt: code no human has recently written, reviewed, or explained. | the hosted GitHub App | the pull-request review record — reviews, comments, approvals — which is not in a `.git` directory at all. |

They are not two estimates of one quantity, and they do not track each other. A
file three people rewrote last week and nobody reviewed is lit and in debt; a
file five people reviewed carefully two years ago is dark and cheap. Both
sentences are true, about different things.

---

## The honesty model

Six claims. Each one is checkable, and the reasoning behind every one of them is
in [METHODOLOGY.md](https://github.com/fathohm/cli/blob/main/cli/METHODOLOGY.md)
rather than compressed into an aside here.

**The headline is one number, and you can check it.**

    dark(file)  ⇔  no human authored or prompted a commit touching it
                   inside the last 180 days

That is the scorer's own `human_author_recency` factor read at zero, not a
second derivation living in the CLI. Both words in *"wrote or prompted"* are
load-bearing: a file somebody prompted last week is lit, and a sentence claiming
nobody had written any of it would be wrong in exactly the direction that
flatters the headline.

**Nothing in it is a claim about anybody's head.** It is a claim about a record,
reproducible from the same clone and the same clock with `git log`.

**Every agent-share number is a floor.** Agent authorship is detected from what
an agent declares — a `Co-Authored-By:` trailer, a recognised committer
signature. An agent that signs nothing is indistinguishable from a person
typing, so every card carries that sentence permanently, with nothing to trigger
it.

**Comprehension debt is two readings, not one.** Git records commits; it does
not record reviews — there is no such thing as a pull-request review in a `.git`
directory. A tool that scored `human_review_depth = 0` and printed one number
would report *"not measured"* as *"measured, and it was nothing"*. So the card
prints a floor (no review counted anywhere) and a ceiling (full credit for every
file git can see went through a pull request), as two labelled readings. It
never says the truth sits between them: that sounds like humility and is a claim
about a distribution nobody has measured.

> Comprehension debt: code no human has recently written, reviewed, or explained
> — measured from the record, not a survey.

**The dark share is not a comprehension-debt estimate** and never stands in for
one. Dark code can be thoroughly reviewed code nobody has needed to touch in a
year; lit code can be code three people rewrote yesterday with nobody reading
the diff. The card prints both, under two headings, with the denominator and the
window named on each.

**It runs offline, writes nothing, and never reads your source.** No socket —
not for telemetry, not for a version check. Disconnect the machine and run every
command; nothing changes, because the bundle contains no `http`, `https`, `net`,
`dns` or `tls` import, no `fetch(`, no `WebSocket`, and a test greps both the
source and the built bundle. Every command is a read (`git log`, `git ls-tree`,
`git rev-parse`); the one exception is `fathohm map`, which writes exactly the
one HTML file you name and refuses to write inside `.git`. Source code is never
read — not sampled, not hashed, not sent anywhere. Zero runtime dependencies,
one bundled file, no `postinstall`, Node ≥ 20.9.

**And nothing to fathom is its own answer.** An empty repository, a tree with no
code in it, a tree whose code files are all empty: these print *"nothing to
fathom here yet"* and exit 0. You will never get a `0%` or a `100%` screenshot
out of a repository the tool could not see into.

---

## Commands

Every command takes `[path]` — the repository to read, defaulting to the
working directory.

| Command | What it does |
| --- | --- |
| `fathohm read` *(default)* | The reading card: the dark share, one file to start on, where the dark code is, the `GONE DARK` ledger (one group per reason, five file rows shared across them), the provenance, and the comprehension-debt block with its trend. |
| `fathohm explain <file\|n>` | One file, factor by factor — what the score is made of, and the day it crosses the line. |
| `fathohm fade` | The files that cross the line next, soonest first. |
| `fathohm check` | The gate. Exits 1 when too much of the repository sits below the line. `--format markdown` prints the same verdict as a paste for a pull request. |
| `fathohm map` | Writes a self-contained treemap — one HTML file, no requests. |
| `fathohm offboard <author>` | The reading the day one person leaves: the same scorer, run without them. |
| `fathohm team` | The humans in this history, and how much code carries one name. |
| `fathohm paydown` | What a recorded, commented review would return, rung by rung. |

`read` is the dark share. Everything else is the score: `explain` decomposes it,
`fade` forecasts it, `check` gates it, `paydown` prices it down, `offboard`
re-runs it without one person, and `map` draws it.

Because `map` draws the score, its page headlines the comprehension-debt
interval rather than the dark share — the rectangles are coloured by
comprehension score, so headlining a number the picture does not encode would
be the contradiction moved inside one file. It prints the dark share underneath
it, labelled and named as the card's headline, and the note the terminal leaves
behind repeats the same two numbers in the same words: a screenshot of the page
and a screenshot of the card can then be told apart rather than argued over.

The page carries a **Copy as PNG** button under the treemap (a Download PNG
where the clipboard API is not available, and it says which before you press
it). It re-draws the page's own svg at 2× onto a canvas in your browser — the
same rectangles, the same ink, the labels and strokes carried across — so what
lands on the clipboard is the picture the file draws rather than a crop of a
window. The file stays self-contained: nothing is fetched to do it, and nothing
is uploaded.

### `explain` takes a row number

The card's **GONE DARK** section is a numbered list whether or not it prints
the numbers, so `explain` accepts the position instead of the path:

```
fathohm explain 3
```

`3` is the third dark file **in the order the card prints them**: group by
group down the ledger, and inside each group application code first,
scaffolding next, tests and styles last. `explain 1` is the file the card's
`start here:` line names, and the file the section leads with.

Two things worth knowing about the numbering:

- **It covers every dark file**, not only the five rows the card shows, so
  `explain 12` works on a card that ended with *"N more gone dark"*. That
  also means the five printed rows are a *subsequence* of the numbering rather
  than `1`–`5`: the card shares its row budget across the groups, and numbering
  the printed rows instead would make `3` mean different files on `read` and
  `read --full`. Every path the card prints is printed in full, for the times a
  number is not what you want.
- **Group headings are not rows.** They are the card's typography; only files
  are numbered, and the picker never puts a cursor on one.

Two rules keep it honest:

- **A real path always wins.** If the repository contains a file literally
  named `3`, `fathohm explain 3` explains that file. A convenience never
  shadows somebody's source.
- **Out of range is a usage error**, exit 2, and the hint names the range the
  reading actually has (*"the reading has N dark files — 1 through N"*). On a
  repository where nothing has gone dark it says that instead of offering a
  range.

### `check --format markdown` — the verdict, where it gets argued

```
npx fathohm check --max-blind 10 --format markdown
```

```
## fathohm check — FAIL

*acme-api · 2026-07-31T00:00:00Z · scorer v4*

FAIL — even with full credit for every review git cannot see, 24% of this repository sits below the line (22K of the 92K read), over your limit of 10%.

Comprehension debt: code no human has recently written, reviewed, or explained — measured from the record, not a survey.

**Where the dark code is** — no human wrote or prompted these in the last 180 days. A different cut from the line above, and the first three the reading names, in its own order (group, then application code, then bytes):

- `components/Map.tsx` — hand-written 300d ago · 1 human in its history
- `lib/map-tree.ts` — hand-written 220d ago · 2 humans in its history
- `lib/palette.ts` — hand-written 220d ago · 2 humans in its history

---

Reproduce it on any clone: `npx fathohm check --max-blind 10` — git metadata only, no network, nothing written.

Authorship is declared, not detected: undeclared agent work reads as human. Git records no pull-request reviews; the hosted reading does — https://fathohm.dev
```

**It is the same verdict, not a second one.** The word and the sentence come out
of the functions the terminal prints, and the exit code is computed before
anything picks a format — a build that went green in one form and red in the
other would be two gates wearing one name.

**It states its subject and its clock**, because a comment outlives the
terminal that produced it and a percentage with no repository and no date on it
is a number somebody quotes next quarter.

**Two cuts, never blurred.** The verdict is about the comprehension line; the
paths under it are the dark list, which is a different predicate and is
labelled as one. The three files did not cause the number, and the copy does
not imply they did.

`--json` is the machine's form and is unchanged. Passing both is a usage error:
whichever one silently won, half the people who typed both would be surprised.

### `--scope <dir>` — reading one directory

```
npx fathohm read --scope lib
```

```
FATHOHM — git-only reading of acme-api/lib (3 code files)
2026-07-31T00:00:00Z · scorer v4
Reading: lib/ — 3 files, 18K, scoped; the repository's own number is different
```

`read`, `explain`, `fade`, `team`, `paydown` and `offboard` take it. It is not
a filter on a list — it moves the **denominator**: the subtree becomes the
whole reading, so the headline, the `GONE DARK` ledger, the mini-map, the
trend and the `--json` document all divide by the bytes under that directory.
It reaches the tree through the same seam `.fathohm.toml`'s `exclude` uses,
which is what makes "all of them or none of them" a property rather than a
promise.

**Every scoped card says so, in the header, in a sentence.** `82% gone dark`
about `lib/` and `82% gone dark` about a repository are the same eleven
characters, and the flag scrolls off the screen long before the screenshot
does. So the subject names the subtree (`acme-api/lib`), the sentence under it
names the file count and the byte count it divided by, and the mini-map's
heading says *share of this reading* rather than *share of this repository*.

**A scope that matches nothing is a usage error**, exit 2 — never a card. A
typo would otherwise print `nothing to fathom here yet` and exit 0: a true
sentence about the wrong subject, which reads as good news.

**`check` does not take it.** A gate's output is an exit code that a pipeline
acts on without reading a word of the card, so a scoped verdict has no sentence
available to qualify it — a build could go green on one tended corner of a
codebase nobody read. The error says that, and names the two commands that
answer the two questions separately.

The path is read from the repository root (not from where you are standing),
`./lib`, `lib` and `lib/` are one directory, and an absolute path or a `..`
segment is refused rather than resolved.

### On a terminal, the card is followed by a picker

Run `fathohm` in a terminal with a keyboard attached and the five rows of
**GONE DARK** appear again underneath the card, with a cursor on them:

```
❯ components/Map.tsx  hand-written 300d ago · 1 human in its history
  lib/map-tree.ts     hand-written 220d ago · 2 humans in its history
  lib/palette.ts      hand-written 220d ago · 2 humans in its history
  app/layout.tsx      hand-written 400d ago · 1 human in its history
  package.json        hand-written 400d ago · 1 human in its history
  ↑/↓ pick a file · enter: factor by factor · q: quit
```

Arrows (or `j`/`k`) move; **enter** prints `fathohm explain` for that file,
permanently, above the picker; `q`, `Esc` and `Ctrl-C` leave. **There is no
alternate screen**: the card stays exactly where it was printed, the picker
only ever erases its own lines, and quitting leaves your scrollback with the
reading in it.

**It appears only when all of this is true**, and never otherwise:

- both stdout **and** stdin are terminals — `fathohm | less`, `fathohm > card.txt`
  and `printf q | fathohm` all print the plain card and exit;
- `CI` is unset and `TERM` is not `dumb`;
- the command is `read` — `check`, `fade`, `map` and `explain` are answers, not
  menus;
- no `--json`, no `--full`, no `--quiet`;
- something has actually gone dark.

When any of those fails, the output is byte-for-byte the output it has always
been. Determinism is a contract, and a menu appended to a captured reading
would break it in the one place nobody looks.

`--no-interactive` turns it off on a terminal that qualifies.

### `offboard` — the reading the day somebody leaves

```
npx fathohm offboard priya
```

```
FATHOHM — git-only reading of acme-api without priya (simulated)
2026-07-31T00:00:00Z · scorer v4
their commits stay in git's record — the simulation removes their engagement
from every factor

  ████  ████  ██  █
  █  █  █     ██ █
  ████  ████    █    comprehension debt without priya
  █  █     █   █ ██
  ████  ████  █  ██

  85% of this code would sit below the comprehension line the day priya leaves
  — up from 43% today (worst case, git evidence alone)
  best case 51%, up from 9%: full review credit for every file that went
  through a PR — both recomputed through the same scorer, not estimated
  the comprehension line: below it, no human has recently written, reviewed,
  or explained it

  Comprehension debt: code no human has recently written, reviewed, or
  explained — measured from the record, not a survey.

  3 files — 32K, 25% of the scored code — have priya as the only human in
  their history

  HANDOVER  ·  crosses the line without priya, application code first
  0.33 → 0.00  lib/billing/invoice.ts     only human in its history
  0.33 → 0.00  lib/billing/proration.ts   only human in its history
  0.41 → 0.08  app/api/webhooks/route.ts  newest human commit falls to 200d ago
  0.34 → 0.26  lib/tax/rates.ts           1 of 2 humans in its history
  0.32 → 0.24  app/jobs/retry.ts          1 of 2 humans in its history

  1 more cross with them gone: fathohm offboard priya --full
  removing a person never raises a file's score — everything below the line
  today stays below

  factor by factor, after they leave: fathohm explain lib/billing/invoice.ts
  --without priya

  authorship is declared, not detected: undeclared agent work reads as human.

  ────────────────────────────────────────
  git does not record PR reviews. The GitHub App reads them — who reviewed
  priya's files is evidence this simulation cannot see.
  install the GitHub App → https://fathohm.dev

  no telemetry, no network: this reading used only your local git history.
  Verify by running it offline.
```

This one is a comprehension-debt reading, not a dark one, and deliberately: the
question is what a departure does to the score, and the score is where losing a
reviewer shows up.

**It is `scoreRepo` run twice.** Once on the history as it stands, once on the
same history with one more name in `--without`. There is no departure model and
no second scorer — the answer to *"how did you get 85%"* is *"we ran the scorer,
here is the other run"*, and you can produce both yourself from the same clone.

**Their commits stay in git.** Nothing is rewritten and nothing is deleted. What
the second reading removes is their **engagement**: their events stop counting,
so recency re-maxes over whoever is left, the bus factor loses their weight, and
the buckets re-derive.

**Removing a person never raises a file's score.** Every factor is a maximum
over events, and taking events away cannot raise a maximum — so the card can
state it as a fact about the scorer rather than as an observation about your
repository. It is held as a property test over generated histories.

**The clause on each row names the factor that moved**, read off the two factor
sets, and the lexicon is closed:

| Clause | What changed |
| --- | --- |
| `only human in its history` | The file's human contributor count went to zero. |
| `newest human commit falls to <N>d ago` | The most recent human contact moved back to somebody else's commit. |
| `1 of <n> humans in its history` | The contact date did not move; the count did. |

A file that answers more than one is described by the worst of them.

**A name that finds nobody says so.** It does not come back as an unchanged
reading that reads like good news: the card says the reading is unchanged, and
the provenance block prints the miss with a next step.

`--without` composes here. `fathohm offboard priya --without sam` removes sam
from **both** readings and simulates losing priya on top of that.

### `team` — the humans in this history

```
npx fathohm team
```

```
FATHOHM — git-only reading of acme-api · the humans (3 in its history)
2026-07-31T00:00:00Z · scorer v4

  SOLE-KEEPER LOAD  ·  code with one human name in its history, largest first
  priya      3 files    32K  ▆▆        25% of the scored code
  sam        1 file     15K  ▆         12%
  marco      1 file    3.9K  ▆          3%
  shared     4 files    22K  ▆         17% · 2+ human names
  no human   3 files    55K  ███       43% · agent-authored, by declared signals

  five rows, one denominator: they partition the 128K of scored code

  THE DAY THEY LEAVE  ·  the whole reading, recomputed without each person
                         (worst case, git evidence alone)
  without priya       43% →  85%   +42 points
  without sam         43% →  60%   +17
  without marco       43% →  51%    +8

  the handover for one person: fathohm offboard priya

  authorship is declared, not detected: undeclared agent work reads as human.
```

**Every row measures code, and no row measures a person.** `priya · 3 files ·
32K · 25%` is a statement about a repository: this much of it has one name in
its history. There is no per-person score here and there will not be one — git
shows who committed, and a league table built on that ranks people by how often
they were the only one around, which is a fact about how work was handed out
rather than about them.

**The rows are a partition.** Every scored file carries exactly one human name,
more than one, or none, so the five rows divide the same bytes the headline
divides, and the printed integers are allocated to a hundred by the same
largest-remainder rule the ledger uses. The sentence under the table says so, so
you can add the column yourself.

**Who counts as a name in a file's history** is exactly who the scorer counts: a
commit whose authorship is `human` or `mixed`. A merge-button press is an
approval with no comments, which is weightless — pressing merge does not put
your name in a file's history. An agent committing under its own identity is
weightless too, which is what makes the `no human` row mean something.

**The leave column is `offboard`, run once per identity** — the same scorer,
keyed on exactly the identity each row names, so `fathohm offboard <their
email>` prints the same number. A NAME query can honestly differ in one case
only: when two identities share the name, the query removes both — which is a
query doing what a query says, while each leave row still removes one person.
When the two ends print the same integer it says *"moves nothing the card
prints"* rather than inventing a `+0`.

Below one printed percent, keepers fold into a single row that still carries
their bytes (*"and N more · none the only name on more than …"*), so the
column adds up either way. `--full` lists everybody.

The reading card's `to see who they are: fathohm team` line is the route in. It counts
the files with exactly one human anywhere in their history and prints the byte
share beside them — *"9 of 12 files — 70% of the code"* — with the count first,
because a file count cannot be added to the byte shares elsewhere on the card
and leading with one makes that obvious. That is the dark share asked forward,
and it is a conditional rather than a deadline: when that one person stops
committing, nothing keeps the file lit. Some of those files are already dark,
so *"it goes dark 180 days after they stop"* would be promising a future that
is somebody's past. Unlike the review record, this is something git knows
completely.

Under `--without`, the route carries the simulation — `fathohm team --without
<name>` — so the card it sends you to reads the same history the sentence above
it just counted.

### Paying it down

**Comprehension debt paydown** — plainly: what would have to be read, by a
human, for the debt share to come down, and what it would read afterwards. That
is one command:

```
npx fathohm paydown --max-blind 40
```

The card below carries `--max-blind 40` because a ladder is more useful beside a
target than on its own: the flag is what produces the closing gate line, and
`.fathohm.toml`'s `max-blind = 40` sets the same thing without the flag. Bare
`npx fathohm paydown` prints everything here except that last line.

```
FATHOHM — git-only reading of acme-jobs · the paydown ladder
2026-07-31T00:00:00Z · scorer v4
git records no reviews — every rung below is this reading re-scored as if one
existed

  ██    ████  ████  ██  █
   ██   █  █  █  █  ██ █
    ██  ████  ████    █    comprehension debt
   ██      █     █   █ ██
  ██    ████  ████  █  ██

  >99% of this code scores below the comprehension line on git evidence alone
  (worst case)
  best case 66%: the same evidence with full review credit for every file that
  went through a PR — git does not record reviews
  the comprehension line: below it, no human has recently written, reviewed,
  or explained it
  the ladder is the other question — not a review that already happened and
  went unrecorded, but one that has not happened yet

  Comprehension debt: code no human has recently written, reviewed, or
  explained — measured from the record, not a survey.

  8 files sit below the line — 121K of the 122K read. A recorded, commented
  review lifts every one of them over it: the record weighs more than the line
  itself.

  THE LADDER  ·  what a recorded, commented review would return, cumulative
  1 file   >99% →  80%
  3 files  >99% →  48%
  5 files  >99% →  22%
  8 files  >99% →   0%

  THE FILES  ·  the ladder, in order: application code first
  0.08 → 0.48  src/agents/router.ts   23K
  0.07 → 0.47  src/ui/App.tsx         21K
  0.08 → 0.48  src/agents/planner.ts  19K
  0.08 → 0.48  src/ui/Board.tsx       17K
  0.07 → 0.47  src/api/jobs.ts        15K

  3 more on this ladder: fathohm paydown --max-blind 40 --full
  factor by factor: fathohm explain src/agents/router.ts

  with a recorded, commented review of 3 files: fathohm check --max-blind 40
  passes — the gate reads the best case, the ladder the worst

  authorship is declared, not detected: undeclared agent work reads as human.

  ────────────────────────────────────────
  git does not record PR reviews. The GitHub App reads them — a review that
  actually happened moves this number, and the weekly digest carries the move.
  install the GitHub App → https://fathohm.dev

  no telemetry, no network: this reading used only your local git history.
  Verify by running it offline.
```

**A rung is the scorer, run again.** Rung *N* is the whole reading re-scored
with a recorded, commented review on the first *N* files of the ladder —
cumulative, and re-tested file by file against the line.

**This is the number a review actually moves.** The reading card's headline is
not: recency is a fact about who authored a file, so reading it carefully
changes nothing about whether it is dark. That is why the ladder lives here and
why the card no longer closes its file list with a review recommendation.

**Nothing on this card has happened.** Git holds no review record, so every
rung is conditional and every verb says so. The experiment that checks it is:
record those reviews, run it again.

**It claims nothing git cannot carry.** No hours, no "quick win", no
difficulty — and it is not the cheapest path either: the ladder is ordered the
way every other surface orders files, so a byte-greedy set would reach any given
share in fewer files. What the ladder knows is how many files, how many bytes,
and what the scorer returns. Calling it the shortest route would be a claim you
could refute from the same clone.

**The interval and the ladder are two different questions**, and the card says
so out loud because they sit four lines apart. The *ceiling* is what a review
that **already happened** and left no trace could be worth — which is why it
credits only files that went through a pull request, since a file that never
did cannot be hiding a PR review. The *ladder* is a review that has **not
happened yet**, on any file at all. That is why a rung can land below the best
case.

**When a rung moves nothing the card prints, there is no ladder.** Four rows
carrying one number are a leverage claim refuting itself, so the card says it
in a sentence instead — and only calls it *"moves nothing this card prints"*
when the other end and the gate line are still too.

**`--max-blind` makes it answer your gate.** Give it the limit `fathohm check`
uses (or put it in `.fathohm.toml`) and the card names the rung your build goes
green at, through `check`'s own comparison:

```
with a recorded, commented review of 3 files: fathohm check --max-blind 40
passes — the gate reads the best case, the ladder the worst
```

`check` gates the ceiling by default and the rungs print the floor, so the line
names which end it was answered at. `--pessimistic` moves the gate to the floor
— the same end the ladder reads — and travels into the printed command.

**Every command the card prints reproduces the card.** A `--without` baseline
and the gate flags both travel into `fathohm paydown … --full`, and the
baseline travels into the `fathohm explain` cross-reference: a command that
hands you different numbers than the rows you just read is worse than no
command.

### Global options

| Flag | |
| --- | --- |
| `--now <iso>` | Read the repo as of this instant. Default: the wall clock — a stale repo must read stale. |
| `--since <iso>` | Ignore all history before this instant. |
| `--json` | Emit the reading as JSON instead of text. Every command supports it. |
| `--no-color` | Never emit ANSI colour. `NO_COLOR` and a non-TTY stdout do the same. |
| `--ascii` | ASCII-only glyphs, for CI logs and consoles that mangle box-drawing. |
| `--light` | Colours for a light terminal background. Without a flag, fathohm reads `COLORFGBG` when the terminal sets it. |
| `--dark` | Colours for a dark terminal background — the default when nothing says otherwise. |
| `--quiet` | One line — the dark share and the comprehension-debt interval — plus the provenance. |
| `--debug` | Print stack traces on failure. |
| `--version`, `-V` | Print the CLI and scorer versions. |
| `--help`, `-h` | Print usage, or a command's own options. |

`--quiet` is the machine's view, and it carries both numbers so neither can be
quoted without the other:

```
FATHOHM — git-only reading of acme-api (12 code files)
2026-07-31T00:00:00Z · scorer v4

  45% gone dark · comprehension debt 24% – 72%

  authorship is declared, not detected: undeclared agent work reads as human.
```

### Per-command options

| Flag | Command | |
| --- | --- | --- |
| `--at <ref>` | `read` | Read the repo as it stood at a git ref. Moves the clock to that commit's own date. |
| `--without <author>` | `read` `explain` `fade` `check` `offboard` `paydown` | Read as if this person had never been here. Repeatable. Warns if the name matched nobody. On `explain`, the header says the reading is simulated. |
| `--full` | `read` `offboard` `team` `paydown` | The whole list rather than the part that fits: every dark path, every crossing, every name, every file on the ladder. |
| `--no-interactive` | `read` | Never offer the picker under the card, terminal or not. |
| `--horizon <days>` | `fade` | How far ahead to look for crossings. Default `90d`. |
| `--max-blind <pct>` | `check` `paydown` | How much of the repository may sit below the line, 0–100. Required by `check`; optional on `paydown`, where it names the rung the gate starts passing at. |
| `--pessimistic` | `check` `paydown` | Measure the limit against the interval's floor rather than its ceiling. |
| `--format <text\|markdown>` | `check` | The gate as a terminal card (default) or as markdown to paste. Never with `--json` — that is a usage error, not a preference. |
| `--scope <dir>` | `read` `explain` `fade` `team` `paydown` `offboard` | Read one subdirectory, with its own denominator. The card says which. Not `check`: a gate is a contract about the repository. |
| `--out <file>` | `map` | Where to write the treemap. Default `fathohm-map.html`. |

On `read`, `--full` prints every dark path largest first, and it is the one
place a comprehension **score** sits on a row — a reader who asked for the long
list is past the risk that the number reads as the reason the file is listed:

```
  gone dark, largest first (5 files)
  comprehension score at the floor (0—1, higher is better) · size · path
  0.083    21K components/Map.tsx
  0.167   8.9K lib/map-tree.ts
  0.167   6.3K lib/palette.ts
  0.083   4.1K app/layout.tsx
  0.083   900B package.json
```



`check` gates the **ceiling** by default — the reading with the missing review
record at its most generous. A repository that fails the ceiling has failed the
best case the evidence allows, which is the only kind of build failure worth
arguing about at five o'clock.

Determinism is a contract: `(repo state, --now, flags)` produces byte-identical
stdout. Every card prints the clock it was read by and the scorer version it
was read with.

---

## `.fathohm.toml`

Optional, read from the repository root and **never written**. fathohm does not
walk up to `$HOME`: a gate you cannot reproduce from what you can see is the
failure mode a gate exists to avoid.

```toml
# what `check` will tolerate below the line, 0–100
max-blind = 40

# globs whose files leave the reading's denominator entirely
exclude = ["dist/**", "vendor/**"]

# how far ahead `fade` looks for crossings
horizon = "90d"
```

**The grammar is a deliberate TOML subset**, hand-rolled, because a runtime
TOML dependency would break the zero-dependency promise — and because a config
file that can express structure invites structure.

- Top-level `key = value` only. No tables (`[section]`), no dotted keys, no
  multi-line values.
- A value is a quoted string, a number, `true`/`false`, or a one-line array of
  quoted strings.
- `#` starts a comment. Inside a string, `\"` and `\\` are the only escapes.
- A key may be set once.
- **An unknown key warns; it never fails.** A newer fathohm's key must not break
  an older fathohm's build — but silence is how a typo'd `max_blind` gates
  nothing for a year, so the warning goes to stderr and the reading goes to
  stdout.

A command-line flag always beats the file.

---

## Exit codes

CI reads these, so they are a published interface: never renumbered, only
extended.

| Code | Meaning |
| --- | --- |
| `0` | The reading completed, or the check passed. |
| `1` | The check failed. |
| `2` | Usage — the invocation itself was wrong. |
| `3` | Cannot read honestly: no git on PATH, not a repository, or a truncated (shallow/grafted) history. Never a pass and never a failure. |
| `4` | Internal — a bug in fathohm. |

Exit 3 is the one worth designing around. A verdict on a fragment of a history
is a verdict on nothing, so a shallow clone does not quietly pass.

```yaml
# .github/workflows/comprehension.yml
- run: git fetch --unshallow          # exit 3 otherwise, and rightly so
- run: npx fathohm check --max-blind 40
```

---

## Scoring

**Scorer v4.** The card prints its scorer version on every reading, and the
version string is part of `--version`:

```
$ npx fathohm --version
fathohm 1.6.3 (scorer v4)
```

The CLI does not implement scoring. It imports the same deterministic scorer
the hosted product runs, and feeds it events built from your git history.
Authorship detection, the identity map, the engagement weights, the decay curve
and the 0.30 line all live in one place and are used from it — and so does the
180-day recency window the dark share is defined by, which is why the headline
is the scorer's own factor read at zero rather than a second opinion computed
in the CLI.

Every score decomposes into visible factors. `fathohm explain <file>` prints the
decomposition; there are no black boxes, because trust is the product.

```
FATHOHM ONE FILE — workers/src/scorer.ts
in acme-api · 2026-07-31T00:00:00Z · scorer v4

  score 0.416 (the line is 0.30)

  factor                   weight floor            ceiling
  human review depth         0.40 0.00 → 0.000     0.00 → 0.000
  human author recency       0.25 1.00 → 0.249     1.00 → 0.249
  bus factor                 0.25 0.67 → 0.167     0.67 → 0.167
  question answerability     0.10 0.00 → 0.000     0.00 → 0.000
                                  ─────────────    ─────────────
  score                           0.416            0.416
  question answerability reads 0 on every file: it needs an answer somebody
  other than the author verified, and git has no such record. Its weight is
  held rather than shared out, so nothing here can score above 0.900.

  last hand-written: 12 days ago · last prompted: —
  never pull-request mediated — there is no review record this file could
  have, so its ceiling is its floor and this reading of it is exact.

  in this reading it sits with:
  4 files hold above the line — recent hand-writing is what holds them up.
  They are 28% of the scored bytes.

  holds past the horizon — no crossing within 90 days.
```

That `0.40` on the first row is the whole reason the debt reading has two ends:
it is the largest single weight, and git carries nothing to fill it in.

The relationship between the two products is checked rather than asserted. A
parity harness in this repository re-reads the public gallery repositories with
this CLI, at the same window and the same instant the published snapshot was
taken. The floor is the most blind the evidence allows — hosted, which reads the
review API, can only ever find more engagement, never less — so a hosted number
landing above the CLI's floor means one of the two is wrong, and it blocks a
release. The other direction cannot block, and it is a real hole rather than a
tolerance: a squash- or rebase-merged pull request can leave nothing in the
commit graph to attribute a review to, so a team that reviews everything that
way reads here as though nothing was ever reviewed. That hole is what took the
debt interval off this CLI's headline in 1.5.0.

---

## The hosted reading

The CLI answers who has left the building. The hosted product answers whether
anybody read it: it reads the pull-request record — reviews, comments,
approvals, and who actually engaged — which is the one factor no `.git`
directory carries, and publishes a single measured comprehension-debt number
per repository, tracked over time, with the same factor breakdown behind every
score.

**[fathohm.dev](https://fathohm.dev)**

---

## Licence

MIT — see [LICENSE](./LICENSE), which ships inside the npm package.

The claims this tool makes about your code are checkable because the code that
makes them ships with it, readable. The binary is **one unminified file with its
comments intact**, so no clone and no account are needed to audit it:

```sh
npm pack fathohm && tar -xzf fathohm-*.tgz
less package/dist/fathohm.cjs
```

Two things worth grepping for, because they are the claims:

- `RECENCY_WINDOW_DAYS` and `scoreFromFactors` — the 180-day window the whole
  reading turns on, and the arithmetic the card re-runs in front of you.
- **every filesystem call it makes.** There are six in the whole bundle, and you
  can list them yourself:

  | call | how many | what it touches |
  | --- | --- | --- |
  | `readFileSync` | 1 | the `.fathohm.toml` you wrote — the only file it reads |
  | `writeFileSync` | 1 | the one HTML path you name on `fathohm map` |
  | `statSync` | 1 | is that directory there, or is git missing |
  | `existsSync` | 1 | is there a grafts file (replacements are asked of git) |
  | `lstatSync` | 1 | is the map's target a symlink — if so, nothing is written |
  | `realpathSync` | 1 | where the map's parent directory really is, before writing |

  No call opens a file in your source tree. `fetch(`, `http`, `net`, `tls` and
  `WebSocket` appear zero times; the sole `https` is the string
  `"https://fathohm.dev"` sitting in a sentence.

The scoring modules in that bundle are the same ones the hosted service runs.
A score you cannot re-derive is a black box.

---

## About this repository

This is the source of the `fathohm` command-line tool and the Fathohm VS Code
extension. It is **generated** from a private monorepo — see
[CONTRIBUTING.md](CONTRIBUTING.md) for what that means for issues and patches.

### What is here

```
cli/          the npm package `fathohm` — sources, tests, README, manifest
extension/    the VS Code extension
lib/          shared modules the two are compiled from
workers/src/  the scorer and the authorship classifier
```

`cli/` does not stand alone: the published binary is a single bundled file
compiled from all four directories. The shared modules are carried here at the
paths their importers already use, so nothing is rewritten on the way out and a
file in this tree is byte-identical to the file the hosted service runs.

Everything in this repository is MIT-licensed, including the shared modules
under `lib/` and `workers/src/`: **the published npm tarball already contains
them unminified, with their comments, so the grant reaches them whether or not
this tree exists** — `npm pack fathohm` has been a complete copy of the scorer
since 1.5.5, and this repository only makes it browsable.

The shared modules, in full:

- `lib/answerability-core.ts`
- `lib/blind-share-format.ts`
- `lib/code-files.ts`
- `lib/demo-data.ts`
- `lib/map-tree.ts`
- `lib/palette.ts`
- `lib/reading-explained.ts`
- `workers/src/authorship.ts`
- `workers/src/bot-identities.ts`
- `workers/src/identity-map.ts`
- `workers/src/scorer.ts`
- `workers/src/types.ts`

### Build it

```
npm install
npm test
npm run typecheck
npm run build          # cli/dist/fathohm.cjs, the published binary
npm run extension:build
```

The tests need `git` on the path and nothing else — several of them build
throwaway repositories in a temporary directory and read them back. Nothing
opens a network connection, and there is a test that asserts as much about the
built bundle.
