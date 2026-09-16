# Fathohm for VS Code

**How much of your code has gone dark — no human wrote or prompted any of it in
the last 180 days?** The number, in your status bar, while you are looking at
the file it is about.

```
fathohm 59% dark   this file · dark, last touched 8 months ago
```

Two items and two commands. Nothing in the gutter, nothing in the Problems
panel, nothing about any person.

**Install:** search "Fathohm" in the Extensions panel, or

```
code --install-extension fathohm.fathohm-vscode
```

Comprehension debt: code no human has recently written, reviewed, or explained
— measured from the record, not a survey. The status bar shows the half of that
a git history settles by itself: who wrote it, and when.

---

## What it shows

**`fathohm 59% dark` — the repository.** The share of this repo's code, weighed
by bytes, that no human wrote or prompted inside the last 180 days. Coloured on
the depth ramp the hosted Map uses.

> **The same number `npx fathohm read .` draws large, from 1.5.0 on.** Both
> surfaces divide the same `darkBytes` by the same scored bytes, so the terminal
> and the status bar cannot be two readings of one repository.
>
> This used to headline the comprehension-debt floor instead, and this box used
> to describe that as an open follow-up. Closed 2026-08-25, and the reason was
> not tidiness: the floor share is one end of an interval — 4% to 72% on a real
> repository — because `human_review_depth` carries 0.40 of the score and git
> records no reviews. A status bar has room for one number and none for a
> hedge, so it was printing the top of that interval as though it were the
> reading. The dark share has no interval in it.

Hover it:

> 59% of this code: no human wrote or prompted it in the last 180 days —
> measured from the record, not a survey.
>
> This number has no range in it — git settles authorship exactly. It says
> nothing about whether anyone has READ this code: git keeps no review record
> at all, so a dark file may have been read closely last week.
>
> 529 code files in `acme-api`, weighed by the bytes git reported.
>
> *reads your local git history — metadata only, never file contents, no
> network*

**`this file · dark, last touched 8 months ago` — the file you are in.** A
state, not a score: the repository number is a byte-weighted share, and a
single file has no share of itself. It is dark or it is lit, and the age is the
age of its newest human contact, hand-written or prompted, whichever is later.
A file no human has ever written or prompted says so rather than printing an
age it does not have.

The chip appears only for files this reading scored: prose, lockfiles,
untracked scratch files and anything a `.fathohm.toml` excluded are outside the
denominator, so they get no chip rather than a state that is about something
else.

Hover it and you get which of the four cases this file is in — a human wrote it
by hand and left, a human last reached it by prompting an agent and left, no
human has ever touched it, or it is lit — plus its last hand-written and last
prompted contact. No score appears, which is how this surface answers the rule
that a score must decompose into visible factors: it shows no number to
decompose, and the state it does show is fully evidenced by two dates and the
window. The factors still print in full under **Fathohm: Explain This File**,
where the card is the UI.

**`Fathohm: Explain This File`** runs `npx fathohm explain <path>` in the
integrated terminal. The CLI card is the UI; the extension redraws nothing.
Clicking the file chip runs it too.

**`Fathohm: Open the hosted Map`** opens <https://fathohm.dev/dashboard> in
your browser, where the same reading is drawn as a treemap — every file at
once, sized by bytes, instead of the one you happen to have open. Clicking the
repository item does it too. Your browser makes that request; this extension
does not, and learns nothing about whether you followed it.

## What it reads

**reads your local git history — metadata only, never file contents, no
network.**

The number is computed in-process by the same pipeline `npx fathohm` runs —
commit shas, authors, dates, subjects, co-author trailers, the paths each
commit touched, and the byte size of every blob in the tree. Nothing opens a
file in your working tree. Nothing opens a socket. There is no account, no
telemetry and no cache on disk.

Verify it the way you would verify any such claim: pull your ethernet cable out
and watch the number still be there.

The one thing that points outward is **Fathohm: Open the hosted Map**, which
hands one fixed URL to your desktop and lets your browser open it. No query
string, so nothing about your repository travels with it, and the extension is
told nothing back — not whether the page loaded, not whether you clicked. It
holds no socket either way; `extension/src/bright-lines.test.ts` reads that off
the shipping source and fails the build if a second URL ever appears.

## What it will never do

- **No per-line anything.** No decorations, no gutter icons, no CodeLens, no
  inlay hints. Per-line colouring would imply a claim about the contents of the
  code that this evidence cannot support, and it would read as blame. GitLens
  owns per-line; fathohm owns per-file.
- **No diagnostics.** A "problem" entry would frame comprehension debt as an
  error. It is a fact about a record, not a defect in a line.
- **No score for a person.** Not a name, not a rank, not a leaderboard. The
  subject is the codebase.
- **No claim about anyone's knowledge.** The record shows what was
  written, reviewed and explained, and when. What is in somebody's head is not
  in a git repository, and a tool whose only asset is checkability cannot
  afford a sentence no experiment could falsify.

## Recomputing

On activation, whenever `.git/HEAD` changes — a commit, a checkout, a rebase
step, a reset — and whenever the workspace folder changes, debounced so a
rebase costs one reading rather than thirty. Switching files re-reads the
cached reading and never the repository.

## Building

From the repository root:

```
npm run extension:build     # bundles extension/src/extension.ts → extension/dist/extension.js
npm test                    # the pure helpers, the display floors, the refusals above
```

## The rest of the reading

`npx fathohm` prints the whole card — what has gone dark and why, where it is,
the five files to start with, the twelve-month comprehension-debt trend, and
both readings of the debt itself. See the CLI's own page on
[npm](https://www.npmjs.com/package/fathohm), and the source of both the CLI
and this extension at [github.com/fathohm/cli](https://github.com/fathohm/cli).

<!-- This paragraph used to end "…and what a recorded review would actually
move", describing the card's leverage line. That line was deleted at 1.5.0: the
files it sat under are listed for having gone dark, and a review does not make a
file lit — recency is a fact about who AUTHORED the file. The counterfactual
still exists, in `fathohm paydown`, where the number it moves is the one it
actually moves. -->

## Licence

MIT — the full text ships inside this extension. Same reason as the CLI it wraps: a reading you
are asked to trust should be one you are allowed to audit.
